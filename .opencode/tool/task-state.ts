/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "fs"
import { join } from "path"

type TaskStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled"

interface Task {
  id: string
  status: TaskStatus
  task: string
  prompt: string
  sessionID?: string
  result?: string
  error?: string
  progress: number
  createdAt: string
  updatedAt: string
  completedAt?: string
  metadata?: Record<string, any>
}

const STATE_DIR = join(process.env.HOME || "~", ".config", "opencode", "tasks")

function ensureDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true })
  }
}

function getTaskPath(taskID: string): string {
  return join(STATE_DIR, `${taskID}.json`)
}

function readTask(taskID: string): Task | undefined {
  const path = getTaskPath(taskID)
  if (!existsSync(path)) return undefined
  const data = readFileSync(path, "utf-8")
  return JSON.parse(data)
}

function writeTask(task: Task): void {
  ensureDir()
  const path = getTaskPath(task.id)
  writeFileSync(path, JSON.stringify(task, null, 2))
}

function listTasks(): Task[] {
  if (!existsSync(STATE_DIR)) return []
  const files = readdirSync(STATE_DIR)
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const data = readFileSync(join(STATE_DIR, f), "utf-8")
      return JSON.parse(data)
    })
}

function deleteTask(taskID: string): void {
  const path = getTaskPath(taskID)
  if (existsSync(path)) {
    unlinkSync(path)
  }
}

function generateTaskID(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `task-${timestamp}-${random}`
}

export default tool({
  description: `Manage asynchronous task state

Features:
- Create task records
- Query task status
- Update task state
- Delete task records
- Cleanup expired tasks

Storage location: ~/.config/opencode/tasks/`,
  args: {
    action: tool.schema
      .enum(["create", "get", "list", "update", "delete", "cleanup"])
      .describe("Operation type"),
    taskID: tool.schema.string().optional().describe("Task ID"),
    task: tool.schema.string().optional().describe("Task description"),
    prompt: tool.schema.string().optional().describe("Task prompt"),
    status: tool.schema
      .enum(["pending", "running", "paused", "completed", "failed", "cancelled"])
      .optional()
      .describe("Task status"),
    result: tool.schema.string().optional().describe("Execution result"),
    error: tool.schema.string().optional().describe("Error message"),
    progress: tool.schema.number().optional().describe("Progress (0-100)"),
    metadata: tool.schema.any().optional().describe("Metadata"),
    maxAgeDays: tool.schema.number().optional().describe("Cleanup threshold (days)"),
    maxCount: tool.schema.number().optional().describe("Max tasks to keep"),
  },
  async execute(args) {
    switch (args.action) {
      case "create": {
        if (!args.task) throw new Error("task is required for create operation")
        const taskID = args.taskID || generateTaskID()
        const now = new Date().toISOString()
        const newTask: Task = {
          id: taskID,
          status: "pending",
          task: args.task,
          prompt: args.prompt || "",
          progress: 0,
          createdAt: now,
          updatedAt: now,
          metadata: args.metadata,
        }
        writeTask(newTask)
        return {
          success: true,
          taskID,
          message: `Task ${taskID} created`,
          task: newTask,
        }
      }

      case "get": {
        if (!args.taskID) throw new Error("taskID is required for get operation")
        const task = readTask(args.taskID)
        if (!task) {
          return {
            success: false,
            message: `Task ${args.taskID} not found`,
          }
        }
        return {
          success: true,
          task,
        }
      }

      case "list": {
        let tasks = listTasks()

        // Filter by status if provided
        if (args.status) {
          tasks = tasks.filter((t) => t.status === args.status)
        }

        // Sort by creation time (newest first)
        tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

        return {
          success: true,
          count: tasks.length,
          tasks,
        }
      }

      case "update": {
        if (!args.taskID) throw new Error("taskID is required for update operation")
        const task = readTask(args.taskID)
        if (!task) {
          return {
            success: false,
            message: `Task ${args.taskID} not found`,
          }
        }

        // Update fields
        if (args.status) task.status = args.status
        if (args.result !== undefined) task.result = args.result
        if (args.error !== undefined) task.error = args.error
        if (args.progress !== undefined) task.progress = args.progress
        if (args.metadata) task.metadata = { ...task.metadata, ...args.metadata }
        task.updatedAt = new Date().toISOString()

        // Set completion time for terminal states
        if (args.status === "completed" || args.status === "failed" || args.status === "cancelled") {
          task.completedAt = new Date().toISOString()
          if (args.status === "completed") {
            task.progress = 100
          }
        }

        writeTask(task)
        return {
          success: true,
          message: `Task ${args.taskID} updated`,
          task,
        }
      }

      case "delete": {
        if (!args.taskID) throw new Error("taskID is required for delete operation")
        const task = readTask(args.taskID)
        if (!task) {
          return {
            success: false,
            message: `Task ${args.taskID} not found`,
          }
        }
        deleteTask(args.taskID)
        return {
          success: true,
          message: `Task ${args.taskID} deleted`,
        }
      }

      case "cleanup": {
        const maxAgeDays = args.maxAgeDays ?? 7
        const maxCount = args.maxCount ?? 1000
        const terminalStatuses: TaskStatus[] = ["completed", "failed", "cancelled"]

        let tasks = listTasks()

        // Filter to terminal states only
        const terminalTasks = tasks.filter((t) => terminalStatuses.includes(t.status))

        // Find expired tasks
        const now = Date.now()
        const maxAge = maxAgeDays * 24 * 60 * 60 * 1000
        const expiredTasks = terminalTasks.filter((t) => {
          const createdAt = new Date(t.createdAt).getTime()
          return now - createdAt > maxAge
        })

        // Delete expired tasks
        for (const task of expiredTasks) {
          deleteTask(task.id)
        }

        // Check max count limit
        let remaining = listTasks()
        let excessDeleted = 0
        if (remaining.length > maxCount) {
          remaining.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          const toDelete = remaining.slice(maxCount)
          for (const task of toDelete) {
            deleteTask(task.id)
          }
          excessDeleted = toDelete.length
          remaining = remaining.slice(0, maxCount)
        }

        return {
          success: true,
          message: `Cleanup completed`,
          deleted: {
            expired: expiredTasks.length,
            excess: excessDeleted,
            total: expiredTasks.length + excessDeleted,
          },
          kept: remaining.length,
        }
      }

      default:
        throw new Error(`Unknown action: ${args.action}`)
    }
  },
})
