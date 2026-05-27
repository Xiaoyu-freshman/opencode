# Bus-Worker Implementation Plan

Status: 2026-05-27.

## Phases

The implementation is split into four phases. Each phase produces a usable
increment. No GitHub Actions or CI changes are required (GitHub Actions quota
is full until 2026-06-01).

```text
Phase 1: Agent Configuration         ← foundation, zero code changes
Phase 2: Worktree Management Tool    ← custom tool for worktree lifecycle
Phase 3: Worker Monitoring Tools     ← log viewer, status checker
Phase 4: Documentation & Templates   ← prompt templates, workflow guide
```

## Phase 1: Agent Configuration

**Goal:** Define Bus and Worker agents via `.opencode/agent/*.md` config files.
No code changes needed — uses existing agent config system.

### Tasks

| # | Task | Output |
|---|---|---|
| 1.1 | Create `.opencode/agent/bus.md` | Bus agent config (primary, full permissions) |
| 1.2 | Create `.opencode/agent/bus-worker-implementation.md` | implementation worker config |
| 1.3 | Create `.opencode/agent/bus-worker-diagnostic.md` | diagnostic worker config |
| 1.4 | Create `.opencode/agent/bus-worker-full.md` | full worker config |
| 1.5 | Test: verify agents appear in agent list | Manual verification in OpenCode TUI |

### Dependencies

None. This phase is standalone.

### Acceptance Criteria

- `bus` agent appears in OpenCode agent list as a primary agent
- `bus-worker-*` agents appear as subagents
- Each worker has the correct permission boundary (bash denied for
  implementation, edit denied for diagnostic)
- Switching to `bus` agent works in the TUI
- Spawning a `bus-worker-implementation` subagent via `@` works

### Files to Create

```text
.opencode/agent/bus.md
.opencode/agent/bus-worker-implementation.md
.opencode/agent/bus-worker-diagnostic.md
.opencode/agent/bus-worker-full.md
```

## Phase 2: Worktree Management Tool

**Goal:** Provide a custom tool for creating, listing, and removing Git
worktrees with Bus-Worker naming conventions.

### Tasks

| # | Task | Output |
|---|---|---|
| 2.1 | Implement `.opencode/tool/worktree.ts` | worktree tool with create/list/remove/status |
| 2.2 | Add worktree tool to Bus agent's tool allowlist | Bus agent config update |
| 2.3 | Test: create a worktree, verify isolation | Manual test |
| 2.4 | Test: remove a worktree, verify cleanup | Manual test |

### Dependencies

- Phase 1 (Bus agent must exist)

### Acceptance Criteria

- `worktree.create({ task, base })` creates a branch `codex/<task>-YYYYMMDD`
  and worktree at `../_worktrees/<project>-<task>`
- `worktree.list()` shows all active worktrees with branch names
- `worktree.status({ branch })` shows `git status` for a specific worktree
- `worktree.remove({ branch })` removes worktree and deletes branch
- Tool only available to Bus agent (denied for workers)
- Errors surface clearly (dirty worktree, unmerged branch)

### Files to Create / Modify

```text
.opencode/tool/worktree.ts          # new
.opencode/agent/bus.md              # update: add worktree tool permission
```

## Phase 3: Worker Monitoring Tools

**Goal:** Let the Bus inspect worker progress and results.

### Tasks

| # | Task | Output |
|---|---|---|
| 3.1 | Implement `.opencode/tool/worker-log.ts` | Log viewer for worker sessions |
| 3.2 | Test: spawn a background worker, read its log | Manual test |

### Dependencies

- Phase 1 (worker agents must exist)

### Acceptance Criteria

- `worker-log.list()` shows active and recent worker sessions
- `worker-log.read({ sessionID })` returns the worker's output summary
- Tool available to Bus agent only

### Files to Create / Modify

```text
.opencode/tool/worker-log.ts        # new
.opencode/agent/bus.md              # update: add worker-log tool permission
```

## Phase 4: Documentation & Templates

**Goal:** Provide prompt templates and a workflow guide so the Bus can
construct high-quality worker prompts consistently.

### Tasks

| # | Task | Output |
|---|---|---|
| 4.1 | Create `docs/development/BUS_WORKER_WORKFLOW.md` | Step-by-step workflow guide |
| 4.2 | Create `.opencode/prompt/worker-implementation.md` | Template for implementation worker prompts |
| 4.3 | Create `.opencode/prompt/worker-diagnostic.md` | Template for diagnostic worker prompts |
| 4.4 | Create `.opencode/prompt/worker-full.md` | Template for full worker prompts |
| 4.5 | Review all docs for consistency | Cross-reference check |

### Dependencies

- Phases 1–3 (docs reference the tools and agents)

### Acceptance Criteria

- Workflow guide covers the full lifecycle from task receipt to cleanup
- Prompt templates include all required sections (anchors, scope, acceptance)
- Templates are copy-paste ready for the Bus to fill in
- Docs reference the correct agent names and tool names

### Files to Create

```text
docs/development/BUS_WORKER_WORKFLOW.md
.opencode/prompt/worker-implementation.md
.opencode/prompt/worker-diagnostic.md
.opencode/prompt/worker-full.md
```

## Priority Order

```text
Phase 1  →  Phase 2  →  Phase 3  →  Phase 4
 (now)       (now)       (later)     (now)
```

Phase 1 and Phase 4 can run in parallel since they have no code dependencies.
Phase 2 depends on Phase 1. Phase 3 depends on Phase 1 but is lower priority
(the Bus can use the built-in session list to check worker status).

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Worker escapes worktree scope | Low | Medium | Bus verifies via `git diff`; permission system limits file access |
| Custom tool has bugs | Medium | Low | Tools are simple shell wrappers; easy to test and fix |
| Agent config conflicts with existing agents | Low | Low | Namespaced names (`bus`, `bus-worker-*`) avoid collisions |
| Background subagent feature is experimental | Medium | Medium | Use foreground workers by default; background only when flag is enabled |
| Prompt templates become stale | Low | Low | Templates are in version control; review in Phase 4 |

## Out of Scope

- **Core code changes**: No modifications to `packages/opencode/src/`
- **CI integration**: GitHub Actions quota full until 2026-06-01
- **Plugin-based implementation**: Agent config + custom tools are simpler
  and already sufficient
- **Filesystem sandboxing**: Isolation is prompt-enforced and Bus-verified,
  matching the proven pattern from existing Bus-Worker workflows
