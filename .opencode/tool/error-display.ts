/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs"
import { join } from "path"

// Error action structure
interface ErrorAction {
  label: string
  action: string
  description?: string
}

// Error data structure
interface ErrorData {
  id: string
  title: string
  message: string
  code?: string
  details?: string
  suggestions: string[]
  actions: ErrorAction[]
  timestamp: string
  resolved: boolean
  resolvedAt?: string
  resolution?: string
}

// Storage configuration
const STATE_DIR = join(process.env.HOME || "~", ".config", "opencode", "errors")

function ensureDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true })
  }
}

function getErrorPath(errorID: string): string {
  return join(STATE_DIR, `${errorID}.json`)
}

function readError(errorID: string): ErrorData | undefined {
  const path = getErrorPath(errorID)
  if (!existsSync(path)) return undefined
  const data = readFileSync(path, "utf-8")
  return JSON.parse(data)
}

function writeError(error: ErrorData): void {
  ensureDir()
  const path = getErrorPath(error.id)
  writeFileSync(path, JSON.stringify(error, null, 2))
}

function generateErrorID(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `error-${timestamp}-${random}`
}

// Format error display
function formatErrorDisplay(error: ErrorData): string {
  const width = 60
  const lines: string[] = []

  lines.push("┌" + "─".repeat(width - 2) + "┐")
  lines.push("│ 错误：" + error.title + " ".repeat(width - 10 - error.title.length) + "│")
  lines.push("├" + "─".repeat(width - 2) + "┤")

  // Error message
  lines.push("│ 错误信息：" + " ".repeat(width - 14) + "│")
  const messageLines = error.message.split("\n")
  for (const line of messageLines) {
    const truncated = line.length > width - 6
      ? line.substring(0, width - 9) + "..."
      : line
    lines.push("│   " + truncated + " ".repeat(width - 5 - truncated.length) + "│")
  }

  // Error code
  if (error.code) {
    lines.push("│" + " ".repeat(width - 2) + "│")
    lines.push("│ 错误代码：" + error.code + " ".repeat(width - 14 - error.code.length) + "│")
  }

  // Details
  if (error.details) {
    lines.push("│" + " ".repeat(width - 2) + "│")
    lines.push("│ 详细说明：" + " ".repeat(width - 14) + "│")
    const detailLines = error.details.split("\n")
    for (const line of detailLines) {
      const truncated = line.length > width - 6
        ? line.substring(0, width - 9) + "..."
        : line
      lines.push("│   " + truncated + " ".repeat(width - 5 - truncated.length) + "│")
    }
  }

  // Suggestions
  if (error.suggestions.length > 0) {
    lines.push("│" + " ".repeat(width - 2) + "│")
    lines.push("│ 建议操作：" + " ".repeat(width - 14) + "│")
    for (let i = 0; i < error.suggestions.length; i++) {
      const suggestion = `${i + 1}. ${error.suggestions[i]}`
      const truncated = suggestion.length > width - 6
        ? suggestion.substring(0, width - 9) + "..."
        : suggestion
      lines.push("│   " + truncated + " ".repeat(width - 5 - truncated.length) + "│")
    }
  }

  lines.push("├" + "─".repeat(width - 2) + "┤")

  // Actions
  if (error.actions.length > 0) {
    const actionLabels = error.actions.map((a) => `[${a.label}]`).join(" ")
    lines.push("│ " + actionLabels + " ".repeat(width - 4 - actionLabels.length) + "│")
  }

  // Resolution status
  if (error.resolved) {
    lines.push("├" + "─".repeat(width - 2) + "┤")
    lines.push("│ 已解决" + " ".repeat(width - 10) + "│")
    if (error.resolution) {
      const truncated = error.resolution.length > width - 6
        ? error.resolution.substring(0, width - 9) + "..."
        : error.resolution
      lines.push("│   " + truncated + " ".repeat(width - 5 - truncated.length) + "│")
    }
  }

  lines.push("└" + "─".repeat(width - 2) + "┘")

  return lines.join("\n")
}

export default tool({
  description: `错误提示工具

功能：
- 显示错误信息
- 提供操作建议
- 支持错误恢复`,
  args: {
    action: tool.schema
      .enum(["show", "suggest", "resolve", "get", "list"])
      .describe("操作类型"),
    errorID: tool.schema.string().optional().describe("错误 ID"),
    title: tool.schema.string().optional().describe("错误标题"),
    message: tool.schema.string().optional().describe("错误消息"),
    code: tool.schema.string().optional().describe("错误代码"),
    details: tool.schema.string().optional().describe("详细说明"),
    suggestions: tool.schema.array(tool.schema.string()).optional().describe("建议操作"),
    actions: tool.schema
      .array(
        tool.schema.object({
          label: tool.schema.string(),
          action: tool.schema.string(),
          description: tool.schema.string().optional(),
        })
      )
      .optional()
      .describe("操作按钮"),
    resolution: tool.schema.string().optional().describe("解决方案"),
  },
  async execute(args) {
    const result = (() => {
      switch (args.action) {
      case "show": {
        if (!args.title) throw new Error("title is required for show operation")
        if (!args.message) throw new Error("message is required for show operation")

        const errorID = args.errorID || generateErrorID()
        const error: ErrorData = {
          id: errorID,
          title: args.title,
          message: args.message,
          code: args.code,
          details: args.details,
          suggestions: args.suggestions || [],
          actions: args.actions || [
            { label: "重试", action: "retry", description: "重新执行任务" },
            { label: "跳过", action: "skip", description: "跳过当前任务" },
            { label: "修改方案", action: "modify", description: "修改执行方案" },
          ],
          timestamp: new Date().toISOString(),
          resolved: false,
        }

        writeError(error)

        return {
          success: true,
          errorID,
          message: `Error displayed: ${errorID}`,
          error,
          display: formatErrorDisplay(error),
        }
      }

      case "suggest": {
        // Provide suggestions based on error type
        const suggestions: string[] = []
        const message = (args.message || "").toLowerCase()

        if (message.includes("permission") || message.includes("权限")) {
          suggestions.push("检查文件权限")
          suggestions.push("使用管理员权限运行")
          suggestions.push("选择其他目录")
        } else if (message.includes("network") || message.includes("网络")) {
          suggestions.push("检查网络连接")
          suggestions.push("稍后重试")
          suggestions.push("使用代理")
        } else if (message.includes("timeout") || message.includes("超时")) {
          suggestions.push("增加超时时间")
          suggestions.push("减少任务复杂度")
          suggestions.push("分批执行")
        } else if (message.includes("file") || message.includes("文件")) {
          suggestions.push("检查文件路径")
          suggestions.push("确认文件存在")
          suggestions.push("检查文件权限")
        } else if (message.includes("memory") || message.includes("内存")) {
          suggestions.push("释放内存")
          suggestions.push("减少并发任务")
          suggestions.push("增加系统内存")
        } else {
          suggestions.push("检查错误信息")
          suggestions.push("重试任务")
          suggestions.push("修改方案")
        }

        return {
          success: true,
          suggestions,
          display: `建议操作：\n${suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
        }
      }

      case "resolve": {
        if (!args.errorID) throw new Error("errorID is required for resolve operation")

        const error = readError(args.errorID)
        if (!error) {
          return {
            success: false,
            message: `Error ${args.errorID} not found`,
          }
        }

        error.resolved = true
        error.resolvedAt = new Date().toISOString()
        error.resolution = args.resolution || "已解决"
        writeError(error)

        return {
          success: true,
          message: `Error ${args.errorID} resolved`,
          error,
          display: formatErrorDisplay(error),
        }
      }

      case "get": {
        if (!args.errorID) throw new Error("errorID is required for get operation")

        const error = readError(args.errorID)
        if (!error) {
          return {
            success: false,
            message: `Error ${args.errorID} not found`,
          }
        }

        return {
          success: true,
          error,
          display: formatErrorDisplay(error),
        }
      }

      case "list": {
        if (!existsSync(STATE_DIR)) {
          return {
            success: true,
            errors: [],
          }
        }

        const files = readdirSync(STATE_DIR)
        const errors = files
          .filter((f) => f.endsWith(".json"))
          .map((f) => {
            const errorID = f.replace(".json", "")
            return readError(errorID)
          })
          .filter((e): e is ErrorData => e !== undefined)

        return {
          success: true,
          count: errors.length,
          errors,
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
  formatErrorDisplay,
  type ErrorData,
  type ErrorAction,
}
