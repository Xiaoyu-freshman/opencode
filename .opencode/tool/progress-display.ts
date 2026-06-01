/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"

// Progress data structures
interface TaskProgress {
  taskName: string
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
  progress: number
  startTime?: string
  estimatedTime?: number
  result?: string
}

interface ProgressInfo {
  overall: {
    total: number
    completed: number
    running: number
    failed: number
    percentage: number
  }
  current: TaskProgress | null
  history: Array<{
    taskName: string
    status: "completed" | "failed" | "cancelled"
    duration: number
    result?: string
  }>
}

// Storage configuration
const STATE_DIR = join(process.env.HOME || "~", ".config", "opencode", "progress")

function ensureDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true })
  }
}

function getProgressPath(taskID: string): string {
  return join(STATE_DIR, `${taskID}.json`)
}

function readProgress(taskID: string): ProgressInfo | undefined {
  const path = getProgressPath(taskID)
  if (!existsSync(path)) return undefined
  const data = readFileSync(path, "utf-8")
  return JSON.parse(data)
}

function writeProgress(taskID: string, progress: ProgressInfo): void {
  ensureDir()
  const path = getProgressPath(taskID)
  writeFileSync(path, JSON.stringify(progress, null, 2))
}

function createEmptyProgress(): ProgressInfo {
  return {
    overall: {
      total: 0,
      completed: 0,
      running: 0,
      failed: 0,
      percentage: 0,
    },
    current: null,
    history: [],
  }
}

// Generate progress bar
function generateProgressBar(percentage: number, width: number = 50): string {
  const filled = Math.round((percentage / 100) * width)
  const empty = width - filled
  return "█".repeat(filled) + "░".repeat(empty)
}

// Format time duration
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分钟`
}

// Format progress display
function formatProgressDisplay(taskID: string, progress: ProgressInfo): string {
  const lines: string[] = []
  const width = 60

  lines.push("┌" + "─".repeat(width - 2) + "┐")
  lines.push("│ 执行进度" + " ".repeat(width - 12) + "│")
  lines.push("├" + "─".repeat(width - 2) + "┤")

  // Overall progress
  const { overall } = progress
  lines.push(`│ 整体进度：${overall.completed}/${overall.total} 任务完成 (${overall.percentage}%)` + " ".repeat(width - 30 - String(overall.completed).length - String(overall.total).length - String(overall.percentage).length) + "│")
  lines.push("│ " + generateProgressBar(overall.percentage, width - 4) + " │")
  lines.push("├" + "─".repeat(width - 2) + "┤")

  // Current task
  if (progress.current) {
    const { current } = progress
    lines.push(`│ 当前任务：${current.taskName}` + " ".repeat(width - 14 - current.taskName.length) + "│")
    lines.push(`│ 状态：${current.status === "running" ? "执行中" : current.status}` + " ".repeat(width - 10 - (current.status === "running" ? 3 : current.status.length)) + "│")
    lines.push(`│ 进度：${current.progress}%` + " ".repeat(width - 10 - String(current.progress).length) + "│")
    lines.push("│ " + generateProgressBar(current.progress, width - 4) + " │")
    if (current.estimatedTime) {
      lines.push(`│ 预计剩余：${formatDuration(current.estimatedTime)}` + " ".repeat(width - 16 - formatDuration(current.estimatedTime).length) + "│")
    }
    lines.push("├" + "─".repeat(width - 2) + "┤")
  }

  // History
  if (progress.history.length > 0) {
    lines.push("│ 历史任务：" + " ".repeat(width - 14) + "│")
    for (const item of progress.history.slice(-5)) {
      const icon = item.status === "completed" ? "✓" : item.status === "failed" ? "✗" : "○"
      const line = `${icon} ${item.taskName} (${formatDuration(item.duration)})`
      lines.push("│ " + line + " ".repeat(width - 4 - line.length) + "│")
    }
  }

  lines.push("└" + "─".repeat(width - 2) + "┘")

  return lines.join("\n")
}

export default tool({
  description: `进度显示工具

功能：
- 显示整体进度
- 显示当前任务进度
- 显示历史任务
- 提供进度更新接口`,
  args: {
    action: tool.schema
      .enum(["update", "get", "reset", "display"])
      .describe("操作类型"),
    taskID: tool.schema.string().optional().describe("任务 ID"),
    progress: tool.schema.number().optional().describe("进度（0-100）"),
    message: tool.schema.string().optional().describe("进度消息"),
    currentTask: tool.schema.string().optional().describe("当前任务名称"),
    totalTasks: tool.schema.number().optional().describe("总任务数"),
    taskStatus: tool.schema
      .enum(["pending", "running", "completed", "failed", "cancelled"])
      .optional()
      .describe("任务状态"),
  },
  async execute(args) {
    const taskID = args.taskID || "default"
    const result = (() => {

      switch (args.action) {
      case "update": {
        let progress = readProgress(taskID) || createEmptyProgress()

        // Update current task
        if (args.currentTask) {
          progress.current = {
            taskName: args.currentTask,
            status: args.taskStatus || "running",
            progress: args.progress ?? 0,
            startTime: new Date().toISOString(),
          }
        } else if (progress.current && args.progress !== undefined) {
          progress.current.progress = args.progress
          if (args.taskStatus) {
            progress.current.status = args.taskStatus
          }
        }

        // Update overall stats
        if (args.totalTasks !== undefined) {
          progress.overall.total = args.totalTasks
        }

        // Calculate overall percentage
        if (progress.overall.total > 0) {
          progress.overall.percentage = Math.round(
            (progress.overall.completed / progress.overall.total) * 100
          )
        }

        // Handle task completion
        if (args.taskStatus === "completed" || args.taskStatus === "failed") {
          if (progress.current) {
            const startTime = progress.current.startTime
              ? new Date(progress.current.startTime).getTime()
              : Date.now()
            const duration = Math.round((Date.now() - startTime) / 1000)

            progress.history.push({
              taskName: progress.current.taskName,
              status: args.taskStatus,
              duration,
              result: args.message,
            })

            if (args.taskStatus === "completed") {
              progress.overall.completed++
            } else {
              progress.overall.failed++
            }

            progress.current = null
            progress.overall.running = Math.max(0, progress.overall.running - 1)

            // Recalculate overall percentage
            if (progress.overall.total > 0) {
              progress.overall.percentage = Math.round(
                (progress.overall.completed / progress.overall.total) * 100
              )
            }
          }
        }

        // Handle new task start
        if (args.taskStatus === "running" && args.currentTask) {
          progress.overall.running++
        }

        writeProgress(taskID, progress)

        return {
          success: true,
          message: `Progress updated for task ${taskID}`,
          progress,
          display: formatProgressDisplay(taskID, progress),
        }
      }

      case "get": {
        const progress = readProgress(taskID)
        if (!progress) {
          return {
            success: false,
            message: `No progress found for task ${taskID}`,
          }
        }
        return {
          success: true,
          progress,
          display: formatProgressDisplay(taskID, progress),
        }
      }

      case "reset": {
        const emptyProgress = createEmptyProgress()
        writeProgress(taskID, emptyProgress)
        return {
          success: true,
          message: `Progress reset for task ${taskID}`,
          progress: emptyProgress,
        }
      }

      case "display": {
        const progress = readProgress(taskID) || createEmptyProgress()
        return {
          success: true,
          display: formatProgressDisplay(taskID, progress),
          progress,
        }
      }

      default:
        throw new Error(`Unknown action: ${args.action}`)
      }
    })()
    return { output: JSON.stringify(result, null, 2) }
  },
})

// Export utility functions
export {
  formatProgressDisplay,
  generateProgressBar,
  formatDuration,
  type ProgressInfo,
  type TaskProgress,
}
