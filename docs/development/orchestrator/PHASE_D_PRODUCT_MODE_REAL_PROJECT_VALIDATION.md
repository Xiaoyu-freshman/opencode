# Phase D Product Mode Real-Project Validation

## Purpose

Record the first full Product Mode validation where Desktop/global Orchestrator acted as the single user-facing entry point for a real project stabilization task, including diagnosis, implementation, validation, commit, push, CI confirmation, worktree cleanup, and project status reporting.

This validates the gap left by Phase C: Phase C proved read-only, multi-worker, scheduler protocol, and docs-only implementation smoke flows; Phase D proves real application code changes in a production project workflow.

## Validation context

- Date: 2026-06-02
- Client: restarted formal Desktop/global Orchestrator
- Global Orchestrator install: `~/.config/opencode`
- OpenCode repo baseline before validation: `24885e27e feat(orchestrator): add lower-agent model presets`
- Project tested: `/Users/tom/Documents/Project/ski-video-review`
- Project branch under test: `main`
- User-facing requirement: user talks only to Orchestrator; Bus, Worker, Scheduler, worktree, and task protocol details remain internal execution mechanics.

## User request

The initial project request was:

1. Understand the current project state.
2. Propose the next project phase.
3. Decide whether task decomposition, workers, or worktrees were needed.
4. Do not modify files at first.

After the read-only project assessment, the user approved entering Snow Motion Lab v1 post-merge stabilization and asked Orchestrator to complete the fix, commit, push, cleanup, and status documentation update.

## Project context

`ski-video-review` had three active delivery tracks:

1. Phase 1 indoor teaching workstation
   - Coaching Console, target confirmation, replay, voice highlights, multi-device workstation, and macOS packaging were mature.
   - Remaining work centered on P6.8 field smoke, P7 multi-device follow-up, P9 notarized release, and the target-continuity Step 6 regression gate.
2. Phase 2 mobile / internet access
   - Android, edge machine, operator, handoff, runtime installability, and OSS direct upload were in late-stage progress.
   - P19-D had exercised the object-storage main path and real smoke.
   - Remaining work centered on formal domain, TLS client differences, and review/PR closure.
3. Snow Motion Lab v1
   - PR #97 had landed in `origin/main`.
   - `packages/snow-motion-core` existed.
   - Core contract, result, artifacts, basic metrics, and legacy adapter were implemented.
   - B-side Coaching Console consumed background Core analysis after recording.
   - C-side mobile post-analysis exposed `analysis_result`.

## Issue found

Read-only diagnosis found a production-default risk in C-side mobile post-analysis: the default path could run the legacy analysis pipeline twice.

The risky flow was:

1. `MobilePostAnalysisTaskManager._task_worker()` called the default runner: `run_post_analyze_pipeline()`.
2. `_run_core_adapter()` then called `snow_motion_core.analyze_video(AnalysisRequest)`.
3. Core `analyze_video()` defaulted to `legacy_ski_review_adapter.run_analysis()`.
4. The default `LegacyRunner()` called `run_post_analyze_pipeline()` again.

Potential consequences:

- Doubled runtime.
- Artifact overwrite or pollution.
- `summary` and `analysis_result` drift.
- Target/manual binding evidence drift.
- Stop/cancel semantic mismatch.
- `out_dir` write contamination.

B-side did not share this issue because it used `run_analysis(..., runner=_injected_runner)` to reuse an existing summary instead of triggering the default `LegacyRunner`.

## Implementation summary

Scope boundaries:

- Keep the Core contract shape unchanged.
- Preserve `report_md` and `public_results`.
- Preserve `analysis_result` exposure and persistence.
- Preserve the existing semantics where Core failed result or exception makes the task fail.
- Do not touch B-side live overlay, Stop, capture, or target confirmation flows.

Files changed in `ski-video-review`:

- `src/ski_review/mobile_post_analysis.py`
- `tests/test_mobile_post_analysis.py`

Core change:

- C-side `_run_core_adapter()` no longer calls top-level `analyze_video()`.
- It calls `run_analysis(analysis_request, runner=_summary_runner)`.
- `_summary_runner` returns the first-pass post-analysis `legacy_summary`.
- Core now projects the existing summary into `AnalysisResult` without triggering the default `LegacyRunner` and without rerunning the pipeline.

Test change:

- Updated tests to mock `run_analysis` instead of `analyze_video`.
- Added regression coverage: `test_run_core_adapter_reuses_legacy_summary_without_default_pipeline`.
- The regression confirms `_run_core_adapter()` reuses the existing summary and does not trigger the default legacy pipeline.

## Validation performed

The local Python gate passed:

- `ruff`: passed
- root app `black --check`: passed
- Core package `black --check`: passed
- `mypy src/ski_review`: passed
- full pytest: `660 passed, 1 skipped`
- `git diff --check`: passed

Markdown validation note:

- Full markdownlint with untracked `docs/prompts/` failed because that directory contained pre-existing untracked prompt drafts.
- Excluding `docs/prompts/` passed: `README.md docs/**/*.md !docs/prompts/**/*.md`.

## Project commits and push

The Orchestrator-led workflow committed and pushed these project commits to `origin/main`:

1. `4e8c751 feat(snow-motion-lab): switch C-side analysis to core`
   - Exposed Core `analysis_result` in C-side mobile post-analysis.
2. `39115ff fix(snow-motion-lab): avoid duplicate C-side core analysis`
   - Fixed the duplicate legacy pipeline execution risk.
3. `43dd9a6 docs(snow-motion-lab): record post-merge stabilization`
   - Updated Snow Motion Lab bus ledger, QA, integration notes, and prompt ledger.
   - Recorded PR #97 landing and post-merge stabilization status.
   - Recorded the full local QA result.

Push result:

- `main -> origin/main`: succeeded
- GitHub Actions CI run: `26807252193`
- CI status: `completed success`

## Cleanup

The workflow cleaned the worker worktrees it created:

- `.worktrees/ski-video-review-sml-cside-core-stabilization`
- `.worktrees/ski-video-review-sml-cside-core-dedupe`

The workflow deleted the corresponding local worker branches:

- `codex/sml-cside-core-stabilization-20260602`
- `codex/sml-cside-core-dedupe-20260602`

It preserved `docs/prompts/` because it was a pre-existing untracked prompt-draft directory and was intentionally outside the approved scope.

Final `ski-video-review` state:

```text
main...origin/main
?? docs/prompts/
```

## Product Mode coverage

This run validates the user-facing Product Mode contract:

- Orchestrator was the only user-facing project coordination surface.
- Initial work was read-only until the user approved implementation.
- Orchestrator classified the work, identified risk, and selected an implementation path.
- Workers and worktrees were used where valuable, but remained execution mechanics rather than user obligations.
- The workflow produced real application code and test changes, not a docs-only smoke.
- Validation gates were run and reported.
- Commits and push happened only after user approval.
- CI success was confirmed.
- Clean worker worktrees and branches were cleaned up.
- Pre-existing untracked material was preserved and reported.
- The final report translated internal execution into project status, risks, and next recommended phases.

## Residual risks / not yet covered

- This validated one real project stabilization path, not every L/XL branch such as destructive rollback, release packaging, or data migration.
- Live worker cancellation and resume checkpoints were not revalidated in this run.
- Multi-worker stress beyond the two-worktree stabilization shape remains untested.
- The `ski-video-review` project still has pre-existing untracked `docs/prompts/`, intentionally outside this validation scope.

## Recommended next steps

For `ski-video-review`:

1. If the immediate goal is online mobile usability, continue Phase 2 P19-D formal domain, TLS residuals, and review closure.
2. If the immediate goal is offline teaching delivery, continue Phase 1 P6.8 field smoke and P9 notarized release.
3. If the immediate goal is architecture governance, start Snow Motion Lab Core-native adapter exit planning and plan the gradual removal of `legacy_ski_review_adapter`.

For Orchestrator:

1. Treat Phase D as the first successful real application-code Product Mode validation.
2. Keep Phase C scheduler protocol validation and Phase D Product Mode validation as separate records: Phase C proves orchestration mechanics, Phase D proves project delivery behavior.
3. Future validation should cover cancellation/resume and higher-concurrency worker execution only when a real project task needs them.
