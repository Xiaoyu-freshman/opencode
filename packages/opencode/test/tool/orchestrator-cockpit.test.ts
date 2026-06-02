import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

type RuntimeTool = {
  execute: (args: Record<string, unknown>, context: ToolContext) => unknown | Promise<unknown>
}

type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  directory: string
  worktree: string
  abort: AbortSignal
  metadata: () => Record<string, never>
  ask: () => Promise<{ type: "allow" }>
}

const context = {
  sessionID: "ses_orchestrator_cockpit_test",
  messageID: "msg_orchestrator_cockpit_test",
  agent: "orchestrator",
  directory: process.cwd(),
  worktree: process.cwd(),
  abort: new AbortController().signal,
  metadata: () => ({}),
  async ask(): Promise<{ type: "allow" }> {
    return { type: "allow" }
  },
}

describe("orchestrator cockpit tool", () => {
  test("creates a run, projects events, and renders a user-facing cockpit", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "opencode-cockpit-config-"))
    const projectDir = await mkdtemp(join(tmpdir(), "opencode-cockpit-project-"))
    const runID = "cockpit-run-1"

    try {
      const tool = await cockpit()
      const created = parseJsonOutput(
        await tool.execute(
          {
            action: "create",
            configDir,
            runID,
            title: "Snow Motion Lab stabilization",
            tier: "L",
            projectPath: projectDir,
          },
          context,
        ),
      )

      expect(created.success).toBe(true)
      expect(getRun(created).title).toBe("Snow Motion Lab stabilization")
      expect(await readFile(join(configDir, "cockpit", `${runID}.json`), "utf8")).toContain("Snow Motion Lab stabilization")

      await emitEvent(tool, configDir, runID, { eventType: "run.started", timestamp: "2026-06-02T10:00:00.000Z", message: "workflow started" })
      await emitEvent(tool, configDir, runID, {
        eventType: "phase.started",
        targetID: "phase-diagnosis",
        targetType: "phase",
        label: "Project diagnosis",
        timestamp: "2026-06-02T10:00:00.000Z",
      })
      await emitEvent(tool, configDir, runID, {
        eventType: "phase.completed",
        targetID: "phase-diagnosis",
        targetType: "phase",
        label: "Project diagnosis",
        timestamp: "2026-06-02T10:00:42.000Z",
      })
      await emitEvent(tool, configDir, runID, {
        eventType: "worker.planned",
        targetID: "worker-core-1",
        targetType: "worker",
        label: "C-side core stabilization",
        timestamp: "2026-06-02T10:00:42.000Z",
        data: { type: "implementation", scope: "C-side core stabilization" },
      })
      await emitEvent(tool, configDir, runID, {
        eventType: "worker.started",
        targetID: "worker-core-1",
        targetType: "worker",
        label: "C-side core stabilization",
        timestamp: "2026-06-02T10:00:42.000Z",
      })
      await emitEvent(tool, configDir, runID, {
        eventType: "worker.completed",
        targetID: "worker-core-1",
        targetType: "worker",
        label: "C-side core stabilization",
        timestamp: "2026-06-02T10:03:42.000Z",
        data: { resultSummary: "implementation complete" },
      })
      await emitEvent(tool, configDir, runID, {
        eventType: "validation.planned",
        targetID: "validation-ruff",
        targetType: "validation",
        label: "ruff",
        timestamp: "2026-06-02T10:03:42.000Z",
      })
      await emitEvent(tool, configDir, runID, {
        eventType: "validation.started",
        targetID: "validation-ruff",
        targetType: "validation",
        label: "ruff",
        timestamp: "2026-06-02T10:03:42.000Z",
      })
      await emitEvent(tool, configDir, runID, {
        eventType: "validation.completed",
        targetID: "validation-ruff",
        targetType: "validation",
        label: "ruff",
        timestamp: "2026-06-02T10:04:42.000Z",
        data: { resultSummary: "passed" },
      })
      await emitEvent(tool, configDir, runID, {
        eventType: "cleanup.planned",
        targetID: "cleanup-worktrees",
        targetType: "cleanup",
        label: "worker worktrees",
        timestamp: "2026-06-02T10:04:42.000Z",
      })
      await emitEvent(tool, configDir, runID, {
        eventType: "cleanup.started",
        targetID: "cleanup-worktrees",
        targetType: "cleanup",
        label: "worker worktrees",
        timestamp: "2026-06-02T10:04:42.000Z",
      })
      await emitEvent(tool, configDir, runID, {
        eventType: "cleanup.completed",
        targetID: "cleanup-worktrees",
        targetType: "cleanup",
        label: "worker worktrees",
        timestamp: "2026-06-02T10:05:12.000Z",
        data: { resultSummary: "cleaned" },
      })
      await emitEvent(tool, configDir, runID, {
        eventType: "decision.needed",
        targetID: "decision-cleanup",
        targetType: "decision",
        label: "Preserve or delete the review branch?",
        timestamp: "2026-06-02T10:05:12.000Z",
        data: { options: ["preserve worktree", "delete worktree"] },
      })
      await emitEvent(tool, configDir, runID, {
        eventType: "run.blocked",
        timestamp: "2026-06-02T10:05:12.000Z",
        message: "waiting on a cleanup decision",
      })

      const blocked = getRun(parseJsonOutput(await tool.execute({ action: "status", configDir, runID }, context)))
      expect(blocked).toMatchObject({
        status: "blocked",
        summary: "waiting on a cleanup decision",
        durationSeconds: 312,
        phases: [{ label: "Project diagnosis", status: "completed", durationSeconds: 42 }],
        workers: [{ label: "C-side core stabilization", type: "implementation", status: "completed", durationSeconds: 180 }],
        validations: [{ label: "ruff", status: "completed", durationSeconds: 60 }],
        cleanups: [{ label: "worker worktrees", status: "completed", durationSeconds: 30 }],
        decisions: [{ label: "Preserve or delete the review branch?", status: "needed" }],
      })

      const display = getDisplay(await tool.execute({ action: "display", configDir, runID }, context))
      expect(display).toContain("Snow Motion Lab stabilization")
      expect(display).toContain("Status: blocked")
      expect(display).toContain("Phases")
      expect(display).toContain("Workers")
      expect(display).toContain("Validation")
      expect(display).toContain("Cleanup")
      expect(display).toContain("Decisions")
      expect(display).not.toContain(runID)
      expect(display).not.toContain("worker-core-1")
      expect(display).not.toContain("validation-ruff")
      expect(display).not.toContain("cleanup-worktrees")
      expect(display).not.toContain("decision-cleanup")

      await emitEvent(tool, configDir, runID, {
        eventType: "decision.answered",
        targetID: "decision-cleanup",
        targetType: "decision",
        label: "Preserve or delete the review branch?",
        timestamp: "2026-06-02T10:05:30.000Z",
        data: { answer: "delete worktree" },
      })
      await emitEvent(tool, configDir, runID, {
        eventType: "run.completed",
        timestamp: "2026-06-02T10:05:30.000Z",
        message: "workflow complete",
      })

      expect(getRun(parseJsonOutput(await tool.execute({ action: "status", configDir, runID }, context)))).toMatchObject({
        status: "completed",
        summary: "workflow complete",
        durationSeconds: 330,
      })
    } finally {
      await rm(configDir, { recursive: true, force: true })
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  test("complete sets a terminal status and summary", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "opencode-cockpit-complete-"))
    const runID = "cockpit-complete-run"

    try {
      const tool = await cockpit()
      await tool.execute({ action: "create", configDir, runID, title: "Validation-only run", tier: "M" }, context)
      await emitEvent(tool, configDir, runID, { eventType: "run.started", timestamp: "2026-06-02T11:00:00.000Z", message: "workflow started" })

      const completed = parseJsonOutput(
        await tool.execute(
          { action: "complete", configDir, runID, summary: "validation passed and cleanup preserved the branch" },
          context,
        ),
      )

      expect(completed.success).toBe(true)
      expect(getRun(parseJsonOutput(await tool.execute({ action: "status", configDir, runID }, context)))).toMatchObject({
        status: "completed",
        summary: "validation passed and cleanup preserved the branch",
      })
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test("cleanup removes old terminal runs by age and count while preserving active runs", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "opencode-cockpit-cleanup-"))
    await mkdir(join(configDir, "cockpit"), { recursive: true })
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString()

    try {
      await writeRun(configDir, { id: "run-old-1", title: "Old completed run 1", tier: "L", status: "completed", startedAt: iso(-9 * day), updatedAt: iso(-9 * day + 60 * 1000), completedAt: iso(-9 * day + 60 * 1000), summary: "expired" })
      await writeRun(configDir, { id: "run-old-2", title: "Old completed run 2", tier: "L", status: "failed", startedAt: iso(-8 * day), updatedAt: iso(-8 * day + 2 * 60 * 1000), completedAt: iso(-8 * day + 2 * 60 * 1000), summary: "expired" })
      await writeRun(configDir, { id: "run-recent-1", title: "Recent completed run 1", tier: "L", status: "completed", startedAt: iso(-3 * day), updatedAt: iso(-3 * day + 60 * 1000), completedAt: iso(-3 * day + 60 * 1000), summary: "kept" })
      await writeRun(configDir, { id: "run-recent-2", title: "Recent failed run 2", tier: "L", status: "failed", startedAt: iso(-2 * day), updatedAt: iso(-2 * day + 3 * 60 * 1000), completedAt: iso(-2 * day + 3 * 60 * 1000), summary: "kept" })
      await writeRun(configDir, { id: "run-recent-3", title: "Recent cancelled run 3", tier: "L", status: "cancelled", startedAt: iso(-1 * day), updatedAt: iso(-1 * day + 4 * 60 * 1000), completedAt: iso(-1 * day + 4 * 60 * 1000), summary: "kept" })
      await writeRun(configDir, { id: "run-active", title: "Active run", tier: "L", status: "running", startedAt: iso(-12 * 60 * 60 * 1000), updatedAt: iso(-12 * 60 * 60 * 1000 + 5 * 60 * 1000), phases: [], workers: [], validations: [], cleanups: [], decisions: [], events: [] })

      const tool = await cockpit()
      const cleaned = parseJsonOutput(await tool.execute({ action: "cleanup", configDir, maxAgeDays: 7, maxCount: 2 }, context))

      expect(cleaned.success).toBe(true)
      expect(cleaned.deleted).toEqual({ expired: 2, excess: 1, total: 3 })
      expect(cleaned.kept).toBe(3)
      expect((await readdir(join(configDir, "cockpit"))).sort()).toEqual(["run-active.json", "run-recent-2.json", "run-recent-3.json"])
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })
})

async function cockpit() {
  const mod = (await import("../../../../.opencode/tool/orchestrator-cockpit")) as unknown
  if (!isToolModule(mod)) throw new Error("Imported module default export is not an executable tool")
  return mod.default
}

async function emitEvent(tool: RuntimeTool, configDir: string, runID: string, event: Record<string, unknown>) {
  return await tool.execute({ action: "event", configDir, runID, ...event }, context)
}

async function writeRun(configDir: string, run: { id: string } & Record<string, unknown>) {
  await writeFile(join(configDir, "cockpit", `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`)
}

function parseJsonOutput(result: unknown) {
  if (!isRecord(result) || typeof result.output !== "string") throw new Error("Tool result must be { output: string }")
  return JSON.parse(result.output) as Record<string, unknown>
}

function getRun(result: Record<string, unknown>) {
  if (isRecord(result.run)) return result.run
  if (isRecord(result.state)) return result.state
  throw new Error("Expected cockpit status to include a run projection")
}

function getDisplay(result: unknown) {
  if (typeof result === "string") return result
  if (!isRecord(result)) throw new Error("Expected cockpit display to be a string or object")
  if (typeof result.output === "string" && !result.output.startsWith("{")) return result.output
  if (typeof result.display === "string") return result.display
  if (typeof result.text === "string") return result.text
  throw new Error("Expected cockpit display to include text")
}

function isToolModule(value: unknown): value is { default: RuntimeTool } {
  return isRecord(value) && isRuntimeTool(value.default)
}

function isRuntimeTool(value: unknown): value is RuntimeTool {
  return isRecord(value) && typeof value.execute === "function"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
