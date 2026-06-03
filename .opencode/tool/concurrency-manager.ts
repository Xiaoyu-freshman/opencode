/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"

interface ConcurrencyConfig {
  maxConcurrent: number
  maxQueued: number
}

interface ConcurrencyStatus {
  running: number
  queued: number
  maxConcurrent: number
  maxQueued: number
  runningTasks: string[]
  queuedTasks: string[]
}

interface QueuedTask {
  taskID: string
  resolve: (value: boolean) => void
  reject: (reason: Error) => void
  timestamp: number
}

const DEFAULT_CONFIG: ConcurrencyConfig = {
  maxConcurrent: 3,
  maxQueued: 10,
}

let config: ConcurrencyConfig = { ...DEFAULT_CONFIG }
let running = new Map<string, { timestamp: number }>()
let queue: QueuedTask[] = []

function acquire(taskID: string): boolean {
  if (running.has(taskID)) {
    return true
  }

  if (running.size >= config.maxConcurrent) {
    if (queue.length >= config.maxQueued) {
      return false
    }

    return new Promise<boolean>((resolve, reject) => {
      queue.push({
        taskID,
        resolve,
        reject,
        timestamp: Date.now(),
      })
    })
  }

  running.set(taskID, { timestamp: Date.now() })
  return true
}

function release(taskID: string): void {
  running.delete(taskID)

  processQueue()
}

function processQueue(): void {
  while (queue.length > 0 && running.size < config.maxConcurrent) {
    const next = queue.shift()
    if (next) {
      running.set(next.taskID, { timestamp: Date.now() })
      next.resolve(true)
    }
  }
}

function getStatus(): ConcurrencyStatus {
  return {
    running: running.size,
    queued: queue.length,
    maxConcurrent: config.maxConcurrent,
    maxQueued: config.maxQueued,
    runningTasks: Array.from(running.keys()),
    queuedTasks: queue.map((q) => q.taskID),
  }
}

function adjust(newConfig: Partial<ConcurrencyConfig>): ConcurrencyConfig {
  if (newConfig.maxConcurrent !== undefined && newConfig.maxConcurrent > 0) {
    config.maxConcurrent = newConfig.maxConcurrent
  }
  if (newConfig.maxQueued !== undefined && newConfig.maxQueued >= 0) {
    config.maxQueued = newConfig.maxQueued
  }

  processQueue()

  return { ...config }
}

function cancelTask(taskID: string): boolean {
  const queueIndex = queue.findIndex((q) => q.taskID === taskID)
  if (queueIndex !== -1) {
    const [removed] = queue.splice(queueIndex, 1)
    removed.reject(new Error(`Task ${taskID} cancelled`))
    return true
  }

  return running.has(taskID)
}

function getWaitTime(taskID: string): number | null {
  const queuedTask = queue.find((q) => q.taskID === taskID)
  if (!queuedTask) return null

  return Date.now() - queuedTask.timestamp
}

export default tool({
  description: `Concurrency control tool

Features:
- Limit simultaneous task execution
- Manage task queue with priority
- Dynamic concurrency adjustment
- Task cancellation support
- Wait time tracking

Use this tool to prevent resource exhaustion from too many concurrent tasks.`,
  args: {
    action: tool.schema
      .enum(["config", "acquire", "release", "status", "adjust", "cancel", "waitTime"])
      .describe("Operation type"),
    maxConcurrent: tool.schema.number().optional().describe("Maximum concurrent tasks"),
    maxQueued: tool.schema.number().optional().describe("Maximum queued tasks"),
    taskID: tool.schema.string().optional().describe("Task ID"),
  },
  async execute(args) {
    const result = (() => {
      switch (args.action) {
      case "config": {
        const newConfig: Partial<ConcurrencyConfig> = {}
        if (args.maxConcurrent !== undefined) newConfig.maxConcurrent = args.maxConcurrent
        if (args.maxQueued !== undefined) newConfig.maxQueued = args.maxQueued

        const updated = adjust(newConfig)
        return {
          success: true,
          message: "Concurrency configuration updated",
          config: updated,
        }
      }

      case "acquire": {
        if (!args.taskID) throw new Error("taskID is required for acquire operation")

        const acquired = acquire(args.taskID)
        return {
          success: acquired,
          taskID: args.taskID,
          message: acquired
            ? `Execution permit acquired for ${args.taskID}`
            : `Queue is full, task ${args.taskID} rejected`,
          status: getStatus(),
        }
      }

      case "release": {
        if (!args.taskID) throw new Error("taskID is required for release operation")

        release(args.taskID)
        return {
          success: true,
          taskID: args.taskID,
          message: `Execution permit released for ${args.taskID}`,
          status: getStatus(),
        }
      }

      case "status": {
        return {
          success: true,
          status: getStatus(),
        }
      }

      case "adjust": {
        const newConfig: Partial<ConcurrencyConfig> = {}
        if (args.maxConcurrent !== undefined) newConfig.maxConcurrent = args.maxConcurrent
        if (args.maxQueued !== undefined) newConfig.maxQueued = args.maxQueued

        const updated = adjust(newConfig)
        return {
          success: true,
          message: "Concurrency adjusted",
          config: updated,
          status: getStatus(),
        }
      }

      case "cancel": {
        if (!args.taskID) throw new Error("taskID is required for cancel operation")

        const cancelled = cancelTask(args.taskID)
        return {
          success: cancelled,
          taskID: args.taskID,
          message: cancelled
            ? `Task ${args.taskID} cancelled`
            : `Task ${args.taskID} not found in queue`,
        }
      }

      case "waitTime": {
        if (!args.taskID) throw new Error("taskID is required for waitTime operation")

        const waitTime = getWaitTime(args.taskID)
        return {
          success: waitTime !== null,
          taskID: args.taskID,
          waitTime,
          message: waitTime !== null
            ? `Task ${args.taskID} has been waiting ${waitTime}ms`
            : `Task ${args.taskID} not found in queue`,
        }
      }

      default:
        throw new Error(`Unknown action: ${args.action}`)
      }
    })()
    return { output: JSON.stringify(result, null, 2) }
  },
})
