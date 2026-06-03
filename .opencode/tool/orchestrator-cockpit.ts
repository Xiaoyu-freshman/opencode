/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"
import { existsSync } from "fs"
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises"
import { join } from "path"

const runStatuses = ["planned", "running", "blocked", "completed", "failed", "cancelled"] as const
const itemStatuses = ["pending", "running", "completed", "failed", "cancelled", "skipped"] as const
const decisionStatuses = ["needed", "answered", "deferred"] as const

type RunStatus = (typeof runStatuses)[number]
type ItemStatus = (typeof itemStatuses)[number]
type DecisionStatus = (typeof decisionStatuses)[number]
type Tier = "S" | "M" | "L" | "XL"

type RunEvent = {
  id: string
  type: string
  timestamp: string
  targetID?: string
  message?: string
  data?: Record<string, unknown>
}

type PhaseRecord = {
  id: string
  label: string
  status: ItemStatus
  startedAt?: string
  completedAt?: string
  durationSeconds?: number
  message?: string
}

type WorkerRecord = {
  id: string
  label: string
  type: "diagnostic" | "implementation" | "full" | "review"
  status: ItemStatus
  scope?: string
  risk?: "low" | "medium" | "high"
  startedAt?: string
  completedAt?: string
  durationSeconds?: number
  worktreePath?: string
  branch?: string
  resultSummary?: string
  validationStatus?: ItemStatus
  preservedReason?: string
}

type ValidationRecord = {
  id: string
  label: string
  command?: string
  status: ItemStatus
  startedAt?: string
  completedAt?: string
  durationSeconds?: number
  resultSummary?: string
}

type CleanupRecord = {
  id: string
  label: string
  status: ItemStatus
  startedAt?: string
  completedAt?: string
  durationSeconds?: number
  resultSummary?: string
  preservedReason?: string
}

type DecisionRecord = {
  id: string
  label: string
  status: DecisionStatus
  requestedAt: string
  answeredAt?: string
  options?: string[]
  answer?: string
}

type RunRecord = {
  id: string
  title: string
  projectPath?: string
  tier: Tier
  status: RunStatus
  startedAt: string
  updatedAt: string
  completedAt?: string
  summary?: string
  phases: PhaseRecord[]
  workers: WorkerRecord[]
  validations: ValidationRecord[]
  cleanups: CleanupRecord[]
  decisions: DecisionRecord[]
  events: RunEvent[]
}

export default tool({
  description: `Manage an Orchestrator cockpit run.

Storage defaults to ~/.config/opencode/cockpit/<run-id>.json. The tool records
append-only events, projects user-facing state, renders a compact cockpit, and
cleans up old terminal runs without exposing scheduler taskCalls, workerRunId,
or built-in task_id in default display output.`,
  args: {
    action: tool.schema.enum(["create", "event", "status", "display", "complete", "cleanup"]),
    configDir: tool.schema.string().optional().describe("Explicit OpenCode config directory for test/smoke use"),
    runID: tool.schema.string().optional().describe("Cockpit run ID"),
    title: tool.schema.string().optional().describe("Run title"),
    projectPath: tool.schema.string().optional().describe("Project path or user-facing scope"),
    tier: tool.schema.enum(["S", "M", "L", "XL"]).optional().default("L"),
    status: tool.schema.string().optional().describe("Run or terminal status when completing a run"),
    eventType: tool.schema.string().optional().describe("Cockpit event type, for example run.started or worker.completed"),
    targetID: tool.schema.string().optional().describe("Target record ID for the event"),
    targetType: tool.schema.enum(["phase", "worker", "validation", "cleanup", "decision", "run"]).optional().describe("Target record type"),
    label: tool.schema.string().optional().describe("User-facing label for the target record"),
    message: tool.schema.string().optional().describe("User-facing event message"),
    data: tool.schema.any().optional().describe("Optional JSON-compatible event payload"),
    summary: tool.schema.string().optional().describe("Terminal run summary"),
    timestamp: tool.schema.string().optional().describe("Event timestamp in ISO format"),
    maxAgeDays: tool.schema.number().optional().default(30).describe("Cleanup threshold in days"),
    maxCount: tool.schema.number().optional().default(100).describe("Max terminal runs to keep"),
  },
  async execute(args) {
    const configDir = resolveConfigDir(args.configDir)

    if (args.action === "create") return { output: JSON.stringify(await createRun(configDir, args), null, 2) }
    if (args.action === "cleanup") return { output: JSON.stringify(await cleanupRuns(configDir, args.maxAgeDays, args.maxCount), null, 2) }

    if (!args.runID) return { output: JSON.stringify({ success: false, message: "runID is required" }, null, 2) }

    const runID = assertSafeID(args.runID, "runID")
    const run = await loadRun(configDir, runID)
    if (!run) return { output: JSON.stringify({ success: false, message: "Run not found" }, null, 2) }

    if (args.action === "event") return { output: JSON.stringify(await appendRunEvent(configDir, run, args), null, 2) }
    if (args.action === "complete") return { output: JSON.stringify(await completeRun(configDir, run, args), null, 2) }
    if (args.action === "status") return { output: JSON.stringify({ success: true, run: runView(run) }, null, 2) }

    return { output: displayRun(run) }
  },
})

async function createRun(configDir: string, args: Record<string, unknown>) {
  if (typeof args.title !== "string" || !args.title.trim()) throw new Error("title is required for create")

  const runID = assertSafeID(typeof args.runID === "string" && args.runID.trim() ? args.runID.trim() : generateID("cockpit"), "runID")
  const now = isoNow(typeof args.timestamp === "string" ? args.timestamp : undefined)
  const run: RunRecord = {
    id: runID,
    title: args.title.trim(),
    projectPath: typeof args.projectPath === "string" && args.projectPath.trim() ? args.projectPath.trim() : undefined,
    tier: args.tier === "S" || args.tier === "M" || args.tier === "L" || args.tier === "XL" ? args.tier : "L",
    status: "planned",
    startedAt: now,
    updatedAt: now,
    phases: [],
    workers: [],
    validations: [],
    cleanups: [],
    decisions: [],
    events: [],
  }

  const event = {
    id: generateID("event"),
    type: "run.planned",
    timestamp: now,
    message: `Run created: ${run.title}`,
    data: safeRecord({ title: run.title, projectPath: run.projectPath, tier: run.tier }),
  } satisfies RunEvent

  run.events.push(event)
  projectEvent(run, event)
  await saveRun(configDir, run)

  return { success: true, run: runView(run), runID, path: runFilePath(configDir, run.id) }
}

async function appendRunEvent(configDir: string, run: RunRecord, args: Record<string, unknown>) {
  if (typeof args.eventType !== "string" || !args.eventType.trim()) throw new Error("eventType is required for event")

  const event = {
    id: generateID("event"),
    type: args.eventType.trim(),
    timestamp: isoNow(typeof args.timestamp === "string" ? args.timestamp : undefined),
    targetID: typeof args.targetID === "string" && args.targetID.trim() ? assertSafeID(args.targetID.trim(), "targetID") : undefined,
    message: typeof args.message === "string" && args.message.trim() ? args.message.trim() : typeof args.label === "string" && args.label.trim() ? args.label.trim() : undefined,
    data: safeRecord({
      ...(isRecord(args.data) ? args.data : {}),
      label: typeof args.label === "string" && args.label.trim() ? args.label.trim() : undefined,
      targetType: typeof args.targetType === "string" ? args.targetType : undefined,
      status: typeof args.status === "string" ? args.status : undefined,
    }),
  } satisfies RunEvent

  run.events.push(event)
  projectEvent(run, event)
  run.updatedAt = event.timestamp
  await saveRun(configDir, run)

  return { success: true, run: runView(run), eventID: event.id }
}

async function completeRun(configDir: string, run: RunRecord, args: Record<string, unknown>) {
  const status = args.status === "failed" || args.status === "cancelled" ? args.status : "completed"
  const event = {
    id: generateID("event"),
    type: `run.${status}`,
    timestamp: isoNow(typeof args.timestamp === "string" ? args.timestamp : undefined),
    message: typeof args.summary === "string" && args.summary.trim() ? args.summary.trim() : undefined,
    data: safeRecord({ summary: typeof args.summary === "string" && args.summary.trim() ? args.summary.trim() : undefined, status }),
  } satisfies RunEvent

  run.events.push(event)
  projectEvent(run, event)
  run.updatedAt = event.timestamp
  await saveRun(configDir, run)

  return { success: true, run: runView(run), eventID: event.id }
}

async function cleanupRuns(configDir: string, maxAgeDays?: number, maxCount?: number) {
  const dir = cockpitDir(configDir)
  if (!existsSync(dir)) return { success: true, deleted: { expired: 0, excess: 0, total: 0 }, kept: 0, scanned: 0 }

  const files = (await readdir(dir)).filter((file) => file.endsWith(".json"))
  const runs = (await Promise.all(files.map(async (file) => {
    const run = await loadRunFile(join(dir, file))
    return run ? { file, run } : undefined
  }))).filter((entry): entry is { file: string; run: RunRecord } => Boolean(entry))

  const terminalRuns = runs.filter((entry) => isTerminalRun(entry.run.status))
  const now = Date.now()
  const ageLimit = Math.max(0, Math.floor((maxAgeDays ?? 30) * 24 * 60 * 60 * 1000))
  const expired = terminalRuns.filter((entry) => terminalTimestamp(entry.run) < now - ageLimit)
  for (const entry of expired) await rm(join(dir, entry.file), { force: true })

  const afterAge = runs.filter((entry) => !expired.some((item) => item.file === entry.file))
  const terminalAfterAge = afterAge.filter((entry) => isTerminalRun(entry.run.status)).sort((left, right) => terminalTimestamp(right.run) - terminalTimestamp(left.run))
  const limit = Math.max(0, Math.floor(maxCount ?? 100))
  const excess = terminalAfterAge.slice(limit)
  for (const entry of excess) await rm(join(dir, entry.file), { force: true })

  return {
    success: true,
    deleted: { expired: expired.length, excess: excess.length, total: expired.length + excess.length },
    kept: Math.max(0, runs.length - expired.length - excess.length),
    scanned: runs.length,
  }
}

async function loadRun(configDir: string, runID: string) {
  return await loadRunFile(runFilePath(configDir, runID))
}

async function loadRunFile(filePath: string) {
  if (!existsSync(filePath)) return undefined
  try {
    return normalizeRun(JSON.parse(await readFile(filePath, "utf8")))
  } catch {
    return undefined
  }
}

async function saveRun(configDir: string, run: RunRecord) {
  await mkdir(cockpitDir(configDir), { recursive: true })
  await writeFile(runFilePath(configDir, run.id), `${JSON.stringify(run, null, 2)}\n`)
}

function projectEvent(run: RunRecord, event: RunEvent) {
  const [family, suffix] = event.type.split(".")
  if (family === "run") return projectRun(run, event, suffix)
  if (family === "phase") return projectPhase(run, event, suffix)
  if (family === "worker") return projectWorker(run, event, suffix)
  if (family === "validation") return projectValidation(run, event, suffix)
  if (family === "cleanup") return projectCleanup(run, event, suffix)
  if (family === "decision") projectDecision(run, event, suffix)
}

function projectRun(run: RunRecord, event: RunEvent, suffix?: string) {
  if (suffix === "planned") {
    if (typeof event.data?.title === "string" && event.data.title.trim()) run.title = event.data.title.trim()
    if (typeof event.data?.projectPath === "string" && event.data.projectPath.trim()) run.projectPath = event.data.projectPath.trim()
    if (event.data?.tier === "S" || event.data?.tier === "M" || event.data?.tier === "L" || event.data?.tier === "XL") run.tier = event.data.tier
    run.status = "planned"
    run.updatedAt = event.timestamp
    return
  }

  if (suffix === "started") {
    run.status = "running"
    run.startedAt = event.timestamp
    run.updatedAt = event.timestamp
    return
  }

  if (suffix === "blocked") {
    run.status = "blocked"
    run.summary = eventSummary(event) ?? run.summary
    run.updatedAt = event.timestamp
    return
  }

  if (suffix === "completed" || suffix === "failed" || suffix === "cancelled") {
    run.status = suffix
    run.completedAt = event.timestamp
    run.summary = eventSummary(event) ?? run.summary
    run.updatedAt = event.timestamp
  }
}

function projectPhase(run: RunRecord, event: RunEvent, suffix?: string) {
  const id = resolveTargetID(event)
  const phase = findOrCreate<PhaseRecord>(run.phases, id, () => ({ id, label: eventLabel(event), status: "pending" }))
  phase.label = eventLabel(event, phase.label)
  if (suffix === "planned") phase.status = "pending"
  if (suffix === "started") {
    phase.status = "running"
    phase.startedAt ||= event.timestamp
  }
  if (suffix === "completed") {
    phase.status = "completed"
    phase.completedAt = event.timestamp
  }
  if (suffix === "failed") {
    phase.status = "failed"
    phase.completedAt = event.timestamp
  }
  phase.message = eventSummary(event, phase.message)
  phase.durationSeconds = durationSeconds(phase.startedAt, phase.completedAt, phase.status === "running" ? event.timestamp : undefined)
}

function projectWorker(run: RunRecord, event: RunEvent, suffix?: string) {
  const id = resolveTargetID(event)
  const worker = findOrCreate<WorkerRecord>(run.workers, id, () => ({ id, label: eventLabel(event), type: normalizeWorkerType(event.data?.type) ?? "implementation", status: "pending" }))
  worker.label = eventLabel(event, worker.label)
  worker.type = normalizeWorkerType(event.data?.type) ?? worker.type
  if (typeof event.data?.scope === "string" && event.data.scope.trim()) worker.scope = event.data.scope.trim()
  if (event.data?.risk === "low" || event.data?.risk === "medium" || event.data?.risk === "high") worker.risk = event.data.risk
  if (typeof event.data?.worktreePath === "string" && event.data.worktreePath.trim()) worker.worktreePath = event.data.worktreePath.trim()
  if (typeof event.data?.branch === "string" && event.data.branch.trim()) worker.branch = event.data.branch.trim()
  if (suffix === "planned") worker.status = "pending"
  if (suffix === "started") {
    worker.status = "running"
    worker.startedAt ||= event.timestamp
  }
  if (suffix === "completed") {
    worker.status = "completed"
    worker.completedAt = event.timestamp
    worker.resultSummary = eventSummary(event, worker.resultSummary)
  }
  if (suffix === "failed") {
    worker.status = "failed"
    worker.completedAt = event.timestamp
    worker.resultSummary = eventSummary(event, worker.resultSummary)
  }
  if (isItemStatus(event.data?.validationStatus)) worker.validationStatus = event.data.validationStatus
  if (typeof event.data?.preservedReason === "string" && event.data.preservedReason.trim()) worker.preservedReason = event.data.preservedReason.trim()
  worker.durationSeconds = durationSeconds(worker.startedAt, worker.completedAt, worker.status === "running" ? event.timestamp : undefined)
}

function projectValidation(run: RunRecord, event: RunEvent, suffix?: string) {
  const id = resolveTargetID(event)
  const validation = findOrCreate<ValidationRecord>(run.validations, id, () => ({ id, label: eventLabel(event), status: "pending" }))
  validation.label = eventLabel(event, validation.label)
  if (typeof event.data?.command === "string" && event.data.command.trim()) validation.command = event.data.command.trim()
  if (suffix === "planned") validation.status = "pending"
  if (suffix === "started") {
    validation.status = "running"
    validation.startedAt ||= event.timestamp
  }
  if (suffix === "completed") {
    validation.status = "completed"
    validation.completedAt = event.timestamp
    validation.resultSummary = eventSummary(event, validation.resultSummary)
  }
  if (suffix === "failed") {
    validation.status = "failed"
    validation.completedAt = event.timestamp
    validation.resultSummary = eventSummary(event, validation.resultSummary)
  }
  validation.resultSummary = eventSummary(event, validation.resultSummary)
  validation.durationSeconds = durationSeconds(validation.startedAt, validation.completedAt, validation.status === "running" ? event.timestamp : undefined)
}

function projectCleanup(run: RunRecord, event: RunEvent, suffix?: string) {
  const id = resolveTargetID(event)
  const cleanup = findOrCreate<CleanupRecord>(run.cleanups, id, () => ({ id, label: eventLabel(event), status: "pending" }))
  cleanup.label = eventLabel(event, cleanup.label)
  if (suffix === "planned") cleanup.status = "pending"
  if (suffix === "started") {
    cleanup.status = "running"
    cleanup.startedAt ||= event.timestamp
  }
  if (suffix === "completed") {
    cleanup.status = "completed"
    cleanup.completedAt = event.timestamp
    cleanup.resultSummary = eventSummary(event, cleanup.resultSummary)
  }
  if (suffix === "preserved") {
    cleanup.status = "skipped"
    cleanup.completedAt = event.timestamp
    cleanup.preservedReason = eventSummary(event, cleanup.preservedReason)
    cleanup.resultSummary = cleanup.preservedReason
  }
  if (typeof event.data?.preservedReason === "string" && event.data.preservedReason.trim()) cleanup.preservedReason = event.data.preservedReason.trim()
  cleanup.resultSummary = eventSummary(event, cleanup.resultSummary)
  cleanup.durationSeconds = durationSeconds(cleanup.startedAt, cleanup.completedAt, cleanup.status === "running" ? event.timestamp : undefined)
}

function projectDecision(run: RunRecord, event: RunEvent, suffix?: string) {
  const id = resolveTargetID(event)
  const decision = findOrCreate<DecisionRecord>(run.decisions, id, () => ({ id, label: eventLabel(event), status: "needed", requestedAt: event.timestamp }))
  decision.label = eventLabel(event, decision.label)
  if (suffix === "needed") {
    decision.status = "needed"
    decision.requestedAt ||= event.timestamp
  }
  if (suffix === "answered") {
    decision.status = "answered"
    decision.answeredAt = event.timestamp
    decision.answer = eventSummary(event, decision.answer)
  }
  if (suffix === "deferred") decision.status = "deferred"
  if (Array.isArray(event.data?.options)) decision.options = event.data.options.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())
  if (typeof event.data?.answer === "string" && event.data.answer.trim()) decision.answer = event.data.answer.trim()
}

function displayRun(run: RunRecord) {
  const lines = [run.title, `Status: ${run.status}   Tier: ${run.tier}   Elapsed: ${formatDuration(runElapsedSeconds(run))}`]
  if (run.projectPath) lines.push(`Scope: ${run.projectPath}`)
  if (run.summary) lines.push(`Summary: ${run.summary}`)

  lines.push("", "Phases")
  lines.push(...(run.phases.length > 0 ? run.phases.map((phase, index) => `${statusIcon(phase.status)} ${index + 1}. ${phase.label}${durationSuffix(phase.status, phase.durationSeconds)}${statusDetail(phase.status)}`) : ["○ none"]))

  lines.push("", "Workers")
  lines.push(...(run.workers.length > 0 ? run.workers.map((worker) => `${statusIcon(worker.status)} ${worker.label}   ${worker.type}${worker.scope ? `   Scope: ${worker.scope}` : ""}${worker.risk ? `   Risk: ${worker.risk}` : ""}${durationSuffix(worker.status, worker.durationSeconds)}${statusDetail(worker.status)}`) : ["○ none"]))

  lines.push("", "Validation")
  lines.push(...(run.validations.length > 0 ? run.validations.map((validation) => `${statusIcon(validation.status)} ${validation.label}${validation.command ? `   ${validation.command}` : ""}${durationSuffix(validation.status, validation.durationSeconds)}${statusDetail(validation.status)}`) : ["○ none"]))

  lines.push("", "Cleanup")
  lines.push(...(run.cleanups.length > 0 ? run.cleanups.map((cleanup) => `${statusIcon(cleanup.status)} ${cleanup.label}${cleanup.resultSummary ? `   ${cleanup.resultSummary}` : ""}${durationSuffix(cleanup.status, cleanup.durationSeconds)}${statusDetail(cleanup.status)}`) : ["○ none"]))

  const openDecisions = run.decisions.filter((decision) => decision.status !== "answered")
  if (run.status === "blocked" || openDecisions.length > 0) {
    lines.push("", "Decisions")
    lines.push(...(openDecisions.length > 0 ? openDecisions.map((decision) => `${decisionIcon(decision.status)} ${decision.label}${decision.options?.length ? `   Options: ${decision.options.join(" | ")}` : ""}${decision.answer ? `   Answer: ${decision.answer}` : ""}`) : ["! blocked"]))
  }

  return `${lines.join("\n")}\n`
}

function runView(run: RunRecord) {
  return {
    id: run.id,
    title: run.title,
    projectPath: run.projectPath,
    tier: run.tier,
    status: run.status,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
    summary: run.summary,
    durationSeconds: durationSeconds(run.startedAt, run.completedAt ?? run.updatedAt),
    phases: run.phases.map((phase) => ({ ...phase })),
    workers: run.workers.map((worker) => ({ ...worker })),
    validations: run.validations.map((validation) => ({ ...validation })),
    cleanups: run.cleanups.map((cleanup) => ({ ...cleanup })),
    decisions: run.decisions.map((decision) => ({ ...decision })),
    events: run.events.map((event) => ({ id: event.id, type: event.type, timestamp: event.timestamp, message: event.message })),
  }
}

function normalizeRun(value: unknown): RunRecord {
  const run = isRecord(value) ? value : {}
  const startedAt = typeof run.startedAt === "string" ? isoNow(run.startedAt) : isoNow()
  return {
    id: typeof run.id === "string" && run.id.trim() ? assertSafeID(run.id, "run.id") : generateID("cockpit"),
    title: typeof run.title === "string" && run.title.trim() ? run.title.trim() : "Untitled cockpit run",
    projectPath: typeof run.projectPath === "string" && run.projectPath.trim() ? run.projectPath.trim() : undefined,
    tier: run.tier === "S" || run.tier === "M" || run.tier === "L" || run.tier === "XL" ? run.tier : "L",
    status: isRunStatus(run.status) ? run.status : "planned",
    startedAt,
    updatedAt: typeof run.updatedAt === "string" ? isoNow(run.updatedAt) : startedAt,
    completedAt: typeof run.completedAt === "string" ? isoNow(run.completedAt) : undefined,
    summary: typeof run.summary === "string" && run.summary.trim() ? run.summary.trim() : undefined,
    phases: normalizePhaseList(run.phases),
    workers: normalizeWorkerList(run.workers),
    validations: normalizeValidationList(run.validations),
    cleanups: normalizeCleanupList(run.cleanups),
    decisions: normalizeDecisionList(run.decisions),
    events: normalizeEventList(run.events),
  }
}

function normalizePhaseList(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        if (!isRecord(item)) return []
        const record: PhaseRecord = {
          id: typeof item.id === "string" && item.id.trim() ? assertSafeID(item.id, "phase.id") : generateID("phase"),
          label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : typeof item.name === "string" && item.name.trim() ? item.name.trim() : "phase",
          status: isItemStatus(item.status) ? item.status : "pending",
          startedAt: typeof item.startedAt === "string" ? isoNow(item.startedAt) : undefined,
          completedAt: typeof item.completedAt === "string" ? isoNow(item.completedAt) : undefined,
          durationSeconds: typeof item.durationSeconds === "number" ? item.durationSeconds : undefined,
          message: typeof item.message === "string" && item.message.trim() ? item.message.trim() : undefined,
        }
        return [record]
      })
    : []
}

function normalizeWorkerList(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        if (!isRecord(item)) return []
        const record: WorkerRecord = {
          id: typeof item.id === "string" && item.id.trim() ? assertSafeID(item.id, "worker.id") : generateID("worker"),
          label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : typeof item.name === "string" && item.name.trim() ? item.name.trim() : "worker",
          type: normalizeWorkerType(item.type) ?? "implementation",
          status: isItemStatus(item.status) ? item.status : "pending",
          scope: typeof item.scope === "string" && item.scope.trim() ? item.scope.trim() : undefined,
          risk: item.risk === "low" || item.risk === "medium" || item.risk === "high" ? item.risk : undefined,
          startedAt: typeof item.startedAt === "string" ? isoNow(item.startedAt) : undefined,
          completedAt: typeof item.completedAt === "string" ? isoNow(item.completedAt) : undefined,
          durationSeconds: typeof item.durationSeconds === "number" ? item.durationSeconds : undefined,
          worktreePath: typeof item.worktreePath === "string" && item.worktreePath.trim() ? item.worktreePath.trim() : undefined,
          branch: typeof item.branch === "string" && item.branch.trim() ? item.branch.trim() : undefined,
          resultSummary: typeof item.resultSummary === "string" && item.resultSummary.trim() ? item.resultSummary.trim() : undefined,
          validationStatus: isItemStatus(item.validationStatus) ? item.validationStatus : undefined,
          preservedReason: typeof item.preservedReason === "string" && item.preservedReason.trim() ? item.preservedReason.trim() : undefined,
        }
        return [record]
      })
    : []
}

function normalizeValidationList(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        if (!isRecord(item)) return []
        const record: ValidationRecord = {
          id: typeof item.id === "string" && item.id.trim() ? assertSafeID(item.id, "validation.id") : generateID("validation"),
          label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : typeof item.name === "string" && item.name.trim() ? item.name.trim() : "validation",
          command: typeof item.command === "string" && item.command.trim() ? item.command.trim() : undefined,
          status: isItemStatus(item.status) ? item.status : "pending",
          startedAt: typeof item.startedAt === "string" ? isoNow(item.startedAt) : undefined,
          completedAt: typeof item.completedAt === "string" ? isoNow(item.completedAt) : undefined,
          durationSeconds: typeof item.durationSeconds === "number" ? item.durationSeconds : undefined,
          resultSummary: typeof item.resultSummary === "string" && item.resultSummary.trim() ? item.resultSummary.trim() : undefined,
        }
        return [record]
      })
    : []
}

function normalizeCleanupList(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        if (!isRecord(item)) return []
        const record: CleanupRecord = {
          id: typeof item.id === "string" && item.id.trim() ? assertSafeID(item.id, "cleanup.id") : generateID("cleanup"),
          label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : typeof item.name === "string" && item.name.trim() ? item.name.trim() : "cleanup",
          status: isItemStatus(item.status) ? item.status : "pending",
          startedAt: typeof item.startedAt === "string" ? isoNow(item.startedAt) : undefined,
          completedAt: typeof item.completedAt === "string" ? isoNow(item.completedAt) : undefined,
          durationSeconds: typeof item.durationSeconds === "number" ? item.durationSeconds : undefined,
          resultSummary: typeof item.resultSummary === "string" && item.resultSummary.trim() ? item.resultSummary.trim() : undefined,
          preservedReason: typeof item.preservedReason === "string" && item.preservedReason.trim() ? item.preservedReason.trim() : undefined,
        }
        return [record]
      })
    : []
}

function normalizeDecisionList(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        if (!isRecord(item)) return []
        const record: DecisionRecord = {
          id: typeof item.id === "string" && item.id.trim() ? assertSafeID(item.id, "decision.id") : generateID("decision"),
          label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : typeof item.name === "string" && item.name.trim() ? item.name.trim() : "decision",
          status: item.status === "needed" || item.status === "answered" || item.status === "deferred" ? item.status : "needed",
          requestedAt: typeof item.requestedAt === "string" ? isoNow(item.requestedAt) : isoNow(),
          answeredAt: typeof item.answeredAt === "string" ? isoNow(item.answeredAt) : undefined,
          options: Array.isArray(item.options) ? item.options.filter((option): option is string => typeof option === "string" && option.trim().length > 0).map((option) => option.trim()) : undefined,
          answer: typeof item.answer === "string" && item.answer.trim() ? item.answer.trim() : undefined,
        }
        return [record]
      })
    : []
}

function normalizeEventList(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        if (!isRecord(item) || typeof item.type !== "string") return []
        const record: RunEvent = {
          id: typeof item.id === "string" && item.id.trim() ? assertSafeID(item.id, "event.id") : generateID("event"),
          type: item.type.trim(),
          timestamp: typeof item.timestamp === "string" ? isoNow(item.timestamp) : isoNow(),
          targetID: typeof item.targetID === "string" && item.targetID.trim() ? assertSafeID(item.targetID.trim(), "targetID") : undefined,
          message: typeof item.message === "string" && item.message.trim() ? item.message.trim() : undefined,
          data: safeRecord(item.data),
        }
        return [record]
      })
    : []
}

function resolveConfigDir(configDir?: string) {
  const trimmed = configDir?.trim()
  return trimmed ? trimmed : join(process.env.HOME || "~", ".config", "opencode")
}

function cockpitDir(configDir: string) {
  return join(configDir, "cockpit")
}

function runFilePath(configDir: string, runID: string) {
  return join(cockpitDir(configDir), `${runID}.json`)
}

function generateID(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function assertSafeID(value: string, name: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`${name} contains unsupported characters`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isoNow(value?: string) {
  if (!value) return new Date().toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function isRunStatus(value: unknown): value is RunStatus {
  return value === "planned" || value === "running" || value === "blocked" || value === "completed" || value === "failed" || value === "cancelled"
}

function isItemStatus(value: unknown): value is ItemStatus {
  return value === "pending" || value === "running" || value === "completed" || value === "failed" || value === "cancelled" || value === "skipped"
}

function normalizeWorkerType(value: unknown) {
  return value === "diagnostic" || value === "implementation" || value === "full" || value === "review" ? value : undefined
}

function safeRecord(value: unknown) {
  const safe = jsonSafe(value)
  return isRecord(safe) ? safe : undefined
}

function jsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null) return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "bigint") return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item, seen)).filter((item) => item !== undefined)
  if (!isRecord(value)) return undefined
  if (seen.has(value)) return undefined
  seen.add(value)
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const safe = jsonSafe(item, seen)
    if (safe !== undefined) out[key] = safe
  }
  return out
}

function findOrCreate<T extends { id: string }>(items: T[], id: string, create: () => T) {
  const found = items.find((item) => item.id === id)
  if (found) return found
  const created = create()
  items.push(created)
  return created
}

function resolveTargetID(event: RunEvent) {
  if (typeof event.targetID === "string" && event.targetID.trim()) return assertSafeID(event.targetID, "targetID")
  const data = event.data
  const candidate = [data?.id, data?.phaseID, data?.workerID, data?.validationID, data?.cleanupID, data?.decisionID].find((value) => typeof value === "string" && value.trim())
  if (typeof candidate === "string") return assertSafeID(candidate.trim(), "targetID")
  return assertSafeID(event.id, "event.id")
}

function eventLabel(event: RunEvent, fallback?: string) {
  const value = [event.data?.label, event.data?.name, event.data?.title, event.message, fallback].find((item) => typeof item === "string" && item.trim())
  return typeof value === "string" ? value.trim() : event.type
}

function eventSummary(event: RunEvent, fallback?: string) {
  const value = [event.data?.resultSummary, event.data?.summary, event.message, fallback].find((item) => typeof item === "string" && item.trim())
  return typeof value === "string" ? value.trim() : fallback
}

function durationSeconds(startedAt?: string, completedAt?: string, fallbackEnd?: string) {
  if (!startedAt) return undefined
  const start = Date.parse(startedAt)
  if (Number.isNaN(start)) return undefined
  const end = completedAt ? Date.parse(completedAt) : fallbackEnd ? Date.parse(fallbackEnd) : Date.now()
  if (Number.isNaN(end)) return undefined
  return Math.max(0, Math.floor((end - start) / 1000))
}

function formatDuration(seconds?: number) {
  if (seconds === undefined) return "pending"
  const whole = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

function durationSuffix(status: ItemStatus, seconds?: number) {
  if (status === "pending") return "   pending"
  if (status === "skipped") return seconds !== undefined ? `   ${formatDuration(seconds)}   skipped` : "   skipped"
  return seconds !== undefined ? `   ${formatDuration(seconds)}` : ""
}

function statusDetail(status: ItemStatus) {
  if (status === "running") return "   running"
  if (status === "failed") return "   failed"
  if (status === "cancelled") return "   cancelled"
  return ""
}

function statusIcon(status: ItemStatus | RunStatus) {
  if (status === "completed") return "✓"
  if (status === "running") return "▶"
  if (status === "pending" || status === "planned") return "○"
  if (status === "failed") return "✗"
  if (status === "blocked") return "!"
  if (status === "cancelled") return "✗"
  if (status === "skipped") return "↷"
  return "○"
}

function decisionIcon(status: DecisionStatus) {
  if (status === "answered") return "✓"
  if (status === "deferred") return "↷"
  return "!"
}

function isTerminalRun(status: RunStatus) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

function terminalTimestamp(run: RunRecord) {
  const value = Date.parse(run.completedAt ?? run.updatedAt)
  return Number.isNaN(value) ? 0 : value
}

function runElapsedSeconds(run: RunRecord) {
  return durationSeconds(run.startedAt, run.completedAt ?? run.updatedAt)
}
