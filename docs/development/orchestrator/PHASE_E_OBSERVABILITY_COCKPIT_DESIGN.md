# Phase E Observability Cockpit Design

## Purpose

Phase E turns Orchestrator from a sequential text-report coordinator into a visible project control surface.

Previous phases proved that Orchestrator can plan, dispatch Bus/Worker execution, use scheduler state, isolate implementation worktrees, validate results, clean up resources, commit, push, and report project outcomes. The remaining usability gap is observability: during long or parallel work, the user still mostly sees a linear conversation and a final report instead of a live view of phases, workers, elapsed time, validation, cleanup, and blockers.

Phase E should add a Product Mode cockpit that exposes execution state in user-facing project terms while keeping Bus, Worker, Scheduler, `taskCalls`, `workerRunId`, worktree mechanics, and built-in task session details internal.

## Problem statement

Current Orchestrator behavior is operationally capable but visually flat:

- Real workflows can involve diagnosis, implementation, validation, commit/push, CI, and cleanup.
- Parallel worker execution is possible, but the user-facing transcript often still reads like a sequential log.
- Existing state is scattered across `scheduler`, `task-state`, `progress-display`, `log-viewer`, Bus reports, and final Orchestrator summaries.
- The user cannot easily tell which project phase is running, which worker is active, how long each slice has taken, what validation is pending, or whether cleanup has happened.

The product issue is not lack of internal state. The issue is lack of a unified, user-facing run view.

## Goals

- Show a compact cockpit for each Orchestrator-run project workflow.
- Track phase, worker, validation, cleanup, decision, and total run durations.
- Represent parallel workers visually as concurrent rows rather than prose hidden in final reports.
- Preserve Product Mode abstraction: show project-facing labels, status, scope, risk, and elapsed time; do not expose internal protocol details by default.
- Reuse existing scheduler/progress/log/task state where safe, but define one authoritative run-level projection.
- Support both read-only diagnostics and implementation workflows with worktrees.
- Make final reports easier to trust because their validation and cleanup facts are backed by recorded status events.

## Non-goals

- No graphical Desktop UI in the first pass.
- No token-by-token subagent streaming.
- No mandatory DAG engine.
- No automatic worker launch semantics beyond existing Orchestrator/Bus/Scheduler policy.
- No user-facing `taskCalls`, `workerRunId`, built-in `task_id`, or raw scheduler protocol.
- No destructive cancellation or force cleanup controls in the cockpit MVP.
- No cross-repo dashboard in the first pass.

## Product Mode display contract

The user should see project-level execution state like this:

```text
Snow Motion Lab stabilization

Status: running        Tier: L        Elapsed: 18:34

Phases
✓ 1. Project diagnosis                  00:42
✓ 2. Risk analysis                       01:10
▶ 3. C-side implementation               06:31
○ 4. Validation                          pending
○ 5. Commit / push / cleanup             pending

Workers
✓ C-side core stabilization   implementation   06:31
▶ C-side dedupe review        review           02:18 running

Validation
○ ruff
○ black --check
○ mypy
○ pytest

Cleanup
○ worker worktrees
○ local worker branches
```

The user should not be asked to operate internal scheduler records or worker session IDs. If traceability is useful, internal IDs may appear only in audit sections, recovery notes, or explicit infrastructure tests.

## Run state model

Phase E introduces an Orchestrator Run as the user-facing projection for one workflow.

```ts
type RunStatus = "planned" | "running" | "blocked" | "completed" | "failed" | "cancelled"
type ItemStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "skipped"

type OrchestratorRun = {
  id: string
  title: string
  projectPath?: string
  tier: "S" | "M" | "L" | "XL"
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
```

### Phase records

```ts
type PhaseRecord = {
  id: string
  label: string
  status: ItemStatus
  startedAt?: string
  completedAt?: string
  durationSeconds?: number
  message?: string
}
```

Examples:

- `Project diagnosis`
- `Risk analysis`
- `Implementation`
- `Validation`
- `Commit / push / cleanup`

### Worker records

```ts
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
```

User-facing displays should show worker labels, type, status, elapsed time, and high-level scope. Worktree path and branch are useful in detailed reports, failure reports, and audit output, but should not dominate the normal cockpit.

### Validation records

```ts
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
```

Validation records are intentionally user-facing. They should say what was checked and whether it passed. Full output remains in logs or final reports when needed.

### Cleanup records

```ts
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
```

Cleanup records distinguish successful cleanup from intentional preservation. This supports the worker worktree cleanup policy without hiding leftovers.

### Decision records

```ts
type DecisionRecord = {
  id: string
  label: string
  status: "needed" | "answered" | "deferred"
  requestedAt: string
  answeredAt?: string
  options?: string[]
  answer?: string
}
```

Decision records let Orchestrator show why a run is blocked without exposing internal mechanics.

## Event model

The cockpit stores append-only events and projects them into the run state.

Recommended event names:

- `run.planned`
- `run.started`
- `run.blocked`
- `run.completed`
- `run.failed`
- `phase.started`
- `phase.completed`
- `phase.failed`
- `worker.planned`
- `worker.started`
- `worker.completed`
- `worker.failed`
- `validation.planned`
- `validation.started`
- `validation.completed`
- `validation.failed`
- `cleanup.planned`
- `cleanup.started`
- `cleanup.completed`
- `cleanup.preserved`
- `decision.needed`
- `decision.answered`

Each event should include:

```ts
type RunEvent = {
  id: string
  type: string
  timestamp: string
  targetID?: string
  message?: string
  data?: Record<string, unknown>
}
```

Events are not a substitute for final verification. They are an observability layer that helps Orchestrator and the user understand where the workflow is.

## Relationship to existing tools

### `scheduler`

Scheduler remains useful for durable worker plan/status/collection state. It is closest to a worker lifecycle authority for scheduler-backed runs.

Phase E should not duplicate scheduler internals. Instead, the cockpit should project scheduler facts into user-facing records:

- worker planned/running/completed/failed
- worker result summaries
- worktree assignment summaries
- collection outcome

### `progress-display`

`progress-display` currently supports one current task plus history. Phase E should either extend it or let a new cockpit tool produce the richer display.

Preferred MVP: create a cockpit-specific tool and leave `progress-display` as a lightweight compatibility display.

### `log-viewer`

`log-viewer` should remain the append-only operational log store for detailed events. Cockpit events can also be mirrored to `log-viewer` for searchable history.

### `task-state`

`task-state` remains appropriate for coarse asynchronous task records. Cockpit state is richer and should not force all phase/worker/validation records into `task-state` metadata unless that proves sufficient.

### Bus agent

Bus is the most practical place to emit cockpit events during implementation workflows because it observes:

- worktree creation
- worker dispatch
- worker result collection
- diff review
- validation commands
- cleanup decisions

Bus should emit cockpit events as part of its standard operating rules.

### Orchestrator agent

Orchestrator owns the user-facing display and decisions:

- create a run when an M/L/XL workflow begins
- name phases and workers in user language
- display cockpit snapshots during long-running work
- convert cockpit state into final success/partial/failure reports
- ask for confirmation when decisions are needed

## Proposed tool: `orchestrator-cockpit`

The MVP should be a new OpenCode tool stored under `.opencode/tool/orchestrator-cockpit.ts`.

Actions:

- `create`: create a run record
- `event`: append an event and update projected state
- `status`: return the structured state
- `display`: return a user-facing text cockpit
- `complete`: mark a run terminal with a summary
- `cleanup`: remove old terminal run records

Optional future actions:

- `list`: list recent runs
- `export`: export run plus events for audit
- `attach`: attach scheduler task IDs or built-in session IDs as internal trace metadata

Storage:

```text
~/.config/opencode/cockpit/<run-id>.json
```

State should be JSON-compatible and safe to inspect. It must not store secrets, `.env` contents, private keys, or raw customer data.

## Display format requirements

The MVP display should be plain text and stable enough for Orchestrator to paste into the conversation.

Required sections:

1. Header: title, status, tier, elapsed time.
2. Phases: ordered list with status icons and durations.
3. Workers: rows with label, type, status, and duration.
4. Validation: checks and pass/fail/pending status.
5. Cleanup: cleaned or preserved resources.
6. Decisions: only when the run is blocked or waiting for user input.

Status icon convention:

- `✓` completed
- `▶` running
- `○` pending
- `✗` failed
- `!` blocked or decision needed
- `↷` preserved/skipped when intentional

## Bus SOP changes

Update Bus instructions to emit cockpit events at these points:

1. Before work begins: `run.started` and initial `phase.started`.
2. When planning each worker: `worker.planned`.
3. Immediately before launching a worker: `worker.started`.
4. After worker return: `worker.completed` or `worker.failed`.
5. Before each validation command group: `validation.started`.
6. After validation: `validation.completed` or `validation.failed`.
7. Before cleanup: `cleanup.started`.
8. After cleanup or preservation: `cleanup.completed` or `cleanup.preserved`.
9. At the end: `run.completed`, `run.failed`, or `run.blocked`.

Bus should not ask the user to operate the cockpit. It should return the cockpit summary to Orchestrator, and Orchestrator decides what to show.

## Orchestrator SOP changes

Update Orchestrator instructions:

- For M/L/XL work, create a cockpit run when execution begins.
- Include cockpit run title, tier, scope, phases, and expected validation in the Bus prompt.
- During long-running or multi-worker work, show cockpit snapshots instead of only prose progress updates.
- In final reports, include a compact cockpit-derived section:
  - total duration
  - worker durations
  - validation summary
  - cleanup summary
  - blockers or preserved resources

## Acceptance criteria for Phase E MVP

Phase E MVP is acceptable when:

- A run record can be created for an Orchestrator workflow.
- Phase, worker, validation, cleanup, and decision events can be appended.
- Durations are calculated from start/end timestamps.
- `display` renders a compact, user-facing cockpit view.
- Bus SOP requires cockpit event emission for implementation workflows.
- Orchestrator SOP requires cockpit snapshots for long-running or multi-worker work.
- Health checks include the new cockpit tool and a safe smoke action.
- Tests cover create, event projection, display formatting, terminal completion, and cleanup of old terminal runs.
- A real project validation records at least two workers, validation status, and cleanup status.

## Implementation plan

### E1: Design only

- Add this design document.
- Do not implement the cockpit tool yet.
- Use the document to align user-facing product requirements and internal state boundaries.

### E2: Minimal cockpit tool

- Implement `.opencode/tool/orchestrator-cockpit.ts`.
- Add the tool to global install and health checks.
- Add focused tests under `packages/opencode/test/tool/`.
- Keep storage file-based.

### E3: Agent SOP integration

- Update Orchestrator and Bus agent prompts.
- Add standard cockpit snapshot sections to result reports.
- Keep internal IDs out of default user-facing displays.

### E4: Real workflow validation

- Run a real `ski-video-review` task with at least two workers or two phases that would benefit from status visibility.
- Capture cockpit snapshots during execution and final report.
- Record validation in `docs/development/orchestrator/PHASE_E_COCKPIT_VALIDATION.md`.

### E5: Optional richer display

- Improve text alignment and duration formatting.
- Add list/export actions if audit use becomes frequent.
- Consider Desktop UI integration only after the text cockpit proves useful.

## Risks and mitigations

### Risk: overbuilding a workflow engine

Mitigation: keep cockpit as a projection layer. Scheduler and Bus still own execution mechanics.

### Risk: exposing internal protocol details

Mitigation: separate user-facing labels from internal trace metadata. Internal IDs appear only in audit or recovery contexts.

### Risk: stale or misleading progress

Mitigation: only emit status transitions at observable boundaries. Do not pretend to know worker-internal token-level progress.

### Risk: storing sensitive data

Mitigation: store summaries, labels, statuses, timestamps, and sanitized scope only. Never store secrets or raw `.env` contents.

### Risk: duplicate state with scheduler

Mitigation: treat scheduler as worker lifecycle state for scheduler-backed runs and cockpit as the user-facing projection.

## Recommended next step

Implement E2 only after this design is accepted. The smallest valuable next code change is the `orchestrator-cockpit` tool plus health/test coverage, followed by Bus/Orchestrator prompt updates.
