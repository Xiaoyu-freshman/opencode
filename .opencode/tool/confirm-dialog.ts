/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"

// Dialog option structure
interface DialogOption {
  label: string
  value: string
  description?: string
  variant?: "primary" | "secondary" | "danger"
}

// Dialog data structure
interface DialogData {
  id: string
  type: "confirm" | "prompt"
  title: string
  message: string
  details?: string
  options: DialogOption[]
  timeout?: number
  defaultValue?: string
  createdAt: string
  status: "pending" | "answered" | "timeout"
  answer?: string
  answeredAt?: string
}

// Storage configuration
const STATE_DIR = join(process.env.HOME || "~", ".config", "opencode", "dialogs")

function ensureDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true })
  }
}

function getDialogPath(dialogID: string): string {
  return join(STATE_DIR, `${dialogID}.json`)
}

function readDialog(dialogID: string): DialogData | undefined {
  const path = getDialogPath(dialogID)
  if (!existsSync(path)) return undefined
  const data = readFileSync(path, "utf-8")
  return JSON.parse(data)
}

function writeDialog(dialog: DialogData): void {
  ensureDir()
  const path = getDialogPath(dialog.id)
  writeFileSync(path, JSON.stringify(dialog, null, 2))
}

function generateDialogID(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `dialog-${timestamp}-${random}`
}

// Format dialog display
function formatDialogDisplay(dialog: DialogData): string {
  const width = 60
  const lines: string[] = []

  lines.push("┌" + "─".repeat(width - 2) + "┐")
  lines.push("│ " + dialog.title + " ".repeat(width - 4 - dialog.title.length) + "│")
  lines.push("├" + "─".repeat(width - 2) + "┤")

  // Message
  const messageLines = dialog.message.split("\n")
  for (const line of messageLines) {
    const truncated = line.length > width - 4
      ? line.substring(0, width - 7) + "..."
      : line
    lines.push("│ " + truncated + " ".repeat(width - 3 - truncated.length) + "│")
  }

  // Details
  if (dialog.details) {
    lines.push("│" + " ".repeat(width - 2) + "│")
    const detailLines = dialog.details.split("\n")
    for (const line of detailLines) {
      const truncated = line.length > width - 4
        ? line.substring(0, width - 7) + "..."
        : line
      lines.push("│ " + truncated + " ".repeat(width - 3 - truncated.length) + "│")
    }
  }

  lines.push("├" + "─".repeat(width - 2) + "┤")

  // Options
  if (dialog.options.length > 0) {
    lines.push("│ 选项：" + " ".repeat(width - 10) + "│")
    for (let i = 0; i < dialog.options.length; i++) {
      const option = dialog.options[i]
      const variant = option.variant || "secondary"
      const prefix = variant === "primary" ? "●" : variant === "danger" ? "✗" : "○"
      const line = `${prefix} ${option.label}${option.description ? ` - ${option.description}` : ""}`
      const truncated = line.length > width - 4
        ? line.substring(0, width - 7) + "..."
        : line
      lines.push("│   " + truncated + " ".repeat(width - 5 - truncated.length) + "│")
    }
  }

  // Timeout info
  if (dialog.timeout) {
    lines.push("├" + "─".repeat(width - 2) + "┤")
    lines.push(`│ 超时时间：${dialog.timeout} 秒` + " ".repeat(width - 16 - String(dialog.timeout).length) + "│")
  }

  // Status
  if (dialog.status === "answered") {
    lines.push("├" + "─".repeat(width - 2) + "┤")
    lines.push(`│ 已选择：${dialog.answer}` + " ".repeat(width - 12 - (dialog.answer?.length || 0)) + "│")
  } else if (dialog.status === "timeout") {
    lines.push("├" + "─".repeat(width - 2) + "┤")
    lines.push("│ 已超时，使用默认值" + " ".repeat(width - 22) + "│")
  }

  lines.push("└" + "─".repeat(width - 2) + "┘")

  return lines.join("\n")
}

export default tool({
  description: `确认对话框工具

功能：
- 显示确认对话框
- 收集用户选择
- 支持超时自动确认`,
  args: {
    action: tool.schema
      .enum(["create", "answer", "get", "check", "list"])
      .describe("操作类型"),
    dialogID: tool.schema.string().optional().describe("对话框 ID"),
    type: tool.schema.enum(["confirm", "prompt"]).optional().describe("对话框类型"),
    title: tool.schema.string().optional().describe("对话框标题"),
    message: tool.schema.string().optional().describe("对话框消息"),
    details: tool.schema.string().optional().describe("详细说明"),
    options: tool.schema
      .array(
        tool.schema.object({
          label: tool.schema.string(),
          value: tool.schema.string(),
          description: tool.schema.string().optional(),
          variant: tool.schema.enum(["primary", "secondary", "danger"]).optional(),
        })
      )
      .optional()
      .describe("选项列表"),
    timeout: tool.schema.number().optional().describe("超时时间（秒）"),
    defaultValue: tool.schema.string().optional().describe("默认值"),
    answer: tool.schema.string().optional().describe("用户选择的答案"),
  },
  async execute(args) {
    const result = (() => {
      switch (args.action) {
      case "create": {
        if (!args.title) throw new Error("title is required for create operation")
        if (!args.message) throw new Error("message is required for create operation")

        const dialogID = args.dialogID || generateDialogID()
        const dialog: DialogData = {
          id: dialogID,
          type: args.type || "confirm",
          title: args.title,
          message: args.message,
          details: args.details,
          options: args.options || [
            { label: "确认", value: "confirm", variant: "primary" },
            { label: "取消", value: "cancel", variant: "secondary" },
          ],
          timeout: args.timeout,
          defaultValue: args.defaultValue,
          createdAt: new Date().toISOString(),
          status: "pending",
        }

        writeDialog(dialog)

        return {
          success: true,
          dialogID,
          message: `Dialog created: ${dialogID}`,
          dialog,
          display: formatDialogDisplay(dialog),
        }
      }

      case "answer": {
        if (!args.dialogID) throw new Error("dialogID is required for answer operation")
        if (!args.answer) throw new Error("answer is required for answer operation")

        const dialog = readDialog(args.dialogID)
        if (!dialog) {
          return {
            success: false,
            message: `Dialog ${args.dialogID} not found`,
          }
        }

        if (dialog.status !== "pending") {
          return {
            success: false,
            message: `Dialog ${args.dialogID} is already ${dialog.status}`,
          }
        }

        dialog.status = "answered"
        dialog.answer = args.answer
        dialog.answeredAt = new Date().toISOString()
        writeDialog(dialog)

        return {
          success: true,
          message: `Dialog ${args.dialogID} answered`,
          dialog,
          display: formatDialogDisplay(dialog),
        }
      }

      case "get": {
        if (!args.dialogID) throw new Error("dialogID is required for get operation")

        const dialog = readDialog(args.dialogID)
        if (!dialog) {
          return {
            success: false,
            message: `Dialog ${args.dialogID} not found`,
          }
        }

        return {
          success: true,
          dialog,
          display: formatDialogDisplay(dialog),
        }
      }

      case "check": {
        if (!args.dialogID) throw new Error("dialogID is required for check operation")

        const dialog = readDialog(args.dialogID)
        if (!dialog) {
          return {
            success: false,
            message: `Dialog ${args.dialogID} not found`,
          }
        }

        // Check timeout
        if (dialog.status === "pending" && dialog.timeout) {
          const createdAt = new Date(dialog.createdAt).getTime()
          const now = Date.now()
          const elapsed = (now - createdAt) / 1000

          if (elapsed >= dialog.timeout) {
            dialog.status = "timeout"
            dialog.answer = dialog.defaultValue
            dialog.answeredAt = new Date().toISOString()
            writeDialog(dialog)
          }
        }

        return {
          success: true,
          dialog,
          isAnswered: dialog.status === "answered" || dialog.status === "timeout",
          answer: dialog.answer,
          display: formatDialogDisplay(dialog),
        }
      }

      case "list": {
        if (!existsSync(STATE_DIR)) {
          return {
            success: true,
            dialogs: [],
          }
        }

        const { readdirSync } = require("fs")
        const files = readdirSync(STATE_DIR)
        const dialogs = files
          .filter((f: string) => f.endsWith(".json"))
          .map((f: string) => {
            const dialogID = f.replace(".json", "")
            return readDialog(dialogID)
          })
          .filter((d: DialogData | undefined): d is DialogData => d !== undefined)

        return {
          success: true,
          count: dialogs.length,
          dialogs,
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
  formatDialogDisplay,
  type DialogData,
  type DialogOption,
}
