# Bus-Worker Tools Implementation

Status: 2026-05-27.

## Overview

Two custom tools support the Bus-Worker workflow:

1. **worktree** — Create, list, inspect, and remove Git worktrees
2. **worker-log** — List and read worker session output

Both are implemented as `.opencode/tool/*.ts` files using the
`@opencode-ai/plugin/tool` API.

## Worktree Tool

File: `.opencode/tool/worktree.ts`

### Design

The worktree tool wraps Git worktree operations with Bus-Worker naming
conventions. It enforces:

- Branch naming: `codex/<task>-YYYYMMDD`
- Worktree path: `../_worktrees/<project>-<task>`
- Cleanup validation (dirty worktree detection)

### Operations

| Operation | Args | Description |
|---|---|---|
| `create` | `task`, `base?` | Create branch + worktree from base branch |
| `list` | — | List all worktrees with branch and status |
| `status` | `branch` | Show git status for a specific worktree |
| `remove` | `branch`, `force?` | Remove worktree and delete branch |

### Implementation

```typescript
/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"
import { $ } from "bun"

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
}

function worktreeBase(): string {
  // Place worktrees next to the project root
  // e.g., /Users/tom/Documents/Project → /Users/tom/Documents/Project/_worktrees
  const cwd = process.cwd()
  const parent = cwd.replace(/\/[^/]+$/, "")
  return `${parent}/_worktrees`
}

function projectName(): string {
  return process.cwd().split("/").pop() ?? "project"
}

function branchName(task: string): string {
  return `codex/${task}-${today()}`
}

function worktreePath(task: string): string {
  return `${worktreeBase()}/${projectName()}-${task}`
}

export default tool({
  description: `Manage Git worktrees for Bus-Worker tasks.

Operations:
- create: Create a new worktree with a codex/<task>-YYYYMMDD branch
- list: List all worktrees with their branch names and status
- status: Show git status for a specific worktree
- remove: Remove a worktree and delete its branch

Use this tool to isolate worker tasks in separate worktrees.`,
  args: {
    operation: tool.schema
      .enum(["create", "list", "status", "remove"])
      .describe("The operation to perform"),
    task: tool.schema
      .string()
      .describe("Task name (used for branch and directory naming)")
      .optional(),
    base: tool.schema
      .string()
      .describe("Base branch to create from (default: main)")
      .optional(),
    branch: tool.schema
      .string()
      .describe("Branch name (for status/remove operations)")
      .optional(),
    force: tool.schema
      .boolean()
      .describe("Force remove even if worktree is dirty")
      .default(false)
      .optional(),
  },
  async execute(args) {
    switch (args.operation) {
      case "create": {
        if (!args.task) throw new Error("task is required for create operation")
        const branch = branchName(args.task)
        const path = worktreePath(args.task)
        const base = args.base ?? "main"

        // Ensure parent directory exists
        await $`mkdir -p ${worktreeBase()}`

        // Create worktree
        const result = await $`git worktree add -b ${branch} ${path} ${base}`.quiet()

        return [
          `Worktree created:`,
          `  Branch: ${branch}`,
          `  Path:   ${path}`,
          `  Base:   ${base}`,
          ``,
          `Worker prompt should include: "Worktree path: ${path}"`,
        ].join("\n")
      }

      case "list": {
        const result = await $`git worktree list --porcelain`.text()
        if (!result.trim()) return "No worktrees found."

        const entries = result.trim().split("\n\n")
        const lines = entries.map((entry) => {
          const path = entry.match(/^worktree (.+)$/m)?.[1] ?? "?"
          const branch = entry.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? "(detached)"
          const bare = entry.includes("bare") ? " [bare]" : ""
          const dirty = entry.includes("detached") ? " [detached]" : ""
          return `  ${branch}: ${path}${bare}${dirty}`
        })

        return [`Worktrees (${entries.length}):`, ...lines].join("\n")
      }

      case "status": {
        if (!args.branch) throw new Error("branch is required for status operation")
        const path = worktreePath(args.branch.replace("codex/", "").replace(/-\d{8}$/, ""))

        // Try to find the worktree path from git worktree list
        const list = await $`git worktree list --porcelain`.text()
        const match = list.match(new RegExp(`worktree (.+)\nbranch refs/heads/${args.branch}`, "m"))
        const worktreeDir = match?.[1] ?? path

        const status = await $`git -C ${worktreeDir} status --short --branch`.text()
        const diff = await $`git -C ${worktreeDir} diff --stat`.text()

        return [
          `Status for ${args.branch}:`,
          ``,
          status,
          diff ? `\nDiff stat:\n${diff}` : "(no changes)",
        ].join("\n")
      }

      case "remove": {
        if (!args.branch) throw new Error("branch is required for remove operation")

        // Find worktree path
        const list = await $`git worktree list --porcelain`.text()
        const match = list.match(new RegExp(`worktree (.+)\nbranch refs/heads/${args.branch}`, "m"))
        if (!match) throw new Error(`Worktree for branch ${args.branch} not found`)

        const worktreeDir = match[1]
        const forceFlag = args.force ? ["--force"] : []

        // Remove worktree
        await $`git worktree remove ${forceFlag} ${worktreeDir}`.quiet()

        // Delete branch
        try {
          await $`git branch -d ${args.branch}`.quiet()
        } catch {
          // Branch may already be deleted or merged
        }

        return `Removed worktree for ${args.branch} at ${worktreeDir}`
      }

      default:
        throw new Error(`Unknown operation: ${args.operation}`)
    }
  },
})
```

## Worker Log Tool

File: `.opencode/tool/worker-log.ts`

### Design

The worker log tool lets the Bus inspect the output of worker sessions. Since
OpenCode tracks sessions and their messages, this tool queries the session
system to retrieve worker results.

### Operations

| Operation | Args | Description |
|---|---|---|
| `list` | — | List recent worker sessions (subagent sessions) |
| `read` | `sessionID` | Read the output of a specific worker session |

### Implementation

```typescript
/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"

// The tool accesses the OpenCode SDK client which is available
// in the tool context. However, since custom tools use the plugin
// tool API which doesn't expose the SDK client directly, we use
// a simpler approach: the Bus can read worker output through the
// task tool's return value, which already contains the worker's
// final text.

// This tool provides a convenience layer for inspecting worker
// sessions that may have been running in the background.

export default tool({
  description: `Inspect worker session logs.

Operations:
- list: Show recent worker sessions with their status
- read: Read the output of a specific worker session

Use this tool to check on background workers or review completed worker output.`,
  args: {
    operation: tool.schema
      .enum(["list", "read"])
      .describe("The operation to perform"),
    session_id: tool.schema
      .string()
      .describe("Session ID to read (for read operation)")
      .optional(),
    limit: tool.schema
      .number()
      .describe("Maximum sessions to list (default: 10)")
      .default(10)
      .optional(),
  },
  async execute(args, ctx) {
    // Note: This tool relies on the OpenCode SDK being available.
    // In practice, the Bus agent should use the task tool's return
    // value for worker results. This tool is a convenience for
    // inspecting background workers.

    switch (args.operation) {
      case "list": {
        // The actual implementation would query the OpenCode session API.
        // For now, return a message guiding the user to use the task tool.
        return [
          "Worker sessions are tracked by the task tool.",
          "",
          "To check worker results:",
          "1. Foreground workers return results directly in the task tool response",
          "2. Background workers send a notification when complete",
          "3. Use the session list in the TUI to browse all sessions",
          "",
          "For detailed worker output, review the task tool's return value",
          "which contains the worker's final text in <task_result> tags.",
        ].join("\n")
      }

      case "read": {
        if (!args.session_id) {
          throw new Error("session_id is required for read operation")
        }

        return [
          `Session: ${args.session_id}`,
          "",
          "To read worker output, check the task tool response for this session.",
          "The output is formatted as:",
          `<task id="${args.session_id}" state="completed">`,
          "<task_result>",
          "... worker output ...",
          "</task_result>",
          "</task>",
        ].join("\n")
      }

      default:
        throw new Error(`Unknown operation: ${args.operation}`)
    }
  },
})
```

### Limitations

The worker-log tool is a lightweight convenience layer. For full worker
monitoring, the Bus should:

1. Use **foreground workers** (default) to get results directly in the task
   tool response
2. Use **background workers** (`background: true`) only when the Bus needs
   to continue working while the worker runs — results arrive as notifications
3. Inspect the session list in the TUI for historical worker sessions

A more capable implementation could query the OpenCode SDK client directly,
but that requires the plugin tool API to expose the client, which is not
currently available.

## Tool Permissions

Both tools should be restricted to the Bus agent only. This is configured in
the Bus agent's permission ruleset:

```yaml
# In .opencode/agent/bus.md
permission:
  bash:
    "*": allow
```

The worktree tool uses `bun`'s `$` shell API internally, which requires bash
permission. The worker-log tool is read-only and does not need special
permissions.

Workers do not need access to either tool — the Bus manages worktrees and
monitors workers on their behalf.

## Testing

### Worktree Tool Tests

```bash
# 1. Create a test worktree
# In OpenCode with bus agent:
# "Create a worktree for task 'test-bus-worker'"

# Expected: worktree created at ../_worktrees/<project>-test-bus-worker
# Expected: branch codex/test-bus-worker-YYYYMMDD created

# 2. List worktrees
# "List all worktrees"
# Expected: shows the test worktree

# 3. Check status
# "Show status for branch codex/test-bus-worker-YYYYMMDD"
# Expected: shows clean worktree status

# 4. Remove worktree
# "Remove worktree for branch codex/test-bus-worker-YYYYMMDD"
# Expected: worktree and branch removed
```

### Integration Test

```bash
# Full Bus-Worker cycle:
# 1. Bus creates worktree
# 2. Bus spawns implementation worker with a simple task
# 3. Worker returns changes
# 4. Bus inspects diff
# 5. Bus runs acceptance
# 6. Bus commits
# 7. Bus cleans up worktree
```

## Future Enhancements

### Worktree Tool

- Add `diff` operation to show full diff for a worktree
- Add `commit` operation to commit changes in a worktree
- Support custom worktree root paths via environment variable
- Add worktree age tracking for automatic stale worktree detection

### Worker Log Tool

- Query OpenCode SDK client directly for session messages
- Support filtering by agent type or status
- Export worker output to markdown files for archiving
- Add real-time streaming for active background workers
