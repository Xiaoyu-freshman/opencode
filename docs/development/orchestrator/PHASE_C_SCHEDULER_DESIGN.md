# Phase C Worker Scheduler Design

## Executive Summary

Phase C upgrades Orchestrator execution from prompt-driven soft parallelism to a system-level Worker Scheduler. The goal is bounded, observable, cancellable worker execution with durable state, explicit concurrency limits, worktree isolation, and result collection.

The first implementation should preserve the existing Orchestrator/Bus/Worker SOP from Phase B. Orchestrator remains the user-facing decision surface, Bus and Workers keep their current responsibilities where useful, and worktrees remain the isolation boundary. Phase C should not attempt to build a full DAG engine, multi-model platform, long-running job service, or general distributed execution system in the first pass.

The practical target is a minimal scheduler that can launch a known set of workers for L/XL and selected M tasks, track them, bound parallelism, collect results, and hand control back to Orchestrator for verification, user confirmation, commits, pushes, releases, and final reporting.

## Current State Recap

Phase B defines task-tier SOP:

| Tier | Current Execution Path |
| --- | --- |
| S | Orchestrator answers directly or performs narrow read-only work. |
| M | Orchestrator usually uses a light Bus path for one bounded worker. |
| L | Orchestrator confirms scope, dispatches Bus/Worker execution, and verifies results. |
| XL | Orchestrator confirms architecture, rollback, validation, and full Bus/Worker flow. |

Current architecture:

- Orchestrator classifies tasks as S/M/L/XL, owns user interaction, and decides whether Bus/Worker execution is warranted.
- Orchestrator uses `orchestrate` to prepare a Bus-ready prompt, then dispatches `task({ subagent_type: "bus" })`.
- Bus coordinates workers through prompt instructions and reports back to Orchestrator.
- Workers remain specialized execution agents such as diagnostic, implementation, review, or full-scope workers.
- The `worktree` tool provides git worktree isolation for implementation tasks.
- `task-state`, `progress-display`, `log-viewer`, `error-display`, `error-handler`, `concurrency-manager`, `memory-manager`, `storage-manager`, `performance-monitor`, and `orchestrator-health` already provide pieces of state, visibility, recovery, and resource management.

Known limitations:

- Parallelism is soft. It depends on prompt discipline and whatever execution behavior the `task` tool provides.
- There is no durable scheduler-owned plan that records all worker runs, dependencies, statuses, retries, timeouts, worktree assignments, and collected summaries.
- There is no system-level concurrency contract across workers beyond advisory prompts and standalone resource tools.
- Cancellation and cleanup are not modeled as first-class scheduler actions.
- Verification is prompt-driven rather than attached to explicit worker acceptance criteria and collected artifacts.
- There is no dynamic model routing. Agent-level model configuration is the effective routing mechanism.
- There is no DAG, checkpoint, resume, or dependency-aware execution model.

## Proposed Architecture

```text
User
  -> Orchestrator
      -> Worker Scheduler
          -> Bus and/or Workers
              -> Worktree-isolated execution
      -> Verification and final user report
```

### Orchestrator

Orchestrator remains the user-facing decision surface.

Responsibilities:

- Classify task tier using the Phase B S/M/L/XL SOP.
- Decide whether direct execution, Bus execution, or Scheduler execution is appropriate.
- Ask for user confirmation before high-risk work.
- Build or approve the scheduler plan.
- Preserve policy decisions around scope, safety, validation, rollback, and final acceptance.
- Review collected results and decide whether to continue, retry, ask the user, or stop.
- Own commits, pushes, releases, destructive operations, and global config changes only after explicit authorization.

### Worker Scheduler

The Scheduler is the execution coordinator for L/XL and selected M tasks.

Responsibilities:

- Accept an explicit worker plan from Orchestrator.
- Create durable scheduler records.
- Bound concurrent workers.
- Create or assign worktrees.
- Launch worker runs when supported by the implementation location.
- Track lifecycle status, retries, timeouts, cancellation, logs, and result summaries.
- Collect worker outputs into a structured report for Orchestrator or Bus verification.
- Preserve failed worktrees for inspection.
- Clean up successful disposable worktrees only when policy allows.

The Scheduler should not make product decisions, silently expand scope, perform commits/pushes/releases, or bypass confirmation rules.

### Bus Relationship Options

There are two viable integration paths.

Option A: Scheduler below Bus.

- Orchestrator continues to dispatch Bus for L/XL tasks.
- Bus uses Scheduler to run concrete workers.
- Bus remains the policy, verification, and synthesis layer.
- This preserves existing SOP and minimizes Orchestrator changes.
- Risk: plugin/tool limitations may prevent Bus from invoking the same task capabilities needed by Scheduler.

Option B: Scheduler beside or instead of Bus.

- Orchestrator calls Scheduler directly for parallel worker execution.
- Scheduler returns structured results to Orchestrator.
- Bus becomes optional for verification, synthesis, or complex policy review.
- This reduces prompt chaining and makes execution state clearer.
- Risk: Scheduler may absorb too much Bus behavior unless boundaries are enforced.

C1 recommends designing for both but implementing the smallest workable path in C2. If custom tools cannot invoke the built-in `task` tool directly, the first implementation may need to live as a Bus agent enhancement or as a built-in/core capability rather than a standalone plugin tool.

## C2 Feasibility Spike Findings

The spike supports the earlier observation: a custom plugin tool can manage scheduler state and return instructions, but it does not receive a host capability for directly invoking the built-in `task` tool or creating/running subagent sessions.

Findings with code references:

- Plugin tool runtime context is small by design. `packages/plugin/src/tool.ts` exposes `ToolContext` with `sessionID`, `messageID`, `agent`, `directory`, `worktree`, `abort`, `metadata`, and `ask`; it does not expose the tool registry, built-in tool execution, `Session.Service`, prompt operations, or an OpenCode runtime handle.
- Core tools receive a richer internal context. `packages/opencode/src/tool/tool.ts` defines `Tool.Context` with `extra`, `messages`, Effect-returning `metadata`, and Effect-returning `ask`. This internal shape is not the same interface exported to plugin tools.
- The registry explicitly adapts core `Tool.Context` into the narrower plugin `ToolContext`. In `packages/opencode/src/tool/registry.ts`, `fromPlugin` creates `pluginCtx` by spreading selected tool context fields and adding `directory`, `worktree`, and a Promise bridge for `ask`; it does not pass `toolCtx.extra`, `messages`, the registry, the Session service, or `promptOps`.
- The built-in `task` tool depends on core-only services and context. `packages/opencode/src/tool/task.ts` yields `Agent.Service`, `BackgroundJob.Service`, `Config.Service`, `Session.Service`, `RuntimeFlags.Service`, and `Scope`, creates child sessions through `sessions.create`, and requires `ctx.extra?.promptOps` to resolve prompt parts, prompt the child session, and cancel child execution. A plugin `ToolContext` has none of those capabilities.
- Prompt-time tool execution wires `promptOps` only into internal tool context. `packages/opencode/src/session/tools.ts` creates `Tool.Context.extra` with `{ model, bypassAgentCheck, promptOps }` before calling `item.execute`. The plugin adapter does not forward this `extra` object to plugin code.
- Plugin hooks can observe and mutate selected surfaces, but not dispatch tools. `packages/plugin/src/index.ts` exposes plugin `tool` definitions plus hooks such as `chat.message`, `chat.params`, `tool.execute.before`, and `tool.execute.after`; none is a general host callback for invoking another tool or launching a subagent.
- External plugin initialization receives an SDK client, project, directory, worktree, server URL, shell, and workspace adapter registration in `packages/opencode/src/plugin/index.ts`. That SDK client is useful for public HTTP API operations, but the inspected scheduler-critical path is the internal `TaskTool`/`SessionPrompt` path, not a public "run subagent task" API passed to tools.
- Importing internal OpenCode services from a global `.opencode/tool/*.ts` would be brittle. The custom tool contract is `@opencode-ai/plugin/tool`; `opencode` is not a stable plugin SDK package, its service modules are Effect-layered internals, and packaged Desktop may not expose the same source-tree module paths or workspace dependencies that exist in this repo checkout. Even if an import resolved in development, it would bypass the runtime services and `promptOps` that are constructed inside a live prompt execution.

Conclusion:

- A custom scheduler plugin tool cannot directly invoke the built-in `task` tool through its `ToolContext`.
- A custom scheduler plugin tool cannot safely create and run subagent sessions through `Session.Service` because the service and required prompt operations are not exposed through the plugin tool interface.
- True automatic worker launching belongs behind a core seam, either as a built-in scheduler tool/core service or as a change to the host plugin/tool interface that deliberately exposes a constrained launch capability.

Recommended C2 implementation location:

- Use the hybrid path for the next smallest step: a plugin scheduler tool manages explicit plans, durable status, worktree assignments, event logs, and runnable worker prompts; Orchestrator or Bus still calls `task` explicitly for each worker according to the plan.
- Do not implement a core scheduler tool in C2 unless automatic launch is the required acceptance criterion. A built-in scheduler is the right location for true concurrency-controlled worker launching, cancellation, and prompt/session ownership, but it is a larger core change.
- Treat Bus-only prompt-assisted scheduling as a fallback or companion, not the state owner. It preserves current behavior but does not create the durable scheduler seam C2 is trying to validate.

Revised C2 plan:

- Implement `scheduler` as a consolidated plugin custom tool only for `plan`, `status`, `record`, `collect`, and conservative `cleanup`/`cancel` state transitions.
- Have `plan` return the exact `task` calls Orchestrator or Bus should make, including `subagent_type`, `description`, `prompt`, optional `worktree`, and acceptance criteria.
- Have Orchestrator or Bus execute those `task` calls explicitly, then call `scheduler record` with returned task IDs, status updates, summaries, errors, and artifact/worktree details.
- Use existing `worktree`, `task-state`, `log-viewer`, `progress-display`, and `concurrency-manager` tools as advisory/state components, but do not claim plugin-level hard concurrency over `task` execution until a core launch capability exists.
- Revisit a built-in scheduler tool only after the hybrid path proves the data model, reporting, and workflows are useful enough to justify moving launch control into core.

C2 implementation note:

- The hybrid `scheduler` custom tool now exists at `.opencode/tool/scheduler.ts` and stores durable JSON task files under `~/.config/opencode/scheduler/` by default.
- It implements `plan`, `status`, `record`, `collect`, `cancel`, and `cleanup`; `cleanup` removes only scheduler state files.
- `plan` returns `taskCalls` for Orchestrator or Bus to execute explicitly with the built-in `task` tool, and `collect` returns `requiresOrchestratorVerification: true` to preserve the Phase B verification boundary.
- The tool intentionally does not import OpenCode internals, call built-in `task`, interrupt live subagents, remove worktrees, or provide hard concurrency enforcement.

Risks and caveats:

- Hybrid scheduling is not a hard scheduler. Concurrency depends on Orchestrator/Bus following the returned plan and on explicit `task` calls, so it remains prompt-assisted execution with better state.
- Cancellation can mark planned/running worker records as cancelled, but it cannot interrupt a subagent launched by a separate `task` call unless core exposes that handle or Orchestrator/Bus performs the cancellation path.
- Result collection depends on Orchestrator/Bus recording task IDs and summaries accurately.
- A future core scheduler should reuse the validated data model where possible, but should own session creation, prompt operations, cancellation, background job integration, and concurrency enforcement inside OpenCode core.

### Workers

Workers remain specialized execution agents.

Expected worker classes:

- Diagnostic: read-only reproduction, root cause, logs, and constraints.
- Implementation: bounded code/config/docs changes in an assigned worktree.
- Review: strict verification, risk identification, missing tests, and behavioral regression analysis.
- Full: combined diagnostic, implementation, and verification only when explicitly appropriate.

Each worker run receives a bounded prompt, assigned scope, timeout, acceptance criteria, model hint if any, and reporting template.

### Worktrees

Worktrees remain the isolation boundary for implementation and risky verification work.

Rules:

- Prefer one worktree per implementation worker unless workers intentionally share a branch.
- Read-only diagnostic workers may run in the main workspace when safe, but Scheduler should record that no worktree was assigned.
- Failed or cancelled implementation worktrees are preserved by default.
- Successful worktrees are cleaned up only after results are collected and Orchestrator confirms no further inspection is needed, or after an explicit cleanup policy says they are disposable.

## Data Model Draft

The data model should be durable JSON-compatible state. It can initially be stored through `task-state` metadata or a scheduler-specific state directory under the managed OpenCode config. C2 should avoid introducing a database unless file-based state is insufficient.

### SchedulerTask

Represents a user-visible scheduled execution plan.

```ts
type SchedulerTask = {
  id: string
  title: string
  repoPath: string
  tier: "M" | "L" | "XL"
  status: SchedulerTaskStatus
  createdAt: string
  updatedAt: string
  createdBy: "orchestrator" | "bus"
  riskLevel: "low" | "medium" | "high"
  requiresConfirmation: boolean
  confirmedAt?: string
  maxConcurrentWorkers: number
  timeoutMs?: number
  acceptanceCriteria: string[]
  validationCommands: string[]
  workerRuns: string[]
  events: string[]
  resultSummary?: string
  failureSummary?: string
}

type SchedulerTaskStatus =
  | "planned"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "verified"
  | "cleaned_up"
```

### WorkerRun

Represents one concrete worker execution.

```ts
type WorkerRun = {
  id: string
  schedulerTaskId: string
  name: string
  workerType: "diagnostic" | "implementation" | "review" | "full"
  status: WorkerRunStatus
  prompt: string
  scope: string[]
  acceptanceCriteria: string[]
  modelHint?: ModelHint
  worktreeAssignmentId?: string
  queuedAt?: string
  startedAt?: string
  completedAt?: string
  timeoutMs?: number
  retryCount: number
  maxRetries: number
  lastError?: string
  resultSummary?: string
  artifacts: string[]
}

type WorkerRunStatus =
  | "planned"
  | "queued"
  | "worktree_created"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "verified"
  | "cleaned_up"

type ModelHint = {
  role: "orchestrator" | "diagnostic" | "implementation" | "review"
  preference: "fast" | "cheap" | "strong_code" | "strong_reasoning" | "strict_review"
  optional: true
}
```

### WorktreeAssignment

Represents the git isolation assigned to a worker.

```ts
type WorktreeAssignment = {
  id: string
  schedulerTaskId: string
  workerRunId: string
  repoPath: string
  worktreePath: string
  branch: string
  base: string
  status: "planned" | "created" | "preserved" | "removed" | "failed"
  createdAt?: string
  cleanedUpAt?: string
  preserveReason?: string
}
```

### SchedulerEvent

Represents append-only execution history.

```ts
type SchedulerEvent = {
  id: string
  schedulerTaskId: string
  workerRunId?: string
  timestamp: string
  level: "debug" | "info" | "warn" | "error"
  type:
    | "task_planned"
    | "task_queued"
    | "worker_queued"
    | "worktree_created"
    | "worker_started"
    | "worker_completed"
    | "worker_failed"
    | "worker_cancelled"
    | "retry_scheduled"
    | "timeout"
    | "results_collected"
    | "verification_completed"
    | "cleanup_completed"
  message: string
  details?: Record<string, unknown>
}
```

## API And Tool Surface Draft

Either separate tools or one consolidated scheduler tool can satisfy C2. After the feasibility spike, the C2 plugin form should be treated as a scheduler plan/status tool rather than a direct worker launcher. A consolidated tool is still likely easier to install globally and version with the existing Orchestrator tools.

### Preferred C2 Shape: Consolidated Tool

Tool name: `scheduler`

Actions:

- `plan`
- `record`
- `status`
- `cancel`
- `collect`
- `cleanup`

Example `plan` input:

```json
{
  "action": "plan",
  "title": "Refactor package validation flow",
  "repoPath": "/Users/tom/Documents/Project/opencode",
  "tier": "L",
  "maxConcurrentWorkers": 2,
  "acceptanceCriteria": ["Preserve existing behavior", "Run package typecheck"],
  "validationCommands": ["bun typecheck from affected package"],
  "workers": [
    {
      "name": "diagnose current validation flow",
      "workerType": "diagnostic",
      "scope": ["packages/opencode/src/config"],
      "prompt": "Map current validation flow and identify coupling.",
      "timeoutMs": 900000,
      "maxRetries": 0
    },
    {
      "name": "implement minimal refactor",
      "workerType": "implementation",
      "scope": ["packages/opencode/src/config"],
      "prompt": "Implement the approved minimal refactor only.",
      "timeoutMs": 1800000,
      "maxRetries": 1,
      "requiresWorktree": true
    }
  ]
}
```

Example `plan` output:

```json
{
  "ok": true,
  "schedulerTaskId": "sched_20260601_abc123",
  "status": "planned",
  "workerRuns": ["worker_diag_001", "worker_impl_001"],
  "requiresConfirmation": true,
  "nextAction": "dispatch_task_calls"
}
```

Example dispatch instructions returned by `plan`:

```json
[
  {
    "workerRunId": "worker_diag_001",
    "tool": "task",
    "args": {
      "description": "diagnose validation flow",
      "subagent_type": "diagnostic",
      "prompt": "Map current validation flow and identify coupling."
    }
  }
]
```

Example `status` output:

```json
{
  "ok": true,
  "schedulerTaskId": "sched_20260601_abc123",
  "status": "running",
  "workers": [
    { "id": "worker_diag_001", "status": "completed", "retryCount": 0 },
    { "id": "worker_impl_001", "status": "running", "retryCount": 0 }
  ],
  "events": ["worker_diag_001 completed", "worker_impl_001 running"]
}
```

Example `cancel` input:

```json
{
  "action": "cancel",
  "schedulerTaskId": "sched_20260601_abc123",
  "reason": "User changed scope",
  "preserveWorktrees": true
}
```

Example `collect` output:

```json
{
  "ok": true,
  "schedulerTaskId": "sched_20260601_abc123",
  "status": "completed",
  "resultSummary": "Diagnostic completed and implementation worker produced changes in one worktree.",
  "workers": [
    {
      "id": "worker_diag_001",
      "status": "completed",
      "resultSummary": "Validation flow crosses config loader and schema modules."
    },
    {
      "id": "worker_impl_001",
      "status": "completed",
      "worktreePath": "/path/to/worktree",
      "resultSummary": "Minimal refactor applied; typecheck passed."
    }
  ],
  "requiresOrchestratorVerification": true
}
```

### Alternative Separate Tool Names

If separate tools fit OpenCode conventions better, use:

- `scheduler-plan`
- `scheduler-run`
- `scheduler-status`
- `scheduler-cancel`
- `scheduler-collect`

The payloads should remain the same as the consolidated tool actions.

## Worker Lifecycle

Lifecycle:

```text
planned -> queued -> worktree_created -> running -> completed/failed/cancelled -> verified -> cleaned_up
```

Lifecycle behavior:

- `planned`: The worker exists in durable state but has not been admitted to the queue.
- `queued`: The worker is waiting for concurrency and resource checks.
- `worktree_created`: The assigned worktree exists and branch metadata is recorded.
- `running`: The worker has been launched or delegated through Bus/task execution.
- `completed`: The worker returned a successful result summary.
- `failed`: The worker failed, exceeded retries, or returned an unusable result.
- `cancelled`: The scheduler or user cancelled the worker before completion.
- `verified`: Bus or Orchestrator accepted the worker output against acceptance criteria.
- `cleaned_up`: Temporary scheduler resources were removed or marked preserved.

Timeout behavior:

- Each WorkerRun may define `timeoutMs`.
- Scheduler marks timed-out workers as `failed` with a `timeout` event.
- Transient timeout retries are allowed only up to `maxRetries`.
- Retried implementation workers should use a fresh worktree unless Orchestrator explicitly approves reuse.

Retry behavior:

- Retry counts are stored on WorkerRun.
- Retries should narrow scope or clarify prompts rather than blindly repeating the same run.
- High-risk workers should not retry automatically without Orchestrator confirmation.
- Failed retries preserve worktrees and logs for inspection.

Cancellation behavior:

- Cancellation records a reason and emits events for task and affected workers.
- Queued workers become `cancelled` immediately.
- Running workers are requested to stop if the execution substrate supports interruption.
- If interruption is not supported, Scheduler records cancellation intent and prevents follow-up work from starting.
- Worktrees are preserved by default after cancellation.

Cleanup behavior:

- Successful read-only workers require only state/log retention.
- Successful implementation worktrees can be removed after result collection and Orchestrator approval.
- Failed, timed-out, or cancelled implementation worktrees are preserved unless the user explicitly requests cleanup.
- Cleanup must never delete the main workspace, untracked user files outside the assigned worktree, or global config files not created by Scheduler.

## Concurrency And Resource Strategy

Scheduler should apply hard execution limits rather than prompt-only guidance.

Minimum strategy for C2:

- Require `maxConcurrentWorkers` on each SchedulerTask, defaulting to a conservative value such as 1 or 2.
- Use `concurrency-manager` to acquire and release worker slots.
- Queue workers that exceed concurrency limits.
- Check memory and storage state before creating worktrees or launching workers.
- Refuse or pause execution when resource tools report critical pressure.
- Record queue wait time and resource-blocked events.
- Avoid writing global OpenCode config during scheduled runs unless the explicit task scope is global config and the user confirmed it.
- Preserve worktrees on failure, timeout, cancellation, and ambiguous results.

Resource tools should support scheduling decisions, but Scheduler state should remain authoritative for worker lifecycle. If a resource tool fails, Scheduler should fail closed for high-risk implementation tasks and report a recoverable error to Orchestrator.

## Model Routing Strategy

C1 does not require dynamic model routing. C2 should use existing agent-level model configuration.

Future model hints can be attached to WorkerRun records as advisory metadata:

- Orchestrator: strong reasoning for task classification, architecture, risk, and user-facing decisions.
- Diagnostic workers: fast or cheap models when the task is log inspection, search, or reproduction; stronger reasoning when root cause is subtle.
- Implementation workers: strong code models for non-trivial edits and behavior changes.
- Review workers: strict reasoning models for regressions, test gaps, security, and architecture risk.

These hints should remain optional until the underlying execution layer can honor them. Scheduler must not depend on model routing for correctness in C2.

## Integration With Current Tools

### `orchestrate`

Use `orchestrate` to prepare Bus-ready prompts when Bus remains in the path. Scheduler plans can reuse the same worker descriptions, acceptance criteria, timeout, and reporting requirements. If Orchestrator calls Scheduler directly, `orchestrate` may still provide prompt normalization and worker prompt structure.

### `task-state`

Use `task-state` for high-level SchedulerTask records if it is sufficient. Scheduler-specific metadata can store WorkerRun IDs, event IDs, status, progress, and result summaries. If this becomes awkward, introduce a scheduler-specific state directory while keeping `task-state` as the user-visible index.

### `worktree`

Use `worktree` for implementation worker isolation. Scheduler should record the returned branch and worktree path in WorktreeAssignment. It should call worktree status before collection and cleanup.

### `concurrency-manager`

Use `concurrency-manager` to bound simultaneous worker execution. Scheduler should release slots in `completed`, `failed`, `cancelled`, and timeout paths.

### `log-viewer`

Use `log-viewer` for structured events and human-readable operational logs. Logs should include scheduler task ID, worker run ID, status transitions, retry decisions, and cleanup decisions.

### `progress-display`

Use `progress-display` to expose overall task progress and current worker status. Progress should be derived from Scheduler state rather than worker prompts.

### `error-handler`

Use `error-handler` to classify execution failures and retry transient failures. Scheduler should still own retry counts, max retry policy, and high-risk confirmation gates.

### `orchestrator-health`

Extend `orchestrator-health` in C2 or C3 to validate scheduler installation, required files, dynamic imports, writable state location, and smoke execution for safe actions such as `status` or a dry-run `plan`.

## Safety And Confirmation

Scheduler must preserve Phase B safety rules.

Required safety constraints:

- No scheduler auto-execution for high-risk tasks without Orchestrator and, when appropriate, user confirmation.
- No commits, pushes, releases, publish steps, destructive git operations, data migrations, or global config writes unless explicitly authorized.
- Prompt sanitization before dispatching workers. Exclude secrets, credentials, tokens, private keys, `.env` contents, sensitive customer data, and unnecessary private context.
- Worker prompts should include explicit scope boundaries and acceptance criteria.
- Scheduler should reject plans that omit repo path, worker type, prompt, scope, or max concurrency.
- Scheduler should not expand task scope after planning. Scope changes require a new plan or Orchestrator confirmation.
- Secrets discovered during execution should be redacted from logs and summaries where possible and reported as a safety issue rather than copied into worker prompts.
- Worktree cleanup should be conservative and path-checked to avoid deleting unintended directories.

## Implementation Plan

### C1: Design Only

- Produce this design document.
- Do not implement scheduler code.
- Use the document to align scope, boundaries, API shape, and non-goals.

### C2: Minimal Scheduler Tool

- Implement the smallest scheduler surface as one consolidated plugin `scheduler` tool with state/planning actions.
- Support a single repository per SchedulerTask.
- Require an explicit worker list; no DAG and no automatic task decomposition.
- Create durable SchedulerTask, WorkerRun, WorktreeAssignment, and SchedulerEvent state.
- Emit bounded dispatch instructions with `maxConcurrentWorkers`; Orchestrator or Bus performs explicit `task` calls in C2.
- Use worktrees for implementation workers by planning or invoking the existing `worktree` tool before dispatch.
- Track statuses and collect result summaries.
- Leave commits, pushes, releases, and final acceptance to Orchestrator/user confirmation.
- Add health checks and focused tests.

### C3: Bus Integration And Verification Reports

- Decide whether Bus calls Scheduler or Orchestrator calls Scheduler directly.
- Add structured verification reports from Bus or review workers.
- Attach verification results to SchedulerTask and WorkerRun records.
- Improve result synthesis for Orchestrator final reports.

### C4: Model Routing And Richer Scheduling

- Add optional model hints to WorkerRun dispatch if the execution layer supports them.
- Improve worker prioritization and queue policy.
- Add better timeout classes by worker type and task tier.
- Add richer resource-aware scheduling.

### C5: DAG, Checkpoint, And Resume If Still Needed

- Add dependencies between WorkerRuns only after explicit worker-list scheduling proves insufficient.
- Add checkpoint/resume for long-running XL tasks.
- Add partial-result reuse and dependency-aware retry.
- Avoid building this unless real workflows demonstrate the need.

## C2 Acceptance Criteria

C2 minimal implementation is acceptable when:

- Orchestrator or Bus can create an explicit scheduler plan with N workers.
- Scheduler returns dispatch batches that respect the configured number of concurrent workers.
- Scheduler tracks planned, queued, running, completed, failed, cancelled, verified, and cleaned-up statuses.
- Implementation workers use git worktrees and record branch/path assignments.
- Scheduler collects worker result summaries into one structured report.
- Failed, cancelled, timed-out, or ambiguous implementation worktrees are preserved.
- Commits, pushes, releases, and destructive operations remain outside Scheduler auto-execution and require Orchestrator/user confirmation.
- `orchestrator-health` or equivalent checks validate scheduler installation and safe smoke behavior.
- Tests cover planning, status transitions, concurrency bounding, cancellation, result collection, and cleanup safety.

## Risks And Open Questions

### Tool Invocation Boundary

Open question: can OpenCode plugin tools directly invoke the built-in `task` tool? If not, a plugin-based Scheduler may be able to plan, track, and collect state, but not actually launch workers.

Implications:

- Scheduler may need to live in core or another built-in execution location to launch workers directly.
- Bus may need to remain the execution layer, with Scheduler acting as durable state and policy scaffolding.
- C2 may need to implement a semi-automatic flow where Scheduler prepares worker runs and Bus/Orchestrator dispatches them explicitly.

### Ownership Location

Open question: should Scheduler be a plugin tool, built-in tool, or Bus agent enhancement?

Tradeoffs:

- Plugin tool: easiest to install with the current global Orchestrator tools, but may lack access to built-in task execution.
- Built-in tool: best execution control and cancellation semantics, but larger core change and release burden.
- Bus enhancement: preserves current workflow and may avoid tool limitations, but keeps more behavior prompt-driven.

C2 should choose the smallest location that can actually launch bounded workers and maintain durable state.

### Avoiding Overbuild

The main product risk is turning Phase C into a general workflow engine too early.

Guardrails:

- No DAG in C2.
- No automatic task decomposition in C2.
- No required model routing in C2.
- No cross-repo scheduling in C2.
- No background daemon unless required by OpenCode execution constraints.
- Prefer explicit plans and conservative defaults.
- Add complexity only after repeated real workflows show the current scheduler cannot express them.
