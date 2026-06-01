/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"
import { existsSync, readFileSync, readdirSync, unlinkSync, statSync, mkdirSync } from "fs"
import { join } from "path"

interface StorageConfig {
  maxStorageMB: number
  maxTasks: number
  maxTaskAge: number
  cleanupInterval: number
  warningThreshold: number
}

interface StorageStatus {
  taskCount: number
  totalSize: number
  totalSizeMB: number
  maxStorageMB: number
  percentage: number
  warning: boolean
  timestamp: string
}

interface TaskInfo {
  id: string
  size: number
  createdAt: string
  status: string
  age: number
}

interface CleanupResult {
  deleted: number
  freed: number
  freedMB: number
  remaining: number
}

const DEFAULT_CONFIG: StorageConfig = {
  maxStorageMB: 100,
  maxTasks: 1000,
  maxTaskAge: 7 * 24 * 60 * 60 * 1000,
  cleanupInterval: 60 * 60 * 1000,
  warningThreshold: 80,
}

const TASKS_DIR = join(process.env.HOME || "~", ".config", "opencode", "tasks")

let config: StorageConfig = { ...DEFAULT_CONFIG }
let monitorTimer: ReturnType<typeof setInterval> | null = null
let lastCleanup: CleanupResult | null = null

function ensureDir(): void {
  if (!existsSync(TASKS_DIR)) {
    mkdirSync(TASKS_DIR, { recursive: true })
  }
}

function getTaskSize(taskID: string): number {
  const filePath = join(TASKS_DIR, `${taskID}.json`)
  if (!existsSync(filePath)) return 0

  try {
    const stats = statSync(filePath)
    return stats.size
  } catch {
    return 0
  }
}

function listAllTasks(): TaskInfo[] {
  ensureDir()
  if (!existsSync(TASKS_DIR)) return []

  const files = readdirSync(TASKS_DIR)
  const tasks: TaskInfo[] = []
  const now = Date.now()

  for (const file of files) {
    if (!file.endsWith(".json")) continue

    try {
      const filePath = join(TASKS_DIR, file)
      const data = JSON.parse(readFileSync(filePath, "utf-8"))
      const stats = statSync(filePath)
      const createdAt = new Date(data.createdAt).getTime()

      tasks.push({
        id: data.id,
        size: stats.size,
        createdAt: data.createdAt,
        status: data.status,
        age: now - createdAt,
      })
    } catch {
      // Skip invalid files
    }
  }

  return tasks
}

function getStorageStatus(): StorageStatus {
  const tasks = listAllTasks()
  const totalSize = tasks.reduce((sum, t) => sum + t.size, 0)
  const totalSizeMB = parseFloat((totalSize / (1024 * 1024)).toFixed(2))
  const percentage = Math.round((totalSizeMB / config.maxStorageMB) * 100)

  return {
    taskCount: tasks.length,
    totalSize,
    totalSizeMB,
    maxStorageMB: config.maxStorageMB,
    percentage,
    warning: percentage >= config.warningThreshold,
    timestamp: new Date().toISOString(),
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function deleteTask(taskID: string): boolean {
  const filePath = join(TASKS_DIR, `${taskID}.json`)
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath)
      return true
    } catch {
      return false
    }
  }
  return false
}

function performCleanup(): CleanupResult {
  const tasks = listAllTasks()
  let deleted = 0
  let freed = 0
  const now = Date.now()

  // Clean expired tasks
  for (const task of tasks) {
    if (task.age > config.maxTaskAge) {
      if (deleteTask(task.id)) {
        deleted++
        freed += task.size
      }
    }
  }

  // Clean tasks exceeding count limit
  const remaining = listAllTasks()
  if (remaining.length > config.maxTasks) {
    remaining.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    const toDelete = remaining.slice(config.maxTasks)

    for (const task of toDelete) {
      if (deleteTask(task.id)) {
        deleted++
        freed += task.size
      }
    }
  }

  // Clean tasks exceeding storage limit
  const afterCount = listAllTasks()
  const totalSize = afterCount.reduce((sum, t) => sum + t.size, 0)
  const totalSizeMB = totalSize / (1024 * 1024)

  if (totalSizeMB > config.maxStorageMB) {
    afterCount.sort((a, b) => a.age - b.age) // Oldest first
    let currentSize = totalSize

    for (const task of afterCount) {
      if (currentSize / (1024 * 1024) <= config.maxStorageMB) break

      if (deleteTask(task.id)) {
        deleted++
        freed += task.size
        currentSize -= task.size
      }
    }
  }

  const result: CleanupResult = {
    deleted,
    freed,
    freedMB: parseFloat((freed / (1024 * 1024)).toFixed(2)),
    remaining: listAllTasks().length,
  }

  lastCleanup = result
  return result
}

function startMonitor(): void {
  if (monitorTimer) return

  monitorTimer = setInterval(() => {
    const status = getStorageStatus()

    if (status.warning) {
      console.warn(`[Storage Warning] Usage: ${status.percentage}% (${status.totalSizeMB}MB / ${status.maxStorageMB}MB)`)
      performCleanup()
    }
  }, config.cleanupInterval)
}

function stopMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer)
    monitorTimer = null
  }
}

function updateConfig(newConfig: Partial<StorageConfig>): StorageConfig {
  if (newConfig.maxStorageMB !== undefined && newConfig.maxStorageMB > 0) {
    config.maxStorageMB = newConfig.maxStorageMB
  }
  if (newConfig.maxTasks !== undefined && newConfig.maxTasks > 0) {
    config.maxTasks = newConfig.maxTasks
  }
  if (newConfig.maxTaskAge !== undefined && newConfig.maxTaskAge > 0) {
    config.maxTaskAge = newConfig.maxTaskAge
  }
  if (newConfig.cleanupInterval !== undefined && newConfig.cleanupInterval > 0) {
    config.cleanupInterval = newConfig.cleanupInterval
  }
  if (newConfig.warningThreshold !== undefined) {
    config.warningThreshold = Math.max(0, Math.min(100, newConfig.warningThreshold))
  }

  if (monitorTimer) {
    stopMonitor()
    startMonitor()
  }

  return { ...config }
}

function getTaskDetails(taskID: string): TaskInfo | null {
  const tasks = listAllTasks()
  return tasks.find((t) => t.id === taskID) || null
}

export default tool({
  description: `Storage management tool

Features:
- Monitor storage usage
- Automatic cleanup of expired tasks
- Enforce storage limits
- Task age tracking
- Configurable retention policies

Use this tool to prevent disk space exhaustion from task accumulation.`,
  args: {
    action: tool.schema
      .enum(["status", "cleanup", "config", "start", "stop", "details", "lastCleanup"])
      .describe("Operation type"),
    maxStorageMB: tool.schema.number().optional().describe("Maximum storage in MB"),
    maxTasks: tool.schema.number().optional().describe("Maximum number of tasks"),
    maxTaskAge: tool.schema.number().optional().describe("Maximum task age in days"),
    cleanupInterval: tool.schema.number().optional().describe("Cleanup interval in milliseconds"),
    warningThreshold: tool.schema.number().optional().describe("Warning threshold (percentage)"),
    taskID: tool.schema.string().optional().describe("Task ID for details"),
  },
  async execute(args) {
    switch (args.action) {
      case "status": {
        const status = getStorageStatus()
        return {
          success: true,
          status: {
            ...status,
            totalSizeFormatted: formatBytes(status.totalSize),
          },
          config,
          monitorActive: monitorTimer !== null,
        }
      }

      case "cleanup": {
        const result = performCleanup()
        return {
          success: true,
          message: "Storage cleanup completed",
          result: {
            ...result,
            freedFormatted: formatBytes(result.freed),
          },
          status: getStorageStatus(),
        }
      }

      case "config": {
        const newConfig: Partial<StorageConfig> = {}
        if (args.maxStorageMB !== undefined) newConfig.maxStorageMB = args.maxStorageMB
        if (args.maxTasks !== undefined) newConfig.maxTasks = args.maxTasks
        if (args.maxTaskAge !== undefined) newConfig.maxTaskAge = args.maxTaskAge * 24 * 60 * 60 * 1000
        if (args.cleanupInterval !== undefined) newConfig.cleanupInterval = args.cleanupInterval
        if (args.warningThreshold !== undefined) newConfig.warningThreshold = args.warningThreshold

        const updated = updateConfig(newConfig)
        return {
          success: true,
          message: "Storage configuration updated",
          config: {
            ...updated,
            maxTaskAgeDays: updated.maxTaskAge / (24 * 60 * 60 * 1000),
          },
        }
      }

      case "start": {
        startMonitor()
        return {
          success: true,
          message: "Storage monitor started",
          config,
        }
      }

      case "stop": {
        stopMonitor()
        return {
          success: true,
          message: "Storage monitor stopped",
        }
      }

      case "details": {
        if (!args.taskID) throw new Error("taskID is required for details operation")

        const task = getTaskDetails(args.taskID)
        return {
          success: task !== null,
          task: task
            ? {
                ...task,
                sizeFormatted: formatBytes(task.size),
                ageFormatted: `${Math.round(task.age / (60 * 60 * 1000))} hours`,
              }
            : null,
          message: task ? `Task ${args.taskID} found` : `Task ${args.taskID} not found`,
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
  },
})
