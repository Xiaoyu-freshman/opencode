/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "fs"
import { join } from "path"

// Log entry structure
interface LogEntry {
  id: string
  timestamp: string
  level: "info" | "warn" | "error" | "debug"
  source: string
  message: string
  details?: any
}

// Storage configuration
const STATE_DIR = join(process.env.HOME || "~", ".config", "opencode", "logs")

function ensureDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true })
  }
}

function getLogPath(sessionID: string): string {
  return join(STATE_DIR, `${sessionID}.json`)
}

function readLogs(sessionID: string): LogEntry[] {
  const path = getLogPath(sessionID)
  if (!existsSync(path)) return []
  const data = readFileSync(path, "utf-8")
  return JSON.parse(data)
}

function writeLogs(sessionID: string, logs: LogEntry[]): void {
  ensureDir()
  const path = getLogPath(sessionID)
  writeFileSync(path, JSON.stringify(logs, null, 2))
}

function generateLogID(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `log-${timestamp}-${random}`
}

// Format timestamp
function formatTimestamp(date: Date): string {
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  const seconds = date.getSeconds().toString().padStart(2, "0")
  return `${hours}:${minutes}:${seconds}`
}

// Format log level
function formatLevel(level: string): string {
  switch (level) {
    case "info":
      return "INFO"
    case "warn":
      return "WARN"
    case "error":
      return "ERROR"
    case "debug":
      return "DEBUG"
    default:
      return level.toUpperCase()
  }
}

// Format log entry for display
function formatLogEntry(entry: LogEntry): string {
  const timestamp = formatTimestamp(new Date(entry.timestamp))
  const level = formatLevel(entry.level)
  return `[${timestamp}] [${level}] [${entry.source}] ${entry.message}`
}

// Format log display
function formatLogDisplay(sessionID: string, logs: LogEntry[], filter?: { level?: string; source?: string }): string {
  const width = 60
  const lines: string[] = []

  lines.push("┌" + "─".repeat(width - 2) + "┐")
  lines.push("│ 执行日志" + " ".repeat(width - 12) + "│")
  lines.push("├" + "─".repeat(width - 2) + "┤")

  let filteredLogs = logs
  if (filter?.level) {
    filteredLogs = filteredLogs.filter((l) => l.level === filter.level)
  }
  if (filter?.source) {
    filteredLogs = filteredLogs.filter((l) => l.source === filter.source)
  }

  if (filteredLogs.length === 0) {
    lines.push("│ 暂无日志" + " ".repeat(width - 12) + "│")
  } else {
    // Show last 20 logs
    const recentLogs = filteredLogs.slice(-20)
    for (const entry of recentLogs) {
      const formatted = formatLogEntry(entry)
      // Truncate if too long
      const truncated = formatted.length > width - 4
        ? formatted.substring(0, width - 7) + "..."
        : formatted
      lines.push("│ " + truncated + " ".repeat(width - 3 - truncated.length) + "│")
    }
  }

  lines.push("└" + "─".repeat(width - 2) + "┘")

  return lines.join("\n")
}

export default tool({
  description: `日志展示工具

功能：
- 记录日志
- 查询日志
- 过滤日志
- 导出日志`,
  args: {
    action: tool.schema
      .enum(["log", "get", "list", "filter", "export", "clear"])
      .describe("操作类型"),
    sessionID: tool.schema.string().optional().describe("会话 ID"),
    level: tool.schema.enum(["info", "warn", "error", "debug"]).optional().describe("日志级别"),
    source: tool.schema.string().optional().describe("日志来源"),
    message: tool.schema.string().optional().describe("日志消息"),
    details: tool.schema.any().optional().describe("详细信息"),
    filters: tool.schema.any().optional().describe("过滤条件"),
  },
  async execute(args) {
    const sessionID = args.sessionID || "default"

    switch (args.action) {
      case "log": {
        if (!args.message) {
          throw new Error("message is required for log operation")
        }

        const logs = readLogs(sessionID)
        const newEntry: LogEntry = {
          id: generateLogID(),
          timestamp: new Date().toISOString(),
          level: args.level || "info",
          source: args.source || "system",
          message: args.message,
          details: args.details,
        }

        logs.push(newEntry)
        writeLogs(sessionID, logs)

        return {
          success: true,
          message: "Log entry added",
          entry: newEntry,
          display: formatLogEntry(newEntry),
        }
      }

      case "get": {
        const logs = readLogs(sessionID)
        const recentLogs = logs.slice(-50) // Return last 50 logs

        return {
          success: true,
          count: recentLogs.length,
          logs: recentLogs,
          display: formatLogDisplay(sessionID, recentLogs),
        }
      }

      case "list": {
        // List all log sessions
        if (!existsSync(STATE_DIR)) {
          return {
            success: true,
            sessions: [],
          }
        }

        const files = readdirSync(STATE_DIR)
        const sessions = files
          .filter((f) => f.endsWith(".json"))
          .map((f) => {
            const sessionID = f.replace(".json", "")
            const logs = readLogs(sessionID)
            return {
              sessionID,
              logCount: logs.length,
              lastLog: logs.length > 0 ? logs[logs.length - 1] : null,
            }
          })

        return {
          success: true,
          count: sessions.length,
          sessions,
        }
      }

      case "filter": {
        const logs = readLogs(sessionID)
        const filters = args.filters || {}
        let filteredLogs = logs

        if (filters.level) {
          filteredLogs = filteredLogs.filter((l) => l.level === filters.level)
        }
        if (filters.source) {
          filteredLogs = filteredLogs.filter((l) => l.source === filters.source)
        }
        if (filters.startTime) {
          const startTime = new Date(filters.startTime).getTime()
          filteredLogs = filteredLogs.filter(
            (l) => new Date(l.timestamp).getTime() >= startTime
          )
        }
        if (filters.endTime) {
          const endTime = new Date(filters.endTime).getTime()
          filteredLogs = filteredLogs.filter(
            (l) => new Date(l.timestamp).getTime() <= endTime
          )
        }
        if (filters.search) {
          const searchLower = filters.search.toLowerCase()
          filteredLogs = filteredLogs.filter(
            (l) =>
              l.message.toLowerCase().includes(searchLower) ||
              (l.details && JSON.stringify(l.details).toLowerCase().includes(searchLower))
          )
        }

        return {
          success: true,
          count: filteredLogs.length,
          logs: filteredLogs,
          display: formatLogDisplay(sessionID, filteredLogs, filters),
        }
      }

      case "export": {
        const logs = readLogs(sessionID)
        const exportPath = join(STATE_DIR, `export-${sessionID}-${Date.now()}.json`)
        writeFileSync(exportPath, JSON.stringify(logs, null, 2))

        return {
          success: true,
          message: `Logs exported to ${exportPath}`,
          path: exportPath,
          count: logs.length,
        }
      }

      case "clear": {
        writeLogs(sessionID, [])
        return {
          success: true,
          message: `Logs cleared for session ${sessionID}`,
        }
      }

      default:
        throw new Error(`Unknown action: ${args.action}`)
    }
  },
})

// Export utility functions
export {
  formatLogEntry,
  formatLogDisplay,
  formatTimestamp,
  formatLevel,
  type LogEntry,
}
