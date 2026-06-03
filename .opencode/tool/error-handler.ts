/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"

// Error type definitions
type ErrorCategory = "execution" | "system" | "user"

interface ErrorInfo {
  type: string
  category: ErrorCategory
  retryable: boolean
  recoverable: boolean
  message: string
}

interface RetryConfig {
  maxRetries: number
  retryDelay: number
  backoffMultiplier: number
  retryableErrors: string[]
}

interface RecoveryConfig {
  autoRecover: boolean
  recoverableStatuses: string[]
  recoveryAction: "retry" | "resume" | "restart"
}

// Default retry configuration
const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  retryDelay: 1000,
  backoffMultiplier: 2,
  retryableErrors: [
    "timeout",
    "network_error",
    "api_error",
    "worker_failed",
    "session_creation_failed",
    "message_send_failed",
  ],
}

// Default recovery configuration
const defaultRecoveryConfig: RecoveryConfig = {
  autoRecover: true,
  recoverableStatuses: ["failed"],
  recoveryAction: "retry",
}

// Error classification function
function classifyError(error: string): ErrorInfo {
  const errorLower = error.toLowerCase()

  // Execution errors
  if (errorLower.includes("worker") && errorLower.includes("failed")) {
    return {
      type: "worker_failed",
      category: "execution",
      retryable: true,
      recoverable: true,
      message: error,
    }
  }
  if (errorLower.includes("timeout")) {
    return {
      type: "timeout",
      category: "execution",
      retryable: true,
      recoverable: true,
      message: error,
    }
  }
  if (errorLower.includes("permission") && errorLower.includes("denied")) {
    return {
      type: "permission_denied",
      category: "execution",
      retryable: false,
      recoverable: false,
      message: error,
    }
  }
  if (errorLower.includes("resource") && errorLower.includes("not found")) {
    return {
      type: "resource_not_found",
      category: "execution",
      retryable: false,
      recoverable: false,
      message: error,
    }
  }
  if (errorLower.includes("conflict")) {
    return {
      type: "conflict",
      category: "execution",
      retryable: true,
      recoverable: true,
      message: error,
    }
  }

  // System errors
  if (errorLower.includes("session") && errorLower.includes("creation")) {
    return {
      type: "session_creation_failed",
      category: "system",
      retryable: true,
      recoverable: true,
      message: error,
    }
  }
  if (errorLower.includes("message") && errorLower.includes("send")) {
    return {
      type: "message_send_failed",
      category: "system",
      retryable: true,
      recoverable: true,
      message: error,
    }
  }
  if (errorLower.includes("state") && errorLower.includes("save")) {
    return {
      type: "state_save_failed",
      category: "system",
      retryable: true,
      recoverable: true,
      message: error,
    }
  }
  if (errorLower.includes("network")) {
    return {
      type: "network_error",
      category: "system",
      retryable: true,
      recoverable: true,
      message: error,
    }
  }
  if (errorLower.includes("api")) {
    return {
      type: "api_error",
      category: "system",
      retryable: true,
      recoverable: true,
      message: error,
    }
  }

  // User errors
  if (errorLower.includes("invalid") && errorLower.includes("prompt")) {
    return {
      type: "invalid_prompt",
      category: "user",
      retryable: false,
      recoverable: false,
      message: error,
    }
  }
  if (errorLower.includes("invalid") && errorLower.includes("task")) {
    return {
      type: "invalid_task",
      category: "user",
      retryable: false,
      recoverable: false,
      message: error,
    }
  }
  if (errorLower.includes("cancelled")) {
    return {
      type: "cancelled",
      category: "user",
      retryable: false,
      recoverable: false,
      message: error,
    }
  }

  // Default: unknown error
  return {
    type: "unknown",
    category: "system",
    retryable: false,
    recoverable: false,
    message: error,
  }
}

// Sleep utility
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Execute with retry mechanism
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = defaultRetryConfig
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      // Check if error is retryable
      const errorInfo = classifyError(lastError.message)
      if (
        !errorInfo.retryable ||
        !config.retryableErrors.includes(errorInfo.type)
      ) {
        throw error
      }

      // Check if max retries reached
      if (attempt >= config.maxRetries) {
        throw error
      }

      // Calculate delay with exponential backoff
      const delay = config.retryDelay * Math.pow(config.backoffMultiplier, attempt)

      console.log(
        `Execution failed, retrying in ${delay}ms (${attempt + 1}/${config.maxRetries})...`
      )
      await sleep(delay)
    }
  }

  throw lastError
}

// Task state interface (simplified for error handler)
interface TaskState {
  id: string
  status: string
  task: string
  prompt: string
  result?: string
  error?: string
  progress: number
  metadata?: Record<string, any>
}

// Read task from state storage
function readTaskState(taskID: string): TaskState | undefined {
  const stateDir = join(process.env.HOME || "~", ".config", "opencode", "tasks")
  const taskPath = join(stateDir, `${taskID}.json`)

  if (!existsSync(taskPath)) return undefined

  const data = readFileSync(taskPath, "utf-8")
  return JSON.parse(data)
}

// Write task to state storage
function writeTaskState(task: TaskState): void {
  const stateDir = join(process.env.HOME || "~", ".config", "opencode", "tasks")
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true })
  }

  const taskPath = join(stateDir, `${task.id}.json`)
  writeFileSync(taskPath, JSON.stringify(task, null, 2))
}

// Update task state
function updateTaskState(
  taskID: string,
  updates: Partial<TaskState>
): TaskState | undefined {
  const task = readTaskState(taskID)
  if (!task) return undefined

  const updatedTask = { ...task, ...updates }
  writeTaskState(updatedTask)
  return updatedTask
}

// Notify error
function notifyError(
  taskID: string,
  error: string,
  errorInfo: ErrorInfo
): void {
  // Update task state with error information
  updateTaskState(taskID, {
    status: "failed",
    error,
    metadata: {
      errorType: errorInfo.type,
      errorCategory: errorInfo.category,
      retryable: errorInfo.retryable,
      recoverable: errorInfo.recoverable,
    },
  })

  // Output error information
  console.error(`[Error] Task ${taskID} failed:`)
  console.error(`  Type: ${errorInfo.type}`)
  console.error(`  Category: ${errorInfo.category}`)
  console.error(`  Message: ${error}`)
  console.error(`  Retryable: ${errorInfo.retryable ? "Yes" : "No"}`)
  console.error(`  Recoverable: ${errorInfo.recoverable ? "Yes" : "No"}`)

  // Provide suggestions
  if (errorInfo.retryable) {
    console.log(`[Suggestion] You can try to retry the task`)
  }
  if (errorInfo.recoverable) {
    console.log(`[Suggestion] You can try to recover the task`)
  }
}

// Retry task
async function retryTask(taskID: string): Promise<void> {
  const task = readTaskState(taskID)
  if (!task) {
    throw new Error(`Task ${taskID} not found`)
  }

  // Reset task state
  updateTaskState(taskID, {
    status: "pending",
    error: undefined,
    progress: 0,
  })

  console.log(`Task ${taskID} has been reset to pending state`)
}

// Resume task
async function resumeTask(taskID: string): Promise<void> {
  const task = readTaskState(taskID)
  if (!task) {
    throw new Error(`Task ${taskID} not found`)
  }

  // Update status to running
  updateTaskState(taskID, {
    status: "running",
  })

  console.log(`Task ${taskID} has been resumed`)
}

// Restart task
async function restartTask(taskID: string): Promise<void> {
  const task = readTaskState(taskID)
  if (!task) {
    throw new Error(`Task ${taskID} not found`)
  }

  // Reset task state completely
  updateTaskState(taskID, {
    status: "pending",
    error: undefined,
    result: undefined,
    progress: 0,
  })

  console.log(`Task ${taskID} has been restarted`)
}

// Recover task
async function recoverTask(
  taskID: string,
  config: RecoveryConfig = defaultRecoveryConfig
): Promise<void> {
  const task = readTaskState(taskID)
  if (!task) {
    throw new Error(`Task ${taskID} not found`)
  }

  // Check if task is recoverable
  if (!config.recoverableStatuses.includes(task.status)) {
    throw new Error(
      `Task ${taskID} has status ${task.status}, which is not recoverable`
    )
  }

  // Execute recovery action
  switch (config.recoveryAction) {
    case "retry":
      await retryTask(taskID)
      break

    case "resume":
      await resumeTask(taskID)
      break

    case "restart":
      await restartTask(taskID)
      break

    default:
      throw new Error(`Unknown recovery action: ${config.recoveryAction}`)
  }
}

// Export tool
export default tool({
  description: `Error handling and recovery tool

Features:
- Error classification and handling
- Automatic retry with exponential backoff
- Task recovery mechanisms
- Error notification

Use this tool to handle errors in orchestrated tasks.`,
  args: {
    action: tool.schema
      .enum(["classify", "retry", "recover", "notify", "execute-with-retry"])
      .describe("Operation type"),
    taskID: tool.schema.string().optional().describe("Task ID"),
    error: tool.schema.string().optional().describe("Error message"),
    errorType: tool.schema.string().optional().describe("Error type"),
    retryConfig: tool.schema.any().optional().describe("Retry configuration"),
    recoveryConfig: tool.schema
      .any()
      .optional()
      .describe("Recovery configuration"),
    fn: tool.schema.any().optional().describe("Function to execute with retry"),
  },
  async execute(args) {
    const result = await (async () => {
      switch (args.action) {
      case "classify": {
        if (!args.error) {
          throw new Error("error is required for classify operation")
        }
        const errorInfo = classifyError(args.error)
        return {
          success: true,
          errorInfo,
        }
      }

      case "retry": {
        if (!args.taskID) {
          throw new Error("taskID is required for retry operation")
        }
        await retryTask(args.taskID)
        return {
          success: true,
          message: `Task ${args.taskID} has been reset for retry`,
        }
      }

      case "recover": {
        if (!args.taskID) {
          throw new Error("taskID is required for recover operation")
        }
        const recoveryConfig = args.recoveryConfig || defaultRecoveryConfig
        await recoverTask(args.taskID, recoveryConfig)
        return {
          success: true,
          message: `Task ${args.taskID} has been recovered`,
        }
      }

      case "notify": {
        if (!args.taskID) {
          throw new Error("taskID is required for notify operation")
        }
        if (!args.error) {
          throw new Error("error is required for notify operation")
        }
        const errorInfo = classifyError(args.error)
        notifyError(args.taskID, args.error, errorInfo)
        return {
          success: true,
          message: `Error notification sent for task ${args.taskID}`,
          errorInfo,
        }
      }

      case "execute-with-retry": {
        if (!args.fn) {
          throw new Error("fn is required for execute-with-retry operation")
        }
        const retryConfig = args.retryConfig || defaultRetryConfig
        const result = await executeWithRetry(args.fn, retryConfig)
        return {
          success: true,
          result,
        }
      }

      default:
        throw new Error(`Unknown action: ${args.action}`)
      }
    })()
    return { output: JSON.stringify(result, null, 2) }
  },
})

// Export utility functions for use by other tools
export {
  classifyError,
  executeWithRetry,
  notifyError,
  recoverTask,
  retryTask,
  resumeTask,
  restartTask,
  sleep,
  type ErrorInfo,
  type RetryConfig,
  type RecoveryConfig,
  defaultRetryConfig,
  defaultRecoveryConfig,
}
