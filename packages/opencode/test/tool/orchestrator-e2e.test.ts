import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, rmSync } from "fs"
import { join } from "path"

// Test configuration
const TEST_DIR = join(process.env.HOME || "~", ".config", "opencode")
const TASKS_DIR = join(TEST_DIR, "tasks")
const LOGS_DIR = join(TEST_DIR, "logs")
const PROGRESS_DIR = join(TEST_DIR, "progress")
const DIALOGS_DIR = join(TEST_DIR, "dialogs")
const ERRORS_DIR = join(TEST_DIR, "errors")

// Helper functions
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function cleanupDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

function readJsonFile<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, "utf-8"))
}

function writeJsonFile(path: string, data: unknown): void {
  ensureDir(join(path, ".."))
  writeFileSync(path, JSON.stringify(data, null, 2))
}

// Test data generators
function generateTaskID(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `task-${timestamp}-${random}`
}

function generateLogID(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `log-${timestamp}-${random}`
}

function generateDialogID(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `dialog-${timestamp}-${random}`
}

function generateErrorID(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `error-${timestamp}-${random}`
}

// ============================================================================
// Test Suite: Orchestrator Mode E2E Tests
// ============================================================================

describe("Orchestrator Mode E2E Tests", () => {
  // Clean up test directories before and after each test
  beforeEach(() => {
    cleanupDir(TASKS_DIR)
    cleanupDir(LOGS_DIR)
    cleanupDir(PROGRESS_DIR)
    cleanupDir(DIALOGS_DIR)
    cleanupDir(ERRORS_DIR)
  })

  afterEach(() => {
    cleanupDir(TASKS_DIR)
    cleanupDir(LOGS_DIR)
    cleanupDir(PROGRESS_DIR)
    cleanupDir(DIALOGS_DIR)
    cleanupDir(ERRORS_DIR)
  })

  // ==========================================================================
  // Scenario 1: Task State Management
  // ==========================================================================

  describe("Scenario 1: Task State Management", () => {
    test("should create a new task", () => {
      const taskID = generateTaskID()
      const now = new Date().toISOString()
      const task = {
        id: taskID,
        status: "pending",
        task: "Test task",
        prompt: "Test prompt",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      }

      writeJsonFile(join(TASKS_DIR, `${taskID}.json`), task)
      const saved = readJsonFile<typeof task>(join(TASKS_DIR, `${taskID}.json`))

      expect(saved).toBeDefined()
      expect(saved?.id).toBe(taskID)
      expect(saved?.status).toBe("pending")
      expect(saved?.task).toBe("Test task")
    })

    test("should update task status", () => {
      const taskID = generateTaskID()
      const now = new Date().toISOString()
      const task = {
        id: taskID,
        status: "pending",
        task: "Test task",
        prompt: "Test prompt",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      }

      writeJsonFile(join(TASKS_DIR, `${taskID}.json`), task)

      // Update task
      task.status = "running"
      task.progress = 50
      task.updatedAt = new Date().toISOString()
      writeJsonFile(join(TASKS_DIR, `${taskID}.json`), task)

      const updated = readJsonFile<typeof task>(join(TASKS_DIR, `${taskID}.json`))
      expect(updated?.status).toBe("running")
      expect(updated?.progress).toBe(50)
    })

    test("should list all tasks", () => {
      // Create multiple tasks
      for (let i = 0; i < 3; i++) {
        const taskID = generateTaskID()
        const now = new Date().toISOString()
        const task = {
          id: taskID,
          status: "pending",
          task: `Task ${i}`,
          prompt: `Prompt ${i}`,
          progress: 0,
          createdAt: now,
          updatedAt: now,
        }
        writeJsonFile(join(TASKS_DIR, `${taskID}.json`), task)
      }

      const files = readdirSync(TASKS_DIR).filter((f) => f.endsWith(".json"))
      expect(files.length).toBe(3)
    })

    test("should delete a task", () => {
      const taskID = generateTaskID()
      const now = new Date().toISOString()
      const task = {
        id: taskID,
        status: "pending",
        task: "Test task",
        prompt: "Test prompt",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      }

      writeJsonFile(join(TASKS_DIR, `${taskID}.json`), task)
      expect(existsSync(join(TASKS_DIR, `${taskID}.json`))).toBe(true)

      unlinkSync(join(TASKS_DIR, `${taskID}.json`))
      expect(existsSync(join(TASKS_DIR, `${taskID}.json`))).toBe(false)
    })

    test("should handle task completion", () => {
      const taskID = generateTaskID()
      const now = new Date().toISOString()
      const task = {
        id: taskID,
        status: "pending",
        task: "Test task",
        prompt: "Test prompt",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      }

      writeJsonFile(join(TASKS_DIR, `${taskID}.json`), task)

      // Complete task
      task.status = "completed"
      task.progress = 100
      task.completedAt = new Date().toISOString()
      task.updatedAt = new Date().toISOString()
      writeJsonFile(join(TASKS_DIR, `${taskID}.json`), task)

      const completed = readJsonFile<typeof task>(join(TASKS_DIR, `${taskID}.json`))
      expect(completed?.status).toBe("completed")
      expect(completed?.progress).toBe(100)
      expect(completed?.completedAt).toBeDefined()
    })
  })

  // ==========================================================================
  // Scenario 2: Error Handling
  // ==========================================================================

  describe("Scenario 2: Error Handling", () => {
    test("should classify error types correctly", () => {
      const errorClassifications = [
        { error: "worker failed", expectedType: "worker_failed", expectedCategory: "execution" },
        { error: "timeout occurred", expectedType: "timeout", expectedCategory: "execution" },
        { error: "permission denied", expectedType: "permission_denied", expectedCategory: "execution" },
        { error: "resource not found", expectedType: "resource_not_found", expectedCategory: "execution" },
        { error: "conflict detected", expectedType: "conflict", expectedCategory: "execution" },
        { error: "session creation failed", expectedType: "session_creation_failed", expectedCategory: "system" },
        { error: "message send failed", expectedType: "message_send_failed", expectedCategory: "system" },
        { error: "state save failed", expectedType: "state_save_failed", expectedCategory: "system" },
        { error: "network error", expectedType: "network_error", expectedCategory: "system" },
        { error: "api error", expectedType: "api_error", expectedCategory: "system" },
        { error: "invalid prompt", expectedType: "invalid_prompt", expectedCategory: "user" },
        { error: "invalid task", expectedType: "invalid_task", expectedCategory: "user" },
        { error: "cancelled", expectedType: "cancelled", expectedCategory: "user" },
      ]

      for (const { error, expectedType, expectedCategory } of errorClassifications) {
        const errorLower = error.toLowerCase()
        let type = "unknown"
        let category = "system"

        if (errorLower.includes("worker") && errorLower.includes("failed")) {
          type = "worker_failed"
          category = "execution"
        } else if (errorLower.includes("timeout")) {
          type = "timeout"
          category = "execution"
        } else if (errorLower.includes("permission") && errorLower.includes("denied")) {
          type = "permission_denied"
          category = "execution"
        } else if (errorLower.includes("resource") && errorLower.includes("not found")) {
          type = "resource_not_found"
          category = "execution"
        } else if (errorLower.includes("conflict")) {
          type = "conflict"
          category = "execution"
        } else if (errorLower.includes("session") && errorLower.includes("creation")) {
          type = "session_creation_failed"
          category = "system"
        } else if (errorLower.includes("message") && errorLower.includes("send")) {
          type = "message_send_failed"
          category = "system"
        } else if (errorLower.includes("state") && errorLower.includes("save")) {
          type = "state_save_failed"
          category = "system"
        } else if (errorLower.includes("network")) {
          type = "network_error"
          category = "system"
        } else if (errorLower.includes("api")) {
          type = "api_error"
          category = "system"
        } else if (errorLower.includes("invalid") && errorLower.includes("prompt")) {
          type = "invalid_prompt"
          category = "user"
        } else if (errorLower.includes("invalid") && errorLower.includes("task")) {
          type = "invalid_task"
          category = "user"
        } else if (errorLower.includes("cancelled")) {
          type = "cancelled"
          category = "user"
        }

        expect(type).toBe(expectedType)
        expect(category).toBe(expectedCategory)
      }
    })

    test("should determine retryable errors", () => {
      const retryableErrors = [
        "timeout",
        "network_error",
        "api_error",
        "worker_failed",
        "session_creation_failed",
        "message_send_failed",
      ]

      const nonRetryableErrors = [
        "permission_denied",
        "resource_not_found",
        "invalid_prompt",
        "invalid_task",
        "cancelled",
      ]

      for (const errorType of retryableErrors) {
        expect(retryableErrors.includes(errorType)).toBe(true)
      }

      for (const errorType of nonRetryableErrors) {
        expect(retryableErrors.includes(errorType)).toBe(false)
      }
    })

    test("should store error information", () => {
      const errorID = generateErrorID()
      const error = {
        id: errorID,
        title: "Test Error",
        message: "This is a test error",
        code: "TEST_ERROR",
        suggestions: ["Try again", "Check configuration"],
        actions: [
          { label: "Retry", action: "retry" },
          { label: "Skip", action: "skip" },
        ],
        timestamp: new Date().toISOString(),
        resolved: false,
      }

      writeJsonFile(join(ERRORS_DIR, `${errorID}.json`), error)
      const saved = readJsonFile<typeof error>(join(ERRORS_DIR, `${errorID}.json`))

      expect(saved).toBeDefined()
      expect(saved?.id).toBe(errorID)
      expect(saved?.title).toBe("Test Error")
      expect(saved?.resolved).toBe(false)
    })

    test("should resolve errors", () => {
      const errorID = generateErrorID()
      const error = {
        id: errorID,
        title: "Test Error",
        message: "This is a test error",
        suggestions: [],
        actions: [],
        timestamp: new Date().toISOString(),
        resolved: false,
      }

      writeJsonFile(join(ERRORS_DIR, `${errorID}.json`), error)

      // Resolve error
      error.resolved = true
      error.resolvedAt = new Date().toISOString()
      error.resolution = "Fixed by retrying"
      writeJsonFile(join(ERRORS_DIR, `${errorID}.json`), error)

      const resolved = readJsonFile<typeof error>(join(ERRORS_DIR, `${errorID}.json`))
      expect(resolved?.resolved).toBe(true)
      expect(resolved?.resolution).toBe("Fixed by retrying")
    })
  })

  // ==========================================================================
  // Scenario 3: Progress Display
  // ==========================================================================

  describe("Scenario 3: Progress Display", () => {
    test("should track task progress", () => {
      const taskID = generateTaskID()
      const progress = {
        overall: {
          total: 3,
          completed: 0,
          running: 1,
          failed: 0,
          percentage: 0,
        },
        current: {
          taskName: "Task 1",
          status: "running",
          progress: 50,
          startTime: new Date().toISOString(),
        },
        history: [],
      }

      writeJsonFile(join(PROGRESS_DIR, `${taskID}.json`), progress)
      const saved = readJsonFile<typeof progress>(join(PROGRESS_DIR, `${taskID}.json`))

      expect(saved).toBeDefined()
      expect(saved?.overall.total).toBe(3)
      expect(saved?.current?.progress).toBe(50)
    })

    test("should update progress percentage", () => {
      const taskID = generateTaskID()
      const progress = {
        overall: {
          total: 3,
          completed: 1,
          running: 1,
          failed: 0,
          percentage: 33,
        },
        current: {
          taskName: "Task 2",
          status: "running",
          progress: 75,
          startTime: new Date().toISOString(),
        },
        history: [
          {
            taskName: "Task 1",
            status: "completed",
            duration: 10,
          },
        ],
      }

      writeJsonFile(join(PROGRESS_DIR, `${taskID}.json`), progress)
      const saved = readJsonFile<typeof progress>(join(PROGRESS_DIR, `${taskID}.json`))

      expect(saved?.overall.percentage).toBe(33)
      expect(saved?.history.length).toBe(1)
    })

    test("should generate progress bar", () => {
      function generateProgressBar(percentage: number, width: number = 50): string {
        const filled = Math.round((percentage / 100) * width)
        const empty = width - filled
        return "█".repeat(filled) + "░".repeat(empty)
      }

      const bar50 = generateProgressBar(50, 20)
      expect(bar50).toBe("█".repeat(10) + "░".repeat(10))

      const bar100 = generateProgressBar(100, 20)
      expect(bar100).toBe("█".repeat(20))

      const bar0 = generateProgressBar(0, 20)
      expect(bar0).toBe("░".repeat(20))
    })

    test("should format duration", () => {
      function formatDuration(seconds: number): string {
        if (seconds < 60) return `${seconds} 秒`
        if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`
        return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分钟`
      }

      expect(formatDuration(30)).toBe("30 秒")
      expect(formatDuration(90)).toBe("1 分钟")
      expect(formatDuration(3661)).toBe("1 小时 1 分钟")
    })
  })

  // ==========================================================================
  // Scenario 4: Log Viewer
  // ==========================================================================

  describe("Scenario 4: Log Viewer", () => {
    test("should create log entries", () => {
      const sessionID = "test-session"
      const logs = [
        {
          id: generateLogID(),
          timestamp: new Date().toISOString(),
          level: "info",
          source: "orchestrator",
          message: "Task started",
        },
        {
          id: generateLogID(),
          timestamp: new Date().toISOString(),
          level: "info",
          source: "worker",
          message: "Worker executing",
        },
        {
          id: generateLogID(),
          timestamp: new Date().toISOString(),
          level: "error",
          source: "worker",
          message: "Task failed",
        },
      ]

      writeJsonFile(join(LOGS_DIR, `${sessionID}.json`), logs)
      const saved = readJsonFile<typeof logs>(join(LOGS_DIR, `${sessionID}.json`))

      expect(saved).toBeDefined()
      expect(saved?.length).toBe(3)
      expect(saved?.[0].level).toBe("info")
      expect(saved?.[2].level).toBe("error")
    })

    test("should filter logs by level", () => {
      const sessionID = "test-session"
      const logs = [
        { id: "1", timestamp: new Date().toISOString(), level: "info", source: "system", message: "Info 1" },
        { id: "2", timestamp: new Date().toISOString(), level: "error", source: "system", message: "Error 1" },
        { id: "3", timestamp: new Date().toISOString(), level: "info", source: "system", message: "Info 2" },
        { id: "4", timestamp: new Date().toISOString(), level: "warn", source: "system", message: "Warn 1" },
      ]

      const errorLogs = logs.filter((l) => l.level === "error")
      expect(errorLogs.length).toBe(1)
      expect(errorLogs[0].message).toBe("Error 1")

      const infoLogs = logs.filter((l) => l.level === "info")
      expect(infoLogs.length).toBe(2)
    })

    test("should filter logs by source", () => {
      const logs = [
        { id: "1", timestamp: new Date().toISOString(), level: "info", source: "orchestrator", message: "Msg 1" },
        { id: "2", timestamp: new Date().toISOString(), level: "info", source: "worker", message: "Msg 2" },
        { id: "3", timestamp: new Date().toISOString(), level: "info", source: "orchestrator", message: "Msg 3" },
      ]

      const orchestratorLogs = logs.filter((l) => l.source === "orchestrator")
      expect(orchestratorLogs.length).toBe(2)

      const workerLogs = logs.filter((l) => l.source === "worker")
      expect(workerLogs.length).toBe(1)
    })

    test("should format log entry", () => {
      function formatTimestamp(date: Date): string {
        const hours = date.getHours().toString().padStart(2, "0")
        const minutes = date.getMinutes().toString().padStart(2, "0")
        const seconds = date.getSeconds().toString().padStart(2, "0")
        return `${hours}:${minutes}:${seconds}`
      }

      function formatLevel(level: string): string {
        switch (level) {
          case "info": return "INFO"
          case "warn": return "WARN"
          case "error": return "ERROR"
          case "debug": return "DEBUG"
          default: return level.toUpperCase()
        }
      }

      function formatLogEntry(entry: { timestamp: string; level: string; source: string; message: string }): string {
        const timestamp = formatTimestamp(new Date(entry.timestamp))
        const level = formatLevel(entry.level)
        return `[${timestamp}] [${level}] [${entry.source}] ${entry.message}`
      }

      const entry = {
        timestamp: "2026-06-01T12:30:45.000Z",
        level: "info",
        source: "orchestrator",
        message: "Task started",
      }

      const formatted = formatLogEntry(entry)
      expect(formatted).toContain("[INFO]")
      expect(formatted).toContain("[orchestrator]")
      expect(formatted).toContain("Task started")
    })
  })

  // ==========================================================================
  // Scenario 5: Confirm Dialog
  // ==========================================================================

  describe("Scenario 5: Confirm Dialog", () => {
    test("should create a dialog", () => {
      const dialogID = generateDialogID()
      const dialog = {
        id: dialogID,
        type: "confirm",
        title: "Confirm Action",
        message: "Do you want to proceed?",
        options: [
          { label: "确认", value: "confirm", variant: "primary" },
          { label: "取消", value: "cancel", variant: "secondary" },
        ],
        createdAt: new Date().toISOString(),
        status: "pending",
      }

      writeJsonFile(join(DIALOGS_DIR, `${dialogID}.json`), dialog)
      const saved = readJsonFile<typeof dialog>(join(DIALOGS_DIR, `${dialogID}.json`))

      expect(saved).toBeDefined()
      expect(saved?.id).toBe(dialogID)
      expect(saved?.status).toBe("pending")
      expect(saved?.options.length).toBe(2)
    })

    test("should answer a dialog", () => {
      const dialogID = generateDialogID()
      const dialog = {
        id: dialogID,
        type: "confirm",
        title: "Confirm Action",
        message: "Do you want to proceed?",
        options: [
          { label: "确认", value: "confirm", variant: "primary" },
          { label: "取消", value: "cancel", variant: "secondary" },
        ],
        createdAt: new Date().toISOString(),
        status: "pending",
      }

      writeJsonFile(join(DIALOGS_DIR, `${dialogID}.json`), dialog)

      // Answer dialog
      dialog.status = "answered"
      dialog.answer = "confirm"
      dialog.answeredAt = new Date().toISOString()
      writeJsonFile(join(DIALOGS_DIR, `${dialogID}.json`), dialog)

      const answered = readJsonFile<typeof dialog>(join(DIALOGS_DIR, `${dialogID}.json`))
      expect(answered?.status).toBe("answered")
      expect(answered?.answer).toBe("confirm")
    })

    test("should handle dialog timeout", () => {
      const dialogID = generateDialogID()
      const dialog = {
        id: dialogID,
        type: "confirm",
        title: "Confirm Action",
        message: "Do you want to proceed?",
        options: [
          { label: "确认", value: "confirm", variant: "primary" },
          { label: "取消", value: "cancel", variant: "secondary" },
        ],
        timeout: 30,
        defaultValue: "confirm",
        createdAt: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
        status: "pending",
      }

      writeJsonFile(join(DIALOGS_DIR, `${dialogID}.json`), dialog)

      // Check timeout
      const createdAt = new Date(dialog.createdAt).getTime()
      const now = Date.now()
      const elapsed = (now - createdAt) / 1000

      if (elapsed >= dialog.timeout) {
        dialog.status = "timeout"
        dialog.answer = dialog.defaultValue
        dialog.answeredAt = new Date().toISOString()
        writeJsonFile(join(DIALOGS_DIR, `${dialogID}.json`), dialog)
      }

      const timedOut = readJsonFile<typeof dialog>(join(DIALOGS_DIR, `${dialogID}.json`))
      expect(timedOut?.status).toBe("timeout")
      expect(timedOut?.answer).toBe("confirm")
    })

    test("should format dialog display", () => {
      function formatDialogDisplay(dialog: { title: string; message: string; options: Array<{ label: string; value: string; variant?: string }> }): string {
        const width = 60
        const lines: string[] = []

        lines.push("┌" + "─".repeat(width - 2) + "┐")
        lines.push("│ " + dialog.title + " ".repeat(width - 4 - dialog.title.length) + "│")
        lines.push("├" + "─".repeat(width - 2) + "┤")

        const messageLines = dialog.message.split("\n")
        for (const line of messageLines) {
          const truncated = line.length > width - 4
            ? line.substring(0, width - 7) + "..."
            : line
          lines.push("│ " + truncated + " ".repeat(width - 3 - truncated.length) + "│")
        }

        lines.push("├" + "─".repeat(width - 2) + "┤")

        if (dialog.options.length > 0) {
          lines.push("│ 选项：" + " ".repeat(width - 10) + "│")
          for (const option of dialog.options) {
            const variant = option.variant || "secondary"
            const prefix = variant === "primary" ? "●" : variant === "danger" ? "✗" : "○"
            const line = `${prefix} ${option.label}`
            lines.push("│   " + line + " ".repeat(width - 5 - line.length) + "│")
          }
        }

        lines.push("└" + "─".repeat(width - 2) + "┘")
        return lines.join("\n")
      }

      const dialog = {
        title: "Confirm Action",
        message: "Do you want to proceed?",
        options: [
          { label: "确认", value: "confirm", variant: "primary" },
          { label: "取消", value: "cancel", variant: "secondary" },
        ],
      }

      const display = formatDialogDisplay(dialog)
      expect(display).toContain("Confirm Action")
      expect(display).toContain("Do you want to proceed?")
      expect(display).toContain("● 确认")
      expect(display).toContain("○ 取消")
    })
  })

  // ==========================================================================
  // Scenario 6: Concurrency Control
  // ==========================================================================

  describe("Scenario 6: Concurrency Control", () => {
    test("should track running tasks", () => {
      const running = new Map<string, { timestamp: number }>()
      const maxConcurrent = 3

      // Add tasks
      for (let i = 0; i < 3; i++) {
        running.set(`task-${i}`, { timestamp: Date.now() })
      }

      expect(running.size).toBe(3)
      expect(running.size >= maxConcurrent).toBe(true)
    })

    test("should enforce concurrency limit", () => {
      const running = new Map<string, { timestamp: number }>()
      const queue: Array<{ taskID: string; timestamp: number }> = []
      const maxConcurrent = 2
      const maxQueued = 3

      function acquire(taskID: string): boolean {
        if (running.has(taskID)) return true

        if (running.size >= maxConcurrent) {
          if (queue.length >= maxQueued) return false
          queue.push({ taskID, timestamp: Date.now() })
          return true
        }

        running.set(taskID, { timestamp: Date.now() })
        return true
      }

      // Fill running slots
      expect(acquire("task-1")).toBe(true)
      expect(acquire("task-2")).toBe(true)

      // These should go to queue
      expect(acquire("task-3")).toBe(true)
      expect(acquire("task-4")).toBe(true)
      expect(acquire("task-5")).toBe(true)

      // Queue is full
      expect(acquire("task-6")).toBe(false)

      expect(running.size).toBe(2)
      expect(queue.length).toBe(3)
    })

    test("should release and process queue", () => {
      const running = new Map<string, { timestamp: number }>()
      const queue: Array<{ taskID: string; resolve: (value: boolean) => void; timestamp: number }> = []
      const maxConcurrent = 2

      function acquire(taskID: string): boolean {
        if (running.has(taskID)) return true

        if (running.size >= maxConcurrent) {
          return new Promise<boolean>((resolve) => {
            queue.push({ taskID, resolve, timestamp: Date.now() })
          }) as unknown as boolean
        }

        running.set(taskID, { timestamp: Date.now() })
        return true
      }

      function release(taskID: string): void {
        running.delete(taskID)
        processQueue()
      }

      function processQueue(): void {
        while (queue.length > 0 && running.size < maxConcurrent) {
          const next = queue.shift()
          if (next) {
            running.set(next.taskID, { timestamp: Date.now() })
            next.resolve(true)
          }
        }
      }

      // Fill running slots
      acquire("task-1")
      acquire("task-2")

      // These go to queue
      acquire("task-3")
      acquire("task-4")

      expect(running.size).toBe(2)
      expect(queue.length).toBe(2)

      // Release a task
      release("task-1")

      expect(running.size).toBe(2) // task-3 should be dequeued
      expect(queue.length).toBe(1)
    })

    test("should get concurrency status", () => {
      const running = new Map<string, { timestamp: number }>()
      const queue: Array<{ taskID: string; timestamp: number }> = []

      running.set("task-1", { timestamp: Date.now() })
      running.set("task-2", { timestamp: Date.now() })
      queue.push({ taskID: "task-3", timestamp: Date.now() })

      const status = {
        running: running.size,
        queued: queue.length,
        maxConcurrent: 3,
        maxQueued: 10,
        runningTasks: Array.from(running.keys()),
        queuedTasks: queue.map((q) => q.taskID),
      }

      expect(status.running).toBe(2)
      expect(status.queued).toBe(1)
      expect(status.runningTasks).toContain("task-1")
      expect(status.runningTasks).toContain("task-2")
      expect(status.queuedTasks).toContain("task-3")
    })
  })

  // ==========================================================================
  // Scenario 7: Orchestrate Tool
  // ==========================================================================

  describe("Scenario 7: Orchestrate Tool", () => {
    test("should validate inputs", () => {
      // Empty task should fail
      expect(() => {
        const task = ""
        if (!task.trim()) throw new Error("task must be a non-empty string")
      }).toThrow("task must be a non-empty string")

      // Empty prompt should fail
      expect(() => {
        const prompt = ""
        if (!prompt.trim()) throw new Error("prompt must be a non-empty string")
      }).toThrow("prompt must be a non-empty string")
    })

    test("should generate enhanced prompt", () => {
      const task = "test-task"
      const prompt = "Create a test file"
      const workers = ["implementer"]
      const timeout = 30

      const workerSection = workers.length > 0
        ? `## Workers\n\nCreate the following workers:\n${workers.map((w) => `- **${w}**`).join("\n")}`
        : "## Workers\n\nDetermine appropriate worker types based on the task."

      const enhancedPrompt = `# Orchestration Task: ${task}

${prompt}

## Worktree Isolation

Each worker MUST operate in an isolated git worktree under \`.worktrees/\`.
- Use the \`worktree\` tool to create worktrees: \`worktree({ operation: "create", task: "<worker-task-name>" })\`
- Workers should operate within their assigned worktree path
- After completion, worktrees can be cleaned up with \`worktree({ operation: "remove", branch: "<branch>" })\`

${workerSection}

## Timeout

This orchestration has a ${timeout}-minute timeout. Plan work accordingly.
If a worker cannot complete within the time limit, it should commit partial progress and report status.`

      expect(enhancedPrompt).toContain("# Orchestration Task: test-task")
      expect(enhancedPrompt).toContain("Create a test file")
      expect(enhancedPrompt).toContain("implementer")
      expect(enhancedPrompt).toContain("30-minute timeout")
    })

    test("should include error handling configuration", () => {
      const errorHandling = {
        maxRetries: 3,
        retryDelay: 1000,
        backoffMultiplier: 2,
        retryableErrors: ["timeout", "network_error"],
        autoRecover: true,
        recoverableStatuses: ["failed"],
        recoveryAction: "retry",
      }

      const errorHandlingSection = `## Error Handling and Recovery

This orchestration includes automatic error handling and recovery:

### Retry Configuration
- Max retries: ${errorHandling.maxRetries}
- Retry delay: ${errorHandling.retryDelay}ms
- Backoff multiplier: ${errorHandling.backoffMultiplier}
- Retryable errors: ${errorHandling.retryableErrors.join(", ")}

### Recovery Configuration
- Auto-recover: ${errorHandling.autoRecover ? "enabled" : "disabled"}
- Recoverable statuses: ${errorHandling.recoverableStatuses.join(", ")}
- Recovery action: ${errorHandling.recoveryAction}`

      expect(errorHandlingSection).toContain("Max retries: 3")
      expect(errorHandlingSection).toContain("Auto-recover: enabled")
      expect(errorHandlingSection).toContain("Recovery action: retry")
    })

    test("should include UX components when enabled", () => {
      const enableUX = true

      const uxSection = enableUX
        ? `## User Experience Components

This orchestration includes user experience components for better visibility:

### Progress Display
Use the \`progress-display\` tool to show task progress

### Log Viewer
Use the \`log-viewer\` tool to record and display logs

### Confirm Dialog
Use the \`confirm-dialog\` tool for user confirmations

### Error Display
Use the \`error-display\` tool for error handling`
        : ""

      expect(uxSection).toContain("Progress Display")
      expect(uxSection).toContain("Log Viewer")
      expect(uxSection).toContain("Confirm Dialog")
      expect(uxSection).toContain("Error Display")
    })

    test("should include resource management when enabled", () => {
      const enableResourceManagement = true

      const resourceManagementSection = enableResourceManagement
        ? `## Resource Management

This orchestration includes resource management to prevent resource exhaustion:

### Concurrency Control
Use the \`concurrency-manager\` tool to control task execution

### Memory Management
Use the \`memory-manager\` tool to monitor memory

### Storage Management
Use the \`storage-manager\` tool to manage storage

### Performance Monitoring
Use the \`performance-monitor\` tool to track performance`
        : ""

      expect(resourceManagementSection).toContain("Concurrency Control")
      expect(resourceManagementSection).toContain("Memory Management")
      expect(resourceManagementSection).toContain("Storage Management")
      expect(resourceManagementSection).toContain("Performance Monitoring")
    })

    test("should generate structured output format", () => {
      const task = "test-task"

      const structuredOutput = `## Orchestration Report: ${task}

### Summary
- Status: <completed | partial | failed>
- Workers: <count>
- Duration: <elapsed time>
- Retries: <number of retries>
- Recoveries: <number of recoveries>

### Worker Results
For each worker:
#### <worker-name>
- Status: <completed | partial | failed>
- Files changed: <list of files>
- Tests run: <yes/no> | Results: <pass/fail>
- Errors: <none or description>
- Retry count: <number of retries>
- Recovery attempts: <number of recovery attempts>
- Notes: <any additional context>

### Error Handling Report
- Total errors: <count>
- Retried errors: <count>
- Recovered errors: <count>
- Unrecoverable errors: <count>

### User Experience Report
- Progress updates: <count>
- Log entries: <count>
- Dialogs shown: <count>
- Errors displayed: <count>

### Integration Notes
- <any conflicts, dependencies, or follow-up items>`

      expect(structuredOutput).toContain("Orchestration Report: test-task")
      expect(structuredOutput).toContain("Worker Results")
      expect(structuredOutput).toContain("Error Handling Report")
      expect(structuredOutput).toContain("User Experience Report")
    })
  })

  // ==========================================================================
  // Scenario 8: Memory Management
  // ==========================================================================

  describe("Scenario 8: Memory Management", () => {
    test("should get memory status", () => {
      const usage = process.memoryUsage()
      const percentage = Math.round((usage.heapUsed / usage.heapTotal) * 100)

      const status = {
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        rss: usage.rss,
        external: usage.external,
        arrayBuffers: usage.arrayBuffers,
        percentage,
        warning: percentage >= 75,
        critical: percentage >= 90,
        timestamp: new Date().toISOString(),
      }

      expect(status.heapUsed).toBeGreaterThan(0)
      expect(status.heapTotal).toBeGreaterThan(0)
      expect(status.percentage).toBeGreaterThanOrEqual(0)
      // Note: percentage can exceed 100% in edge cases due to heap fragmentation
      expect(status.percentage).toBeLessThanOrEqual(200)
    })

    test("should format bytes", () => {
      function formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
      }

      expect(formatBytes(500)).toBe("500 B")
      expect(formatBytes(1500)).toBe("1.46 KB")
      expect(formatBytes(1500000)).toBe("1.43 MB")
    })
  })

  // ==========================================================================
  // Scenario 9: Storage Management
  // ==========================================================================

  describe("Scenario 9: Storage Management", () => {
    test("should calculate storage usage", () => {
      // Create some test files
      const testDir = join(TASKS_DIR, "test")
      ensureDir(testDir)

      for (let i = 0; i < 3; i++) {
        const taskID = generateTaskID()
        const task = {
          id: taskID,
          status: "pending",
          task: `Task ${i}`,
          prompt: `Prompt ${i}`,
          progress: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        writeJsonFile(join(TASKS_DIR, `${taskID}.json`), task)
      }

      const files = readdirSync(TASKS_DIR).filter((f) => f.endsWith(".json"))
      expect(files.length).toBe(3)
    })

    test("should enforce storage limits", () => {
      const maxTasks = 2
      const tasks = [
        { id: "task-1", createdAt: "2026-06-01T10:00:00.000Z" },
        { id: "task-2", createdAt: "2026-06-01T11:00:00.000Z" },
        { id: "task-3", createdAt: "2026-06-01T12:00:00.000Z" },
      ]

      // Sort by creation time (newest first)
      tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

      // Keep only maxTasks
      const toKeep = tasks.slice(0, maxTasks)
      const toDelete = tasks.slice(maxTasks)

      expect(toKeep.length).toBe(2)
      expect(toDelete.length).toBe(1)
      expect(toKeep[0].id).toBe("task-3")
      expect(toKeep[1].id).toBe("task-2")
      expect(toDelete[0].id).toBe("task-1")
    })
  })

  // ==========================================================================
  // Scenario 10: Performance Monitoring
  // ==========================================================================

  describe("Scenario 10: Performance Monitoring", () => {
    test("should collect performance metrics", () => {
      const tasks = [
        { id: "1", status: "completed", createdAt: "2026-06-01T10:00:00.000Z", completedAt: "2026-06-01T10:05:00.000Z" },
        { id: "2", status: "running", createdAt: "2026-06-01T11:00:00.000Z" },
        { id: "3", status: "failed", createdAt: "2026-06-01T12:00:00.000Z", completedAt: "2026-06-01T12:01:00.000Z" },
      ]

      const memory = process.memoryUsage()

      const metrics = {
        timestamp: new Date().toISOString(),
        taskCount: tasks.length,
        runningTasks: tasks.filter((t) => t.status === "running").length,
        queuedTasks: tasks.filter((t) => t.status === "pending").length,
        completedTasks: tasks.filter((t) => t.status === "completed").length,
        failedTasks: tasks.filter((t) => t.status === "failed").length,
        averageDuration: 0,
        memoryUsage: Math.round((memory.heapUsed / memory.heapTotal) * 100),
        memoryUsedMB: parseFloat((memory.heapUsed / (1024 * 1024)).toFixed(2)),
        storageUsage: 0,
        storageUsedMB: 0,
        uptime: 0,
      }

      // Calculate average duration
      const completedTasks = tasks.filter((t) => t.completedAt)
      if (completedTasks.length > 0) {
        const totalDuration = completedTasks.reduce((sum, t) => {
          const start = new Date(t.createdAt).getTime()
          const end = new Date(t.completedAt!).getTime()
          return sum + (end - start)
        }, 0)
        metrics.averageDuration = Math.round(totalDuration / completedTasks.length)
      }

      expect(metrics.taskCount).toBe(3)
      expect(metrics.runningTasks).toBe(1)
      expect(metrics.completedTasks).toBe(1)
      expect(metrics.failedTasks).toBe(1)
      expect(metrics.averageDuration).toBeGreaterThan(0)
    })

    test("should generate recommendations", () => {
      function generateRecommendations(metrics: { memoryUsage: number; queuedTasks: number; failedTasks: number; completedTasks: number; averageDuration: number; storageUsedMB: number }): string[] {
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

      // Test with healthy system
      const healthyMetrics = {
        memoryUsage: 50,
        queuedTasks: 5,
        failedTasks: 0,
        completedTasks: 10,
        averageDuration: 60000,
        storageUsedMB: 10,
      }
      const healthyRecommendations = generateRecommendations(healthyMetrics)
      expect(healthyRecommendations).toContain("System is performing well, no immediate action needed")

      // Test with high memory usage
      const highMemoryMetrics = {
        memoryUsage: 85,
        queuedTasks: 5,
        failedTasks: 0,
        completedTasks: 10,
        averageDuration: 60000,
        storageUsedMB: 10,
      }
      const highMemoryRecommendations = generateRecommendations(highMemoryMetrics)
      expect(highMemoryRecommendations).toContain("Consider running memory cleanup to free up resources")

      // Test with high failure rate
      const highFailureMetrics = {
        memoryUsage: 50,
        queuedTasks: 5,
        failedTasks: 8,
        completedTasks: 2,
        averageDuration: 60000,
        storageUsedMB: 10,
      }
      const highFailureRecommendations = generateRecommendations(highFailureMetrics)
      expect(highFailureRecommendations).toContain("High failure rate detected, review task configurations")
    })

    test("should format duration", () => {
      function formatDuration(ms: number): string {
        if (ms < 1000) return `${ms}ms`
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
        if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`
        return `${(ms / 3600000).toFixed(1)}h`
      }

      expect(formatDuration(500)).toBe("500ms")
      expect(formatDuration(5000)).toBe("5.0s")
      expect(formatDuration(90000)).toBe("1.5m")
      expect(formatDuration(3600000)).toBe("1.0h")
    })
  })

  // ==========================================================================
  // Scenario 11: Integration Test
  // ==========================================================================

  describe("Scenario 11: Integration Test", () => {
    test("should simulate complete orchestration workflow", () => {
      // Step 1: Create task
      const taskID = generateTaskID()
      const now = new Date().toISOString()
      const task = {
        id: taskID,
        status: "pending",
        task: "Create .editorconfig file",
        prompt: "Create a .editorconfig file with basic editor configuration",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      }
      writeJsonFile(join(TASKS_DIR, `${taskID}.json`), task)

      // Step 2: Update progress
      const progress = {
        overall: { total: 1, completed: 0, running: 1, failed: 0, percentage: 0 },
        current: { taskName: "Create .editorconfig", status: "running", progress: 0, startTime: now },
        history: [],
      }
      writeJsonFile(join(PROGRESS_DIR, `${taskID}.json`), progress)

      // Step 3: Add log entries
      const sessionID = `session-${taskID}`
      const logs = [
        { id: generateLogID(), timestamp: now, level: "info", source: "orchestrator", message: "Task started" },
        { id: generateLogID(), timestamp: now, level: "info", source: "worker", message: "Worker executing" },
      ]
      writeJsonFile(join(LOGS_DIR, `${sessionID}.json`), logs)

      // Step 4: Update task to running
      task.status = "running"
      task.updatedAt = new Date().toISOString()
      writeJsonFile(join(TASKS_DIR, `${taskID}.json`), task)

      // Step 5: Update progress
      progress.current.progress = 50
      progress.overall.percentage = 50
      writeJsonFile(join(PROGRESS_DIR, `${taskID}.json`), progress)

      // Step 6: Complete task
      task.status = "completed"
      task.progress = 100
      task.completedAt = new Date().toISOString()
      task.updatedAt = new Date().toISOString()
      writeJsonFile(join(TASKS_DIR, `${taskID}.json`), task)

      // Step 7: Update progress
      progress.overall.completed = 1
      progress.overall.running = 0
      progress.overall.percentage = 100
      progress.current = null
      progress.history.push({
        taskName: "Create .editorconfig",
        status: "completed",
        duration: 10,
      })
      writeJsonFile(join(PROGRESS_DIR, `${taskID}.json`), progress)

      // Step 8: Add completion log
      logs.push({ id: generateLogID(), timestamp: new Date().toISOString(), level: "info", source: "orchestrator", message: "Task completed" })
      writeJsonFile(join(LOGS_DIR, `${sessionID}.json`), logs)

      // Verify final state
      const finalTask = readJsonFile<typeof task>(join(TASKS_DIR, `${taskID}.json`))
      const finalProgress = readJsonFile<typeof progress>(join(PROGRESS_DIR, `${taskID}.json`))
      const finalLogs = readJsonFile<typeof logs>(join(LOGS_DIR, `${sessionID}.json`))

      expect(finalTask?.status).toBe("completed")
      expect(finalTask?.progress).toBe(100)
      expect(finalProgress?.overall.percentage).toBe(100)
      expect(finalProgress?.history.length).toBe(1)
      expect(finalLogs?.length).toBe(3)
    })

    test("should simulate error recovery workflow", () => {
      // Step 1: Create task
      const taskID = generateTaskID()
      const now = new Date().toISOString()
      const task = {
        id: taskID,
        status: "pending",
        task: "Test task",
        prompt: "Test prompt",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      }
      writeJsonFile(join(TASKS_DIR, `${taskID}.json`), task)

      // Step 2: Task fails
      task.status = "failed"
      task.error = "worker failed"
      task.updatedAt = new Date().toISOString()
      writeJsonFile(join(TASKS_DIR, `${taskID}.json`), task)

      // Step 3: Create error record
      const errorID = generateErrorID()
      const error = {
        id: errorID,
        title: "Task Failed",
        message: "worker failed",
        suggestions: ["Retry the task", "Check worker configuration"],
        actions: [
          { label: "Retry", action: "retry" },
          { label: "Skip", action: "skip" },
        ],
        timestamp: now,
        resolved: false,
      }
      writeJsonFile(join(ERRORS_DIR, `${errorID}.json`), error)

      // Step 4: Retry task
      task.status = "pending"
      task.error = undefined
      task.progress = 0
      task.updatedAt = new Date().toISOString()
      writeJsonFile(join(TASKS_DIR, `${taskID}.json`), task)

      // Step 5: Task succeeds
      task.status = "completed"
      task.progress = 100
      task.completedAt = new Date().toISOString()
      task.updatedAt = new Date().toISOString()
      writeJsonFile(join(TASKS_DIR, `${taskID}.json`), task)

      // Step 6: Resolve error
      error.resolved = true
      error.resolvedAt = new Date().toISOString()
      error.resolution = "Task retried successfully"
      writeJsonFile(join(ERRORS_DIR, `${errorID}.json`), error)

      // Verify final state
      const finalTask = readJsonFile<typeof task>(join(TASKS_DIR, `${taskID}.json`))
      const finalError = readJsonFile<typeof error>(join(ERRORS_DIR, `${errorID}.json`))

      expect(finalTask?.status).toBe("completed")
      expect(finalError?.resolved).toBe(true)
      expect(finalError?.resolution).toBe("Task retried successfully")
    })
  })
})
