/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"
import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"

interface PerformanceMetrics {
  timestamp: string
  taskCount: number
  runningTasks: number
  queuedTasks: number
  completedTasks: number
  failedTasks: number
  averageDuration: number
  memoryUsage: number
  memoryUsedMB: number
  storageUsage: number
  storageUsedMB: number
  uptime: number
}

interface PerformanceTrends {
  taskCount: "increasing" | "decreasing" | "stable"
  memoryUsage: "increasing" | "decreasing" | "stable"
  storageUsage: "increasing" | "decreasing" | "stable"
}

interface PerformanceReport {
  current: PerformanceMetrics
  trends: PerformanceTrends
  recommendations: string[]
  history: PerformanceMetrics[]
  generatedAt: string
}

interface MonitorConfig {
  interval: number
  maxHistory: number
  alertThresholds: {
    memoryUsage: number
    storageUsage: number
    queueSize: number
    failureRate: number
  }
}

const DEFAULT_CONFIG: MonitorConfig = {
  interval: 10000,
  maxHistory: 1000,
  alertThresholds: {
    memoryUsage: 80,
    storageUsage: 80,
    queueSize: 50,
    failureRate: 10,
  },
}

const TASKS_DIR = join(process.env.HOME || "~", ".config", "opencode", "tasks")

let config: MonitorConfig = { ...DEFAULT_CONFIG }
let history: PerformanceMetrics[] = []
let monitorTimer: ReturnType<typeof setInterval> | null = null
let startTime: number = Date.now()
let alerts: string[] = []

function listTasks(): Array<{ id: string; status: string; createdAt: string; completedAt?: string }> {
  if (!existsSync(TASKS_DIR)) return []

  const files = readdirSync(TASKS_DIR)
  const tasks: Array<{ id: string; status: string; createdAt: string; completedAt?: string }> = []

  for (const file of files) {
    if (!file.endsWith(".json")) continue

    try {
      const filePath = join(TASKS_DIR, file)
      const data = JSON.parse(readFileSync(filePath, "utf-8"))
      tasks.push({
        id: data.id,
        status: data.status,
        createdAt: data.createdAt,
        completedAt: data.completedAt,
      })
    } catch {
      // Skip invalid files
    }
  }

  return tasks
}

function getStorageUsed(): number {
  if (!existsSync(TASKS_DIR)) return 0

  const files = readdirSync(TASKS_DIR)
  let totalSize = 0

  for (const file of files) {
    try {
      const stats = statSync(join(TASKS_DIR, file))
      totalSize += stats.size
    } catch {
      // Skip inaccessible files
    }
  }

  return totalSize
}

function calculateAverageDuration(tasks: Array<{ status: string; createdAt: string; completedAt?: string }>): number {
  const completedTasks = tasks.filter((t) => t.completedAt)
  if (completedTasks.length === 0) return 0

  const totalDuration = completedTasks.reduce((sum, t) => {
    const start = new Date(t.createdAt).getTime()
    const end = new Date(t.completedAt!).getTime()
    return sum + (end - start)
  }, 0)

  return Math.round(totalDuration / completedTasks.length)
}

function collectMetrics(): PerformanceMetrics {
  const tasks = listTasks()
  const memory = process.memoryUsage()
  const storageUsed = getStorageUsed()

  return {
    timestamp: new Date().toISOString(),
    taskCount: tasks.length,
    runningTasks: tasks.filter((t) => t.status === "running").length,
    queuedTasks: tasks.filter((t) => t.status === "pending").length,
    completedTasks: tasks.filter((t) => t.status === "completed").length,
    failedTasks: tasks.filter((t) => t.status === "failed").length,
    averageDuration: calculateAverageDuration(tasks),
    memoryUsage: Math.min(100, Math.round((memory.heapUsed / memory.heapTotal) * 100)),
    memoryUsedMB: parseFloat((memory.heapUsed / (1024 * 1024)).toFixed(2)),
    storageUsage: 0,
    storageUsedMB: parseFloat((storageUsed / (1024 * 1024)).toFixed(2)),
    uptime: Date.now() - startTime,
  }
}

function addToHistory(metrics: PerformanceMetrics): void {
  history.push(metrics)

  if (history.length > config.maxHistory) {
    history.shift()
  }
}

function checkAlerts(metrics: PerformanceMetrics): void {
  alerts = []

  if (metrics.memoryUsage >= config.alertThresholds.memoryUsage) {
    alerts.push(`High memory usage: ${metrics.memoryUsage}%`)
  }

  if (metrics.storageUsedMB >= config.alertThresholds.storageUsage) {
    alerts.push(`High storage usage: ${metrics.storageUsedMB}MB`)
  }

  if (metrics.queuedTasks >= config.alertThresholds.queueSize) {
    alerts.push(`Large queue size: ${metrics.queuedTasks} tasks`)
  }

  const totalFinished = metrics.completedTasks + metrics.failedTasks
  if (totalFinished > 0) {
    const failureRate = (metrics.failedTasks / totalFinished) * 100
    if (failureRate >= config.alertThresholds.failureRate) {
      alerts.push(`High failure rate: ${failureRate.toFixed(1)}%`)
    }
  }

  for (const alert of alerts) {
    console.warn(`[Performance Alert] ${alert}`)
  }
}

function calculateTrends(): PerformanceTrends {
  if (history.length < 2) {
    return {
      taskCount: "stable",
      memoryUsage: "stable",
      storageUsage: "stable",
    }
  }

  const recent = history.slice(-10)
  const older = history.slice(-20, -10)

  if (older.length === 0) {
    return {
      taskCount: "stable",
      memoryUsage: "stable",
      storageUsage: "stable",
    }
  }

  const recentAvgTasks = recent.reduce((sum, m) => sum + m.taskCount, 0) / recent.length
  const olderAvgTasks = older.reduce((sum, m) => sum + m.taskCount, 0) / older.length

  const recentAvgMemory = recent.reduce((sum, m) => sum + m.memoryUsage, 0) / recent.length
  const olderAvgMemory = older.reduce((sum, m) => sum + m.memoryUsage, 0) / older.length

  const recentAvgStorage = recent.reduce((sum, m) => sum + m.storageUsedMB, 0) / recent.length
  const olderAvgStorage = older.reduce((sum, m) => sum + m.storageUsedMB, 0) / older.length

  const threshold = 0.1

  return {
    taskCount: recentAvgTasks > olderAvgTasks * (1 + threshold)
      ? "increasing"
      : recentAvgTasks < olderAvgTasks * (1 - threshold)
        ? "decreasing"
        : "stable",
    memoryUsage: recentAvgMemory > olderAvgMemory * (1 + threshold)
      ? "increasing"
      : recentAvgMemory < olderAvgMemory * (1 - threshold)
        ? "decreasing"
        : "stable",
    storageUsage: recentAvgStorage > olderAvgStorage * (1 + threshold)
      ? "increasing"
      : recentAvgStorage < olderAvgStorage * (1 - threshold)
        ? "decreasing"
        : "stable",
  }
}

function generateRecommendations(metrics: PerformanceMetrics): string[] {
  const recommendations: string[] = []

  if (metrics.memoryUsage > 80) {
    recommendations.push("Consider running memory cleanup to free up resources")
  }

  if (metrics.queuedTasks > 20) {
    recommendations.push("Queue size is large, consider increasing concurrency limit")
  }

  const totalFinished = metrics.completedTasks + metrics.failedTasks
  if (totalFinished > 0) {
    const failureRate = (metrics.failedTasks / totalFinished) * 100
    if (failureRate > 20) {
      recommendations.push("High failure rate detected, review task configurations")
    }
  }

  if (metrics.averageDuration > 300000) {
    recommendations.push("Average task duration is high, consider optimizing tasks")
  }

  if (metrics.storageUsedMB > 50) {
    recommendations.push("Storage usage is growing, run storage cleanup")
  }

  if (recommendations.length === 0) {
    recommendations.push("System is performing well, no immediate action needed")
  }

  return recommendations
}

function startMonitor(): void {
  if (monitorTimer) return

  monitorTimer = setInterval(() => {
    const metrics = collectMetrics()
    addToHistory(metrics)
    checkAlerts(metrics)
  }, config.interval)
}

function stopMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer)
    monitorTimer = null
  }
}

function generateReport(): PerformanceReport {
  const current = collectMetrics()
  const trends = calculateTrends()
  const recommendations = generateRecommendations(current)

  return {
    current,
    trends,
    recommendations,
    history: history.slice(-50),
    generatedAt: new Date().toISOString(),
  }
}

function updateConfig(newConfig: Partial<MonitorConfig>): MonitorConfig {
  if (newConfig.interval !== undefined && newConfig.interval > 0) {
    config.interval = newConfig.interval
  }
  if (newConfig.maxHistory !== undefined && newConfig.maxHistory > 0) {
    config.maxHistory = newConfig.maxHistory
  }
  if (newConfig.alertThresholds) {
    config.alertThresholds = {
      ...config.alertThresholds,
      ...newConfig.alertThresholds,
    }
  }

  if (monitorTimer) {
    stopMonitor()
    startMonitor()
  }

  return { ...config }
}

function getHistory(limit?: number): PerformanceMetrics[] {
  if (limit && limit > 0) {
    return history.slice(-limit)
  }
  return [...history]
}

export default tool({
  description: `Performance monitoring tool

Features:
- Collect real-time performance metrics
- Track task execution statistics
- Monitor memory and storage usage
- Generate performance reports
- Detect performance issues
- Provide optimization recommendations

Use this tool to monitor system health and identify bottlenecks.`,
  args: {
    action: tool.schema
      .enum(["status", "report", "history", "config", "start", "stop", "alerts"])
      .describe("Operation type"),
    interval: tool.schema.number().optional().describe("Monitoring interval in milliseconds"),
    maxHistory: tool.schema.number().optional().describe("Maximum history entries"),
    limit: tool.schema.number().optional().describe("History limit"),
    memoryThreshold: tool.schema.number().optional().describe("Memory alert threshold"),
    storageThreshold: tool.schema.number().optional().describe("Storage alert threshold"),
    queueThreshold: tool.schema.number().optional().describe("Queue size alert threshold"),
    failureThreshold: tool.schema.number().optional().describe("Failure rate alert threshold"),
  },
  async execute(args) {
    const result = (() => {
      switch (args.action) {
      case "status": {
        const metrics = collectMetrics()
        addToHistory(metrics)
        checkAlerts(metrics)

        return {
          success: true,
          metrics: {
            ...metrics,
            uptimeFormatted: formatDuration(metrics.uptime),
            averageDurationFormatted: formatDuration(metrics.averageDuration),
          },
          alerts,
          monitorActive: monitorTimer !== null,
        }
      }

      case "report": {
        const report = generateReport()
        return {
          success: true,
          report: {
            ...report,
            current: {
              ...report.current,
              uptimeFormatted: formatDuration(report.current.uptime),
              averageDurationFormatted: formatDuration(report.current.averageDuration),
            },
          },
        }
      }

      case "history": {
        const limit = args.limit
        const historyData = getHistory(limit)
        return {
          success: true,
          count: historyData.length,
          history: historyData,
        }
      }

      case "config": {
        const newConfig: Partial<MonitorConfig> = {}
        if (args.interval !== undefined) newConfig.interval = args.interval
        if (args.maxHistory !== undefined) newConfig.maxHistory = args.maxHistory

        if (args.memoryThreshold !== undefined || args.storageThreshold !== undefined ||
            args.queueThreshold !== undefined || args.failureThreshold !== undefined) {
          newConfig.alertThresholds = {}
          if (args.memoryThreshold !== undefined) newConfig.alertThresholds.memoryUsage = args.memoryThreshold
          if (args.storageThreshold !== undefined) newConfig.alertThresholds.storageUsage = args.storageThreshold
          if (args.queueThreshold !== undefined) newConfig.alertThresholds.queueSize = args.queueThreshold
          if (args.failureThreshold !== undefined) newConfig.alertThresholds.failureRate = args.failureThreshold
        }

        const updated = updateConfig(newConfig)
        return {
          success: true,
          message: "Performance monitor configuration updated",
          config: updated,
        }
      }

      case "start": {
        startMonitor()
        return {
          success: true,
          message: "Performance monitor started",
          config,
        }
      }

      case "stop": {
        stopMonitor()
        return {
          success: true,
          message: "Performance monitor stopped",
        }
      }

      case "alerts": {
        const metrics = collectMetrics()
        checkAlerts(metrics)
        return {
          success: true,
          alerts,
          metrics: {
            memoryUsage: metrics.memoryUsage,
            storageUsedMB: metrics.storageUsedMB,
            queuedTasks: metrics.queuedTasks,
            failedTasks: metrics.failedTasks,
          },
        }
      }

      default:
        throw new Error(`Unknown action: ${args.action}`)
      }
    })()
    return { output: JSON.stringify(result, null, 2) }
  },
})

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`
  return `${(ms / 3600000).toFixed(1)}h`
}
