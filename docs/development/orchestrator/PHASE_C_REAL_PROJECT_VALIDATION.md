# Phase C Real-Project Validation

## Purpose

Record formal Desktop/global Orchestrator validation of C2 Hybrid Scheduler after the scheduler `taskCalls` hotfix.

## Validation context

- Date: 2026-06-02
- Client: formal Desktop `/Applications/OpenCode.app`
- Global Orchestrator install: `~/.config/opencode`
- OpenCode repo commit: `b38da421a fix(orchestrator): harden scheduler task calls`
- Scheduler UX hardening commit validated: `e07027c7d fix(orchestrator): improve scheduler protocol errors`
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
| E | ski-video-review | Implementation worker + review worker in disposable worktree | Passed | `scheduler-mpw4xhr2-xvxyla` | `scheduler-mpw4xhr2-xvxyla-worker-1` / `ses_1796af171ffeQlLZjrx4xojyvP`; `scheduler-mpw4xhr2-xvxyla-worker-2` / `ses_1796af166ffe4aXr5syrrRdMGs` | Docs-only implementation smoke in disposable worktree. |
| F | Desktop/global scheduler | Scheduler UX negative smoke; no worker launch | Passed | n/a intentional error smoke | n/a | Confirmed scheduler protocol-error recovery hints in formal Desktop after reinstall and restart. |

## Test E details

- Disposable worktree: `/Users/tom/Documents/Project/ski-video-review/.worktrees/ski-video-review-c2-implementation-smoke`
- Branch: `codex/c2-implementation-smoke-20260602`
- Implementation summary: created `docs/development/orchestrator-c2-implementation-smoke.md` only in the disposable worktree.
- Review summary: PASS; confirmed only the expected markdown file changed in the disposable worktree; main workspace had no new tracked modifications.
- Collect succeeded; scheduler marked completed and matched both completed workers.
- Cleanup succeeded; removed scheduler state file only, with no worktrees or user files modified.
- Safety: no secrets; no dangerous commands, installs, builds, tests, packaging, or services.
- Main workspace had pre-existing untracked `docs/prompts/` and other prompt files; they were not created by this test.
- Disposable worktree and branch were later cleaned up manually after user confirmation.

## Test F details

- Purpose: verify new scheduler error hints are loaded in formal Desktop and help recover from common protocol mistakes.
- `record` negative smoke used missing/nonexistent `schedulerTaskId` `scheduler-missing-error-smoke`, `workerRunId` `scheduler-missing-error-smoke-worker-1`, status `completed`, taskID `ses_error_smoke`, and no `configDir`.
- Expected and observed `record` hints included `schedulerTaskId`, `configDir`, `cleaned up`, and `~/.config/opencode/scheduler`.
- `collect` negative smoke used no `schedulerTaskId` and no `configDir`.
- Expected and observed `collect` hints included `scheduler({ action: "collect", schedulerTaskId })`, `Collect only after...`, and `cleanup/configDir mismatch`.
- Safety: no scheduler plan, no built-in task launch, no workers, no file modifications, no secrets, and no bash.

## Findings

- Single-worker and multi-worker flows passed across both real projects.
- A low-risk docs-only implementation-worker flow with review in a disposable worktree passed.
- `workerRunId` values and built-in `ses_*` task/session ids stayed separated.
- `collect` and scheduler-state-only `cleanup` succeeded.
- Main workspaces were not modified by the tests; Test E changed only the expected markdown file inside its disposable worktree.
- Tests did not access secrets, did not send real DingTalk messages, and did not run dangerous commands.
- `ski-video-review` had pre-existing untracked `docs/prompts/`; tests did not create it.
- Test C exposed a collect-parameter UX/SOP caution, but retry succeeded and no product failure was observed.
- Test F confirmed Desktop loaded scheduler UX hardening and negative protocol errors produced the expected recovery hints.

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

- Implementation-worker coverage is limited to a low-risk docs-only smoke in a disposable worktree; real code or config changes were not covered.
- Live cancellation, resume checkpoints, DAG behavior, and automatic worker launch semantics were not tested.
- Concurrent stress beyond two workers was not tested.

## Recommended next steps

- Keep C2 Hybrid Scheduler validated for read-only single-worker, multi-worker, and docs-only implementation smoke Desktop workflows.
- Possible next phase: optional C3 design, broader implementation validation with real code/config in a disposable repo or worktree, or stress/concurrency validation.
