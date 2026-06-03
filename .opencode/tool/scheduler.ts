/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"
import { existsSync } from "fs"
import { mkdir, readFile, rm, writeFile } from "fs/promises"
import { join } from "path"

type SchedulerTaskStatus = "planned" | "running" | "completed" | "failed" | "cancelled"
type WorkerRunStatus = "planned" | "running" | "completed" | "failed" | "cancelled"

type WorkerRun = {
  id: string
  schedulerTaskId: string
  name: string
  subagent_type: string
  description: string
  prompt: string
  status: WorkerRunStatus
  acceptanceCriteria: string[]
  taskID?: string
  resultSummary?: string
  error?: string
  worktreePath?: string
  artifacts: string[]
  createdAt: string
  updatedAt: string
  completedAt?: string
}

type SchedulerTask = {
  id: string
  title: string
  tier: "M" | "L" | "XL"
  status: SchedulerTaskStatus
  repoPath: string
  createdBy: "orchestrator" | "bus"
  riskLevel: "low" | "medium" | "high"
  requiresConfirmation: boolean
  confirmedAt?: string
  maxConcurrentWorkers: number
  acceptanceCriteria: string[]
  validationCommands: string[]
  workerRuns: WorkerRun[]
  events: { at: string; type: string; message: string }[]
  createdAt: string
  updatedAt: string
  completedAt?: string
}

const taskStatuses = ["planned", "running", "completed", "failed", "cancelled"] as const

export default tool({
  description: `Manage C2 Hybrid Scheduler plans and worker result records.

The scheduler stores JSON state under ~/.config/opencode/scheduler by default.
It returns explicit taskCalls for Orchestrator/Bus to execute with the built-in
task tool, then expects Orchestrator/Bus to call scheduler record with results.
It never launches workers, interrupts subagents, removes worktrees, or imports
OpenCode internals.`,
  args: {
    action: tool.schema.enum(["plan", "status", "record", "collect", "cancel", "cleanup"]).describe("Operation type"),
    configDir: tool.schema.string().optional().describe("OpenCode config directory; defaults to ~/.config/opencode"),
    schedulerTaskId: tool.schema.string().optional().describe("Scheduler task ID"),
    title: tool.schema.string().optional().describe("Plan title"),
    tier: tool.schema.enum(["M", "L", "XL"]).optional().describe("Task tier"),
    repoPath: tool.schema.string().optional().describe("Repository path for the scheduled work"),
    createdBy: tool.schema.enum(["orchestrator", "bus"]).optional().describe("Plan creator"),
    riskLevel: tool.schema.enum(["low", "medium", "high"]).optional().describe("Plan risk level"),
    requiresConfirmation: tool.schema.boolean().optional().describe("Whether user confirmation is required"),
    confirmedAt: tool.schema.string().optional().describe("Confirmation timestamp"),
    maxConcurrentWorkers: tool.schema.number().optional().describe("Advisory maximum concurrent workers"),
    acceptanceCriteria: tool.schema.array(tool.schema.string()).optional().describe("Plan acceptance criteria"),
    validationCommands: tool.schema.array(tool.schema.string()).optional().describe("Validation commands Orchestrator/Bus must run"),
    workers: tool.schema.any().optional().describe("Explicit worker list for plan action"),
    workerRunId: tool.schema.string().optional().describe("Worker run ID for record action"),
    status: tool.schema.enum(taskStatuses).optional().describe("Worker status for record action"),
    taskID: tool.schema.string().optional().describe("Built-in task result/session ID recorded by Orchestrator/Bus"),
    resultSummary: tool.schema.string().optional().describe("Worker result summary"),
    error: tool.schema.string().optional().describe("Worker error summary"),
    worktreePath: tool.schema.string().optional().describe("Worker worktree path to record only"),
    artifacts: tool.schema.array(tool.schema.string()).optional().describe("Worker artifact paths or notes to record only"),
  },
  async execute(args, context) {
    const result = await (async () => {
      switch (args.action) {
        case "plan":
          return await plan(args, context)
        case "status":
          return await status(args)
        case "record":
          return await record(args)
        case "collect":
          return await collect(args)
        case "cancel":
          return await cancel(args)
        case "cleanup":
          return await cleanup(args)
      }
    })()

    return {
      output: JSON.stringify(result, null, 2),
      metadata: result,
    }
  },
})

async function plan(args: Record<string, unknown>, context: { directory: string }) {
  if (typeof args.title !== "string" || !args.title.trim()) throw new Error("title is required for plan")
  const workers = normalizeWorkers(args.workers)
  if (workers.length === 0) throw new Error("workers must contain at least one explicit worker for plan")

  const now = new Date().toISOString()
  const task: SchedulerTask = {
    id: typeof args.schedulerTaskId === "string" ? args.schedulerTaskId : generateId("scheduler"),
    title: args.title,
    tier: args.tier === "M" || args.tier === "XL" ? args.tier : "L",
    status: "planned",
    repoPath: typeof args.repoPath === "string" ? args.repoPath : context.directory,
    createdBy: args.createdBy === "bus" ? "bus" : "orchestrator",
    riskLevel: args.riskLevel === "low" || args.riskLevel === "high" ? args.riskLevel : "medium",
    requiresConfirmation: typeof args.requiresConfirmation === "boolean" ? args.requiresConfirmation : true,
    confirmedAt: typeof args.confirmedAt === "string" ? args.confirmedAt : undefined,
    maxConcurrentWorkers: positiveInteger(args.maxConcurrentWorkers) ?? Math.max(1, workers.length),
    acceptanceCriteria: stringArray(args.acceptanceCriteria),
    validationCommands: stringArray(args.validationCommands),
    workerRuns: [],
    events: [{ at: now, type: "planned", message: `Scheduler plan created with ${workers.length} worker run(s)` }],
    createdAt: now,
    updatedAt: now,
  }
  task.workerRuns = workers.map((worker, index) => ({
    id: `${task.id}-worker-${index + 1}`,
    schedulerTaskId: task.id,
    name: worker.name,
    subagent_type: worker.subagent_type,
    description: worker.description,
    prompt: worker.prompt,
    status: "planned",
    acceptanceCriteria: worker.acceptanceCriteria.length > 0 ? worker.acceptanceCriteria : task.acceptanceCriteria,
    artifacts: [],
    createdAt: now,
    updatedAt: now,
  }))

  await writeTask(args, task)
  return {
    success: true,
    schedulerTaskId: task.id,
    task,
    taskCalls: task.workerRuns.map((worker) => ({
      workerRunId: worker.id,
      taskArgs: {
        subagent_type: worker.subagent_type,
        description: worker.description,
        prompt: worker.prompt,
      },
      acceptanceCriteria: worker.acceptanceCriteria,
      recordInstruction:
        "Launch by calling the built-in task tool with taskCalls[i].taskArgs only; do not add task_id and never pass workerRunId as task_id. After task returns, call scheduler record with this workerRunId and the actual ses_* task/session id returned by the task tool if available.",
    })),
  }
}

async function status(args: Record<string, unknown>) {
  const task = await readTask(args)
  return {
    success: true,
    schedulerTaskId: task.id,
    status: task.status,
    workers: task.workerRuns.map((worker) => ({
      workerRunId: worker.id,
      status: worker.status,
      taskID: worker.taskID,
      description: worker.description,
      worktreePath: worker.worktreePath,
    })),
    task,
  }
}

async function record(args: Record<string, unknown>) {
  if (typeof args.workerRunId !== "string") throw new Error("workerRunId is required for record")
  if (!isWorkerStatus(args.status)) throw new Error("status is required for record")
  if (typeof args.taskID === "string" && isLikelyWorkerRunTaskId(args.taskID, args.workerRunId)) {
    throw new Error(
      `Invalid record taskID ${args.taskID}: workerRunId is not built-in task_id. The built-in task_id/session id must be the actual ses_* id returned by the task tool. New worker launches should omit task_id; call the built-in task with taskCalls[i].taskArgs only.`,
    )
  }

  const task = await readTask(args, "record")
  const worker = task.workerRuns.find((item) => item.id === args.workerRunId)
  if (!worker) throw new Error(`Worker run ${args.workerRunId} not found`)

  const now = new Date().toISOString()
  worker.status = args.status
  worker.taskID = typeof args.taskID === "string" ? args.taskID : worker.taskID
  worker.resultSummary = typeof args.resultSummary === "string" ? args.resultSummary : worker.resultSummary
  worker.error = typeof args.error === "string" ? args.error : worker.error
  worker.worktreePath = typeof args.worktreePath === "string" ? args.worktreePath : worker.worktreePath
  worker.artifacts = args.artifacts ? stringArray(args.artifacts) : worker.artifacts
  worker.updatedAt = now
  worker.completedAt = ["completed", "failed", "cancelled"].includes(args.status) ? now : worker.completedAt
  task.status = recalculateStatus(task.workerRuns)
  task.updatedAt = now
  task.completedAt = ["completed", "failed", "cancelled"].includes(task.status) ? now : task.completedAt
  task.events.push({ at: now, type: "record", message: `${worker.id} recorded as ${worker.status}` })
  await writeTask(args, task)

  return { success: true, schedulerTaskId: task.id, workerRunId: worker.id, status: task.status, task }
}

async function collect(args: Record<string, unknown>) {
  const task = await readTask(args, "collect")
  return {
    success: true,
    schedulerTaskId: task.id,
    status: task.status,
    requiresOrchestratorVerification: true,
    summary: {
      title: task.title,
      tier: task.tier,
      acceptanceCriteria: task.acceptanceCriteria,
      validationCommands: task.validationCommands,
      workers: task.workerRuns.map((worker) => ({
        workerRunId: worker.id,
        status: worker.status,
        taskID: worker.taskID,
        resultSummary: worker.resultSummary,
        error: worker.error,
        worktreePath: worker.worktreePath,
        artifacts: worker.artifacts,
      })),
      events: task.events,
    },
  }
}

async function cancel(args: Record<string, unknown>) {
  const task = await readTask(args)
  const now = new Date().toISOString()
  task.status = "cancelled"
  task.updatedAt = now
  task.completedAt = now
  task.workerRuns = task.workerRuns.map((worker) =>
    ["completed", "failed", "cancelled"].includes(worker.status)
      ? worker
      : { ...worker, status: "cancelled", updatedAt: now, completedAt: now },
  )
  task.events.push({ at: now, type: "cancelled", message: "Scheduler state marked cancelled; no subagents were interrupted" })
  await writeTask(args, task)
  return { success: true, schedulerTaskId: task.id, status: task.status, task }
}

async function cleanup(args: Record<string, unknown>) {
  const schedulerTaskId = requireSchedulerTaskId(args)
  if (!safeId(schedulerTaskId)) throw new Error("schedulerTaskId contains unsupported characters")
  await rm(taskPath(args, schedulerTaskId), { force: true })
  return {
    success: true,
    schedulerTaskId,
    message: "Removed scheduler state file only; no worktrees or user files were modified.",
  }
}

function normalizeWorkers(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    if (typeof item === "string") {
      return {
        name: item,
        subagent_type: item,
        description: item,
        prompt: item,
        acceptanceCriteria: [],
      }
    }
    if (!isRecord(item)) throw new Error(`workers[${index}] must be a string or object`)
    const workerType = stringField(item, "subagent_type") ?? stringField(item, "workerType") ?? stringField(item, "type")
    const description = stringField(item, "description") ?? stringField(item, "name") ?? workerType
    const prompt =
      stringField(item, "prompt") ??
      stringField(item, "instructions") ??
      stringField(item, "instruction") ??
      stringField(item, "task") ??
      description
    if (!workerType) throw new Error(`workers[${index}].subagent_type is required`)
    if (!description) throw new Error(`workers[${index}].description is required`)
    if (!prompt) throw new Error(`workers[${index}].prompt or instructions is required`)
    return {
      name: stringField(item, "name") ?? description,
      subagent_type: workerType,
      description,
      prompt,
      acceptanceCriteria: stringArray(item.acceptanceCriteria),
    }
  })
}

async function readTask(args: Record<string, unknown>, action?: string) {
  const schedulerTaskId = requireSchedulerTaskId(args, action)
  if (!safeId(schedulerTaskId)) throw new Error("schedulerTaskId contains unsupported characters")
  const path = taskPath(args, schedulerTaskId)
  if (!existsSync(path)) throw new Error(schedulerTaskNotFoundMessage(action, schedulerTaskId))
  return JSON.parse(await readFile(path, "utf8")) as SchedulerTask
}

async function writeTask(args: Record<string, unknown>, task: SchedulerTask) {
  if (!safeId(task.id)) throw new Error("schedulerTaskId contains unsupported characters")
  await mkdir(stateDir(args), { recursive: true })
  await writeFile(taskPath(args, task.id), JSON.stringify(task, null, 2))
}

function stateDir(args: Record<string, unknown>) {
  return join(typeof args.configDir === "string" ? args.configDir : join(process.env.HOME || "~", ".config", "opencode"), "scheduler")
}

function taskPath(args: Record<string, unknown>, schedulerTaskId: string) {
  return join(stateDir(args), `${schedulerTaskId}.json`)
}

function requireSchedulerTaskId(args: Record<string, unknown>, action?: string) {
  if (typeof args.schedulerTaskId === "string" && args.schedulerTaskId.trim()) return args.schedulerTaskId
  if (action === "collect") {
    throw new Error(
      'schedulerTaskId is required for collect. Usage: scheduler({ action: "collect", schedulerTaskId }). Collect only after all intended worker records are written; check for cleanup/configDir mismatch if state is missing.',
    )
  }
  throw new Error("schedulerTaskId is required")
}

function schedulerTaskNotFoundMessage(action: string | undefined, schedulerTaskId: string) {
  if (action === "record") {
    return `Scheduler task ${schedulerTaskId} not found for record. Verify schedulerTaskId; do not pass a project repo path as configDir during normal Desktop/global use; scheduler state may have already been cleaned up. Normal scheduler state is under ~/.config/opencode/scheduler.`
  }
  if (action === "collect") {
    return `Scheduler task ${schedulerTaskId} not found for collect. Usage: scheduler({ action: "collect", schedulerTaskId }). Collect only after all intended worker records are written; check for cleanup/configDir mismatch. Normal scheduler state is under ~/.config/opencode/scheduler.`
  }
  return `Scheduler task ${schedulerTaskId} not found`
}

function isLikelyWorkerRunTaskId(taskID: string, workerRunId: string) {
  return taskID === workerRunId || taskID.includes(workerRunId) || /^scheduler-.+-worker-\d+$/.test(taskID)
}

function recalculateStatus(workers: WorkerRun[]): SchedulerTaskStatus {
  if (workers.every((worker) => worker.status === "cancelled")) return "cancelled"
  if (workers.some((worker) => worker.status === "running")) return "running"
  if (workers.some((worker) => ["completed", "failed", "cancelled"].includes(worker.status)) && workers.some((worker) => worker.status === "planned")) return "running"
  if (workers.some((worker) => worker.status === "failed")) return "failed"
  if (workers.every((worker) => worker.status === "completed")) return "completed"
  return "planned"
}

function generateId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function stringField(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" && value[key].trim() ? value[key] : undefined
}

function isWorkerStatus(value: unknown): value is WorkerRunStatus {
  return value === "planned" || value === "running" || value === "completed" || value === "failed" || value === "cancelled"
}

function safeId(value: string) {
  return /^[a-zA-Z0-9_.-]+$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
