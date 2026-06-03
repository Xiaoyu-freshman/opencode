/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"
import { existsSync, readFileSync, readdirSync, unlinkSync, statSync } from "fs"
import { join } from "path"

interface MemoryConfig {
  warningThreshold: number
  criticalThreshold: number
  cleanupInterval: number
  autoCleanup: boolean
}

interface MemoryStatus {
  heapUsed: number
  heapTotal: number
  rss: number
  external: number
  arrayBuffers: number
  percentage: number
  warning: boolean
  critical: boolean
  timestamp: string
}

interface CleanupResult {
  freed: number
  freedMB: number
  tasksCleaned: number
  logsCleaned: number
  tempFilesCleaned: number
}

interface MemoryHistoryEntry {
  timestamp: string
  heapUsed: number
  heapTotal: number
  rss: number
  percentage: number
}

const DEFAULT_CONFIG: MemoryConfig = {
  warningThreshold: 75,
  criticalThreshold: 90,
  cleanupInterval: 5 * 60 * 1000,
  autoCleanup: true,
}

const TASKS_DIR = join(process.env.HOME || "~", ".config", "opencode", "tasks")
const HISTORY_SIZE = 100

let config: MemoryConfig = { ...DEFAULT_CONFIG }
let monitorTimer: ReturnType<typeof setInterval> | null = null
let history: MemoryHistoryEntry[] = []
let lastCleanup: CleanupResult | null = null

function getMemoryStatus(): MemoryStatus {
  const usage = process.memoryUsage()
  const percentage = Math.min(100, Math.round((usage.heapUsed / usage.heapTotal) * 100))

  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    rss: usage.rss,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
    percentage,
    warning: percentage >= config.warningThreshold,
    critical: percentage >= config.criticalThreshold,
    timestamp: new Date().toISOString(),
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function cleanupCompletedTasks(): number {
  if (!existsSync(TASKS_DIR)) return 0

  let cleaned = 0
  const files = readdirSync(TASKS_DIR)

  for (const file of files) {
    if (!file.endsWith(".json")) continue

    try {
      const filePath = join(TASKS_DIR, file)
      const data = JSON.parse(readFileSync(filePath, "utf-8"))

      if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
        const completedAt = data.completedAt ? new Date(data.completedAt).getTime() : 0
        const age = Date.now() - completedAt

        if (age > 24 * 60 * 60 * 1000) {
          unlinkSync(filePath)
          cleaned++
        }
      }
    } catch {
      // Skip invalid files
    }
  }

  return cleaned
}

function cleanupHistory(): number {
  const before = history.length
  if (history.length > HISTORY_SIZE) {
    history = history.slice(-HISTORY_SIZE)
  }
  return before - history.length
}

function forceGarbageCollect(): void {
  if (global.gc) {
    global.gc()
  }
}

function performCleanup(): CleanupResult {
  const before = process.memoryUsage().heapUsed

  const tasksCleaned = cleanupCompletedTasks()
  const logsCleaned = cleanupHistory()
  const tempFilesCleaned = 0

  forceGarbageCollect()

  const after = process.memoryUsage().heapUsed
  const freed = Math.max(0, before - after)

  const result: CleanupResult = {
    freed,
    freedMB: parseFloat((freed / (1024 * 1024)).toFixed(2)),
    tasksCleaned,
    logsCleaned,
    tempFilesCleaned,
  }

  lastCleanup = result
  return result
}

function addToHistory(status: MemoryStatus): void {
  history.push({
    timestamp: status.timestamp,
    heapUsed: status.heapUsed,
    heapTotal: status.heapTotal,
    rss: status.rss,
    percentage: status.percentage,
  })

  if (history.length > HISTORY_SIZE) {
    history.shift()
  }
}

function startMonitor(): void {
  if (monitorTimer) return

  monitorTimer = setInterval(() => {
    const status = getMemoryStatus()
    addToHistory(status)

    if (config.autoCleanup && status.warning) {
      console.warn(`[Memory Warning] Usage: ${status.percentage}%`)
      performCleanup()
    }

    if (status.critical) {
      console.error(`[Memory Critical] Usage: ${status.critical ? "CRITICAL" : "warning"} at ${status.percentage}%`)
    }
  }, config.cleanupInterval)
}

function stopMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer)
    monitorTimer = null
  }
}

function getHistory(limit?: number): MemoryHistoryEntry[] {
  if (limit && limit > 0) {
    return history.slice(-limit)
  }
  return [...history]
}

function updateConfig(newConfig: Partial<MemoryConfig>): MemoryConfig {
  if (newConfig.warningThreshold !== undefined) {
    config.warningThreshold = Math.max(0, Math.min(100, newConfig.warningThreshold))
  }
  if (newConfig.criticalThreshold !== undefined) {
    config.criticalThreshold = Math.max(0, Math.min(100, newConfig.criticalThreshold))
  }
  if (newConfig.cleanupInterval !== undefined) {
    config.cleanupInterval = Math.max(1000, newConfig.cleanupInterval)
  }
  if (newConfig.autoCleanup !== undefined) {
    config.autoCleanup = newConfig.autoCleanup
  }

  if (monitorTimer) {
    stopMonitor()
    startMonitor()
  }

  return { ...config }
}

export default tool({
  description: `Memory management tool

Features:
- Monitor memory usage in real-time
- Automatic cleanup when memory is high
- Garbage collection control
- Memory usage history tracking
- Configurable thresholds

Use this tool to prevent memory leaks and manage resource consumption.`,
  args: {
    action: tool.schema
      .enum(["status", "cleanup", "config", "start", "stop", "history", "lastCleanup"])
      .describe("Operation type"),
    warningThreshold: tool.schema.number().optional().describe("Warning threshold (percentage)"),
    criticalThreshold: tool.schema.number().optional().describe("Critical threshold (percentage)"),
    cleanupInterval: tool.schema.number().optional().describe("Cleanup interval (milliseconds)"),
    autoCleanup: tool.schema.boolean().optional().describe("Enable automatic cleanup"),
    limit: tool.schema.number().optional().describe("History limit"),
  },
  async execute(args) {
    const result = (() => {
      switch (args.action) {
      case "status": {
        const status = getMemoryStatus()
        addToHistory(status)

        return {
          success: true,
          status: {
            ...status,
            heapUsedFormatted: formatBytes(status.heapUsed),
            heapTotalFormatted: formatBytes(status.heapTotal),
            rssFormatted: formatBytes(status.rss),
            externalFormatted: formatBytes(status.external),
          },
          config,
          monitorActive: monitorTimer !== null,
        }
      }

      case "cleanup": {
        const result = performCleanup()
        return {
          success: true,
          message: "Memory cleanup completed",
          result: {
            ...result,
            freedFormatted: formatBytes(result.freed),
          },
          status: getMemoryStatus(),
        }
      }

      case "config": {
        const newConfig: Partial<MemoryConfig> = {}
        if (args.warningThreshold !== undefined) newConfig.warningThreshold = args.warningThreshold
        if (args.criticalThreshold !== undefined) newConfig.criticalThreshold = args.criticalThreshold
        if (args.cleanupInterval !== undefined) newConfig.cleanupInterval = args.cleanupInterval
        if (args.autoCleanup !== undefined) newConfig.autoCleanup = args.autoCleanup

        const updated = updateConfig(newConfig)
        return {
          success: true,
          message: "Memory configuration updated",
          config: updated,
        }
      }

      case "start": {
        startMonitor()
        return {
          success: true,
          message: "Memory monitor started",
          config,
        }
      }

      case "stop": {
        stopMonitor()
        return {
          success: true,
          message: "Memory monitor stopped",
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

      case "lastCleanup": {
        return {
          success: true,
          lastCleanup: lastCleanup
            ? {
                ...lastCleanup,
                freedFormatted: formatBytes(lastCleanup.freed),
              }
            : null,
        }
      }

      default:
        throw new Error(`Unknown action: ${args.action}`)
      }
    })()
    return { output: JSON.stringify(result, null, 2) }
  },
})
