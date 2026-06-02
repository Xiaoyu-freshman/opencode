import { describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import { mkdtemp, readFile, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import scheduler from "../../../../.opencode/tool/scheduler"

const context = {
  sessionID: "ses_scheduler_test",
  messageID: "msg_scheduler_test",
  agent: "orchestrator",
  directory: process.cwd(),
  worktree: process.cwd(),
  abort: new AbortController().signal,
  metadata: () => ({}),
  async ask() {},
}

describe("scheduler tool", () => {
  test("plans, records, collects, cancels, and cleans scheduler state only", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "opencode-scheduler-test-"))
    const schedulerTaskId = "scheduler-test-task"

    try {
      const planned = parseJsonOutput(
        await scheduler.execute(
          {
            action: "plan",
            configDir,
            schedulerTaskId,
            title: "Scheduler test plan",
            tier: "L",
            maxConcurrentWorkers: 1,
            acceptanceCriteria: ["worker reports result"],
            validationCommands: ["bun test test/tool/scheduler.test.ts"],
            workers: [
              {
                subagent_type: "bus-worker-diagnostic",
                description: "Inspect scheduler behavior",
                prompt: "Inspect scheduler behavior and report back.",
              },
              {
                subagent_type: "bus-worker-implementation",
                description: "Implement scheduler behavior",
                prompt: "Implement scheduler behavior and report back.",
                acceptanceCriteria: ["implementation report returned"],
              },
            ],
          },
          context,
        ),
      )

      expect(planned).toMatchObject({ success: true, schedulerTaskId })
      expect(planned.task.status).toBe("planned")
      expect(planned.task.maxConcurrentWorkers).toBe(1)
      expect(planned.taskCalls).toHaveLength(2)
      expect(planned.taskCalls[0]).toMatchObject({
        workerRunId: `${schedulerTaskId}-worker-1`,
        taskArgs: {
          subagent_type: "bus-worker-diagnostic",
          description: "Inspect scheduler behavior",
          prompt: "Inspect scheduler behavior and report back.",
        },
        acceptanceCriteria: ["worker reports result"],
      })
      expect(planned.taskCalls[0].taskArgs.task_id).toBeUndefined()
      expect(planned.taskCalls[0].recordInstruction).toContain("workerRunId")
      expect(existsSync(join(configDir, "scheduler", `${schedulerTaskId}.json`))).toBe(true)

      const initialStatus = parseJsonOutput(await scheduler.execute({ action: "status", configDir, schedulerTaskId }, context))
      expect(initialStatus).toMatchObject({ success: true, status: "planned" })
      expect(initialStatus.workers).toHaveLength(2)

      const recorded = parseJsonOutput(
        await scheduler.execute(
          {
            action: "record",
            configDir,
            schedulerTaskId,
            workerRunId: `${schedulerTaskId}-worker-1`,
            status: "completed",
            taskID: "ses_task_123",
            resultSummary: "diagnostic complete",
            worktreePath: "/tmp/worktree-record-only",
            artifacts: ["diagnostic.md"],
          },
          context,
        ),
      )
      expect(recorded).toMatchObject({ success: true, status: "running" })
      expect(recorded.task.workerRuns[0]).toMatchObject({ id: `${schedulerTaskId}-worker-1`, taskID: "ses_task_123" })

      const collected = parseJsonOutput(await scheduler.execute({ action: "collect", configDir, schedulerTaskId }, context))
      expect(collected).toMatchObject({ success: true, requiresOrchestratorVerification: true })
      const collectedWorkers = collected.summary.workers as { workerRunId: string; resultSummary?: string }[]
      expect(collectedWorkers.find((worker) => worker.workerRunId === `${schedulerTaskId}-worker-1`)).toMatchObject({
        resultSummary: "diagnostic complete",
      })

      const cancelled = parseJsonOutput(await scheduler.execute({ action: "cancel", configDir, schedulerTaskId }, context))
      expect(cancelled).toMatchObject({ success: true, status: "cancelled" })
      expect(cancelled.task.workerRuns.map((worker: { status: string }) => worker.status)).toEqual(["completed", "cancelled"])

      const cleaned = parseJsonOutput(await scheduler.execute({ action: "cleanup", configDir, schedulerTaskId }, context))
      expect(cleaned).toMatchObject({ success: true, schedulerTaskId })
      expect(cleaned.message).toContain("scheduler state file only")
      expect(existsSync(join(configDir, "scheduler", `${schedulerTaskId}.json`))).toBe(false)
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test("derives worker prompts from instruction aliases", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "opencode-scheduler-prompt-"))
    const schedulerTaskId = "scheduler-prompt-test"

    try {
      const planned = parseJsonOutput(
        await scheduler.execute(
          {
            action: "plan",
            configDir,
            schedulerTaskId,
            title: "Scheduler prompt derivation",
            workers: [
              {
                subagent_type: "bus-worker-diagnostic",
                description: "Inspect scheduler prompt aliases",
                instructions: "Use this instruction text as the built-in task prompt.",
              },
            ],
          },
          context,
        ),
      )

      expect(planned.taskCalls[0]).toMatchObject({
        workerRunId: `${schedulerTaskId}-worker-1`,
        taskArgs: { prompt: "Use this instruction text as the built-in task prompt." },
      })
      expect(planned.taskCalls[0].taskArgs.task_id).toBeUndefined()
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test("record missing scheduler task includes recovery hints", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "opencode-scheduler-missing-record-"))

    try {
      const error = await schedulerError({
        action: "record",
        configDir,
        schedulerTaskId: "scheduler-missing-record",
        workerRunId: "scheduler-missing-record-worker-1",
        status: "completed",
        taskID: "ses_task_123",
      })

      expect(error).toContain("Verify schedulerTaskId")
      expect(error).toContain("do not pass a project repo path as configDir")
      expect(error).toContain("cleaned up")
      expect(error).toContain("~/.config/opencode/scheduler")
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test("record rejects workerRunId-shaped taskID with protocol hints", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "opencode-scheduler-taskid-"))
    const schedulerTaskId = "scheduler-taskid-test"

    try {
      await scheduler.execute(
        {
          action: "plan",
          configDir,
          schedulerTaskId,
          title: "Scheduler taskID misuse",
          workers: [{ subagent_type: "bus-worker-diagnostic", description: "Inspect taskID misuse", prompt: "Inspect." }],
        },
        context,
      )

      const equalError = await schedulerError({
        action: "record",
        configDir,
        schedulerTaskId,
        workerRunId: `${schedulerTaskId}-worker-1`,
        status: "completed",
        taskID: `${schedulerTaskId}-worker-1`,
      })
      expect(equalError).toContain("workerRunId is not built-in task_id")
      expect(equalError).toContain("ses_*")
      expect(equalError).toContain("New worker launches should omit task_id")
      expect(equalError).toContain("taskCalls[i].taskArgs")

      const shapedError = await schedulerError({
        action: "record",
        configDir,
        schedulerTaskId,
        workerRunId: `${schedulerTaskId}-worker-1`,
        status: "completed",
        taskID: "scheduler-other-worker-2",
      })
      expect(shapedError).toContain("workerRunId is not built-in task_id")
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test("collect missing scheduler task includes usage and cleanup hints", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "opencode-scheduler-missing-collect-"))

    try {
      const missingIdError = await schedulerError({ action: "collect", configDir })
      expect(missingIdError).toContain('scheduler({ action: "collect", schedulerTaskId })')
      expect(missingIdError).toContain("Collect only after all intended worker records are written")
      expect(missingIdError).toContain("cleanup/configDir mismatch")

      const notFoundError = await schedulerError({ action: "collect", configDir, schedulerTaskId: "scheduler-missing-collect" })
      expect(notFoundError).toContain('scheduler({ action: "collect", schedulerTaskId })')
      expect(notFoundError).toContain("Collect only after all intended worker records are written")
      expect(notFoundError).toContain("cleanup/configDir mismatch")
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test("returns plugin result protocol and avoids Bun globals", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "opencode-scheduler-protocol-"))

    try {
      const result = await scheduler.execute({ action: "cleanup", configDir, schedulerTaskId: "missing-ok" }, context)

      if (!isRecord(result) || typeof result.output !== "string") throw new Error("Tool result must be { output: string }")
      expect(JSON.parse(result.output)).toMatchObject({ success: true, schedulerTaskId: "missing-ok" })
      expect(await readFile(join(import.meta.dir, "../../../../.opencode/tool/scheduler.ts"), "utf8")).not.toContain("Bun.")
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })
})

function parseJsonOutput(result: unknown) {
  if (!isRecord(result) || typeof result.output !== "string") throw new Error("Tool result must be { output: string }")
  return JSON.parse(result.output)
}

async function schedulerError(args: Parameters<typeof scheduler.execute>[0]) {
  try {
    await scheduler.execute(args, context)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error("Expected scheduler to throw")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
