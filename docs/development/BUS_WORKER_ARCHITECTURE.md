# Bus-Worker Architecture for OpenCode

Status: 2026-05-27.

## Overview

This document defines how the Bus-Worker development pattern integrates into
OpenCode's existing agent, permission, tool, and session systems. The goal is
to let a primary "Bus" agent own architecture decisions and final verification,
while disposable "Worker" subagents handle bounded implementation slices in
isolated Git worktrees.

OpenCode already provides the primitives needed: configurable agents with
per-agent permission rulesets, the `task` tool for spawning subagent sessions,
and custom tool definitions via `.opencode/tool/*.ts`. This architecture layers
the Bus-Worker workflow on top of those primitives without modifying OpenCode
core.

```text
┌─────────────────────────────────────────────────────┐
│                   OpenCode Session                   │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │              Bus Agent (primary)              │    │
│  │                                               │    │
│  │  • Task decomposition                         │    │
│  │  • Scope & security review                    │    │
│  │  • Worktree creation via worktree tool        │    │
│  │  • Spawns workers via task tool               │    │
│  │  • Acceptance verification                    │    │
│  │  • Final integration                          │    │
│  └──────────┬──────────────┬──────────────┬──────┘    │
│             │              │              │           │
│    ┌────────▼───┐  ┌───────▼────┐  ┌──────▼──────┐   │
│    │ Worker:    │  │ Worker:    │  │ Worker:     │   │
│    │ implement  │  │ diagnostic │  │ full        │   │
│    │            │  │            │  │             │   │
│    │ Edit/Write │  │ Read+Bash  │  │ All tools   │   │
│    │ No Bash    │  │ No Edit    │  │ Requires    │   │
│    │            │  │            │  │ approval    │   │
│    └────────────┘  └────────────┘  └─────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │         Custom Tools (shared)                 │    │
│  │                                               │    │
│  │  • worktree   — create/remove/list worktrees  │    │
│  │  • worker-log — read worker stream logs       │    │
│  └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

## Role Definitions

### Bus Agent

The Bus is a `primary` agent that runs in the main OpenCode session. It owns
the full development lifecycle.

| Responsibility | Detail |
|---|---|
| Task decomposition | Breaks work into bounded slices with clear in/out-of-scope rules |
| Prompt engineering | Writes implementation prompts with pinned anchors, file lists, acceptance commands |
| Worktree management | Creates isolated worktrees via the `worktree` custom tool |
| Worker lifecycle | Spawns workers via `task` tool, monitors progress, stops on violation |
| Acceptance | Runs tests, inspects diffs, verifies no secrets or out-of-scope changes |
| Integration | Commits, merges, cleans up worktrees and stale branches |
| Security review | Validates no credentials, production data, or destructive operations leak into worker output |

The Bus agent has **full permissions** — it can run bash, edit files, use all
tools, and access external directories. It is the only agent authorized to
perform final commits and merges.

### Worker Agents

Workers are `subagent` agents spawned by the Bus via the `task` tool. Each
worker runs in a subagent session scoped to a specific worktree. Three worker
modes exist, each with a different permission boundary.

#### implementation Worker

| Aspect | Rule |
|---|---|
| Tools | read, edit, write, glob, grep |
| Bash | Denied |
| Scope | Only the assigned worktree directory |
| Use case | Bounded code/docs edits, test additions, mechanical refactors |
| Security | Cannot run commands, inspect secrets, or access paths outside worktree |

#### diagnostic Worker

| Aspect | Rule |
|---|---|
| Tools | read, glob, grep, bash |
| Edit/Write | Denied |
| Scope | Read-only investigation of the assigned worktree |
| Use case | Finding entry points, inspecting diffs, running read-only commands |
| Security | Cannot modify any files; bash commands are read-only by convention |

#### full Worker

| Aspect | Rule |
|---|---|
| Tools | All |
| Scope | Assigned worktree |
| Use case | Complex tasks requiring both editing and command execution |
| Security | Requires explicit Bus approval before launch; Bus must verify all output |

## Mapping to OpenCode Primitives

### Agent Configuration

Each worker mode is a separate OpenCode agent defined in
`.opencode/agent/bus-worker-*.md`. The Bus itself uses the default `build`
agent or a custom `bus` agent.

```text
.opencode/
  agent/
    bus.md                       # Bus agent (primary, full permissions)
    bus-worker-implementation.md # implementation worker (subagent)
    bus-worker-diagnostic.md     # diagnostic worker (subagent)
    bus-worker-full.md           # full worker (subagent)
```

### Permission Mapping

OpenCode's permission system uses rulesets of `{ permission, pattern, action }`
triples. The worker modes map directly:

```text
implementation worker:
  read:    { "*": "allow" }
  edit:    { "<worktree>/*": "allow" }
  glob:    allow
  grep:    allow
  bash:    deny
  task:    deny        # workers cannot spawn sub-workers
  todowrite: deny
  question: deny
  external_directory: deny

diagnostic worker:
  read:    { "*": "allow" }
  edit:    deny
  glob:    allow
  grep:    allow
  bash:    { "*": "allow" }  # read-only by convention
  task:    deny
  todowrite: deny
  question: deny
  external_directory: deny

full worker:
  read:    { "*": "allow" }
  edit:    { "<worktree>/*": "allow" }
  glob:    allow
  grep:    allow
  bash:    { "*": "allow" }
  task:    deny
  todowrite: deny
  question: deny
  external_directory: deny
```

### Session Hierarchy

```text
Main Session (Bus agent)
  └── task tool call → Subagent Session (worker agent)
        ├── parentID: main session ID
        ├── permission: derived from parent + worker agent ruleset
        └── worktree: set via prompt context (not a first-class session field)
```

The `task` tool in `packages/opencode/src/tool/task.ts` already handles:

- Creating a child session with `parentID`
- Deriving permissions via `deriveSubagentSessionPermission`
- Running the subagent with its own agent config
- Returning results to the parent session

Workers communicate their results back through the task tool's return value.
The Bus reviews this output and decides on integration.

### Worktree Isolation

Worktree isolation is achieved through the **prompt layer**, not through
filesystem sandboxing. The Bus:

1. Creates a worktree via the `worktree` custom tool
2. Includes the worktree path in the worker prompt
3. Tells the worker to only operate within that path
4. Verifies via `git diff` that the worker stayed in scope

This matches the proven pattern from the user's existing `claude_worker.sh`
wrapper, where isolation is prompt-enforced and verified by the Bus.

## Security Model

### Threat Model

| Threat | Mitigation |
|---|---|
| Worker accesses secrets | Permission system denies external_directory; prompt excludes secrets |
| Worker runs destructive git | Bash denied for implementation mode; full mode requires Bus approval |
| Worker claims tests passed without running them | Bus re-runs all acceptance commands independently |
| Worker edits out-of-scope files | Bus inspects `git diff` after worker completes |
| Worker sends data to external model | Prompt sanitization; worktree contains no secrets or production data |
| Worker loops on approval requests | implementation mode has no bash; Bus monitors and stops runaway workers |

### Prompt Sanitization Protocol

Before launching a worker, the Bus must:

1. Remove secrets, tokens, API keys, and credentials from the prompt
2. Replace real customer data with synthetic IDs
3. Exclude `.env` files, keychain references, and signing materials
4. Ensure the worktree does not contain production database dumps or runtime logs

### Stop Conditions

The Bus must stop a worker when:

- It modifies files outside the assigned worktree
- It attempts to access secrets or credentials
- It enters an approval request loop
- It retries API calls beyond a diagnostic window
- It performs destructive git operations (force-push, branch deletion)
- The task scope has changed and the prompt no longer reflects current intent

### Acceptance Protocol

After a worker completes, the Bus must:

1. Inspect `git status --short --branch` in the worktree
2. Inspect `git diff --stat` and review key diffs
3. Run all acceptance commands locally (never trust worker-reported results)
4. Run `git diff --check` for whitespace errors
5. Verify no generated artifacts, secrets, or private data are staged
6. Add its own review verdict before committing

## Failure Modes

### Worker Hallucination

A worker may produce convincing report text claiming tests passed when they
were never executed. The Bus must treat all worker-reported test results as
**untrusted** and re-run acceptance commands itself.

### Scope Drift

A worker may gradually expand its scope beyond the original task. The Bus
verifies scope compliance by inspecting the diff after the worker completes.

### Approval Loop

In `full` mode, a worker may repeatedly request bash approval. The Bus should
detect this pattern and stop the worker, falling back to `implementation` mode
or handling the task directly.

### Environment Mismatch

A worker may assume host-specific paths (e.g., Python location, node version).
The Bus should ensure tests are environment-agnostic or inject the correct
paths into the worker prompt.

## Data Flow

```text
1. Bus receives task from user
2. Bus decomposes task into bounded slices
3. Bus creates worktree:
     worktree.create({ branch: "codex/<task>-YYYYMMDD", base: "main" })
4. Bus writes worker prompt with:
     - worktree path
     - files to read first
     - pinned implementation anchors
     - in-scope / out-of-scope rules
     - acceptance commands (for Bus to run, not worker)
     - feedback format requirements
5. Bus spawns worker:
     task({ subagent_type: "bus-worker-implementation", prompt: "..." })
6. Worker executes in subagent session, returns result
7. Bus inspects worktree diff
8. Bus runs acceptance commands
9. Bus commits or sends correction prompt to a new worker
10. Bus cleans up worktree:
      worktree.remove({ branch: "codex/<task>-YYYYMMDD" })
```

## Compatibility

This architecture requires no changes to OpenCode core. It uses:

- **Agent config** (`.opencode/agent/*.md`) — already supported
- **Permission rulesets** — already supported
- **Task tool** — already supported
- **Custom tools** (`.opencode/tool/*.ts`) — already supported
- **Prompt engineering** — no code changes needed

Existing agents and workflows are unaffected. The Bus-Worker agents only
activate when explicitly selected or spawned.
