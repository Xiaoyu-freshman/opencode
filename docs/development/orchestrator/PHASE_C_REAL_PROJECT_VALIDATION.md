# Phase C Real-Project Validation

## Purpose

Record formal Desktop/global Orchestrator validation of C2 Hybrid Scheduler after the scheduler `taskCalls` hotfix.

## Validation context

- Date: 2026-06-02
- Client: formal Desktop `/Applications/OpenCode.app`
- Global Orchestrator install: `~/.config/opencode`
- OpenCode repo commit: `b38da421a fix(orchestrator): harden scheduler task calls`
- Projects tested:
  - `/Users/tom/Documents/Project/snowflow`
  - `/Users/tom/Documents/Project/ski-video-review`

## Protocol under test

1. Create a scheduler plan.
2. Execute each returned `taskCalls[i].taskArgs` with the built-in `task` tool.
3. Keep `workerRunId` separate from the built-in `task_id`.
4. Record with scheduler `workerRunId` and the actual `ses_*` task/session id as `taskID`.
5. Collect scheduler results.
6. Cleanup scheduler state only.
7. Omit `configDir` during normal use.

## Validation matrix

| Test | Project | Shape | Result | Scheduler task | Worker / task ids | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| A | snowflow | Single worker read-only | Passed | `scheduler-mpw13o24-xup22i` | `ses_179ccee89ffeYE66ADYIXbeTGX` | Older pre-hotfix test `scheduler-mpvzww1p-xawopc` was cleaned separately; final post-hotfix Test A used `scheduler-mpw13o24-xup22i`. |
| B | ski-video-review | Single worker read-only | Passed | `scheduler-mpw3llmq-y1x79r` | `scheduler-mpw3llmq-y1x79r-worker-1` / `ses_1798d1d49ffe1XYY30bYljEqGM` | Read-only diagnostics. |
| C | snowflow | Multi-worker read-only | Passed | `scheduler-mpw42luf-2eowqb` | `scheduler-mpw42luf-2eowqb-worker-1` / `ses_17980fa86ffeFWj7fwbLUYbUoh`; `scheduler-mpw42luf-2eowqb-worker-2` / `ses_17980fa6dffeidPRATzE4JGi6m` | One initial collect parameter mistake; retry succeeded. Treat as UX/SOP caution, not product failure. |
| D | ski-video-review | Multi-worker read-only | Passed | `scheduler-mpw4dc0e-hkkqsb` | `scheduler-mpw4dc0e-hkkqsb-worker-1` / `ses_179795508ffePX3p8zCpqj5KO2`; `scheduler-mpw4dc0e-hkkqsb-worker-2` / `ses_1797954ffffeEPF9a7lJ7QfDvz` | Read-only diagnostics. |

## Findings

- Single-worker and multi-worker flows passed across both real projects.
- `workerRunId` values and built-in `ses_*` task/session ids stayed separated.
- `collect` and scheduler-state-only `cleanup` succeeded.
- Tests made no file modifications, did not access secrets, did not send real DingTalk messages, and did not run dangerous commands.
- `ski-video-review` had pre-existing untracked `docs/prompts/`; tests did not create it.
- Test C exposed a collect-parameter UX/SOP caution, but retry succeeded and no product failure was observed.

## Resolved issues

- Previous `workers[0].prompt is required` failure from malformed scheduler task calls.
- Previous `Expected a string starting with "ses"...` failure from misusing `workerRunId` as built-in `task_id`.

## Desktop SOP snippet

For future Desktop/global Orchestrator C2 usage:

1. Call scheduler `plan` without `configDir` for normal global usage.
2. For each returned `taskCalls[i]`, pass `taskCalls[i].taskArgs` directly to the built-in `task` tool.
3. Save both ids:
   - scheduler `workerRunId`
   - built-in returned `ses_*` task/session id
4. Call scheduler `record` with the scheduler `workerRunId` and the `ses_*` id as `taskID`.
5. Call scheduler `collect` after all workers are recorded.
6. Call scheduler `cleanup` only when intending to remove scheduler state; it does not clean project files or worker worktrees.

## Residual risks / not yet covered

- Only read-only diagnostics were tested; implementation workers modifying code were not covered.
- Live cancellation, resume checkpoints, DAG behavior, and automatic worker launch semantics were not tested.
- Concurrent stress beyond two workers was not tested.

## Recommended next steps

- Keep C2 Hybrid Scheduler validated for read-only single-worker and multi-worker Desktop workflows.
- Possible next phase: implementation-worker smoke test in a disposable worktree, improved scheduler UX/error messages, and optional C3 design.
