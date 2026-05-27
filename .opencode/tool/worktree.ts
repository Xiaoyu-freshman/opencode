/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"
import { execSync } from "child_process"

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
}

function worktreeBase(): string {
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

function runCommand(command: string): string {
  try {
    return execSync(command, { encoding: "utf-8", timeout: 30000 })
  } catch (error: any) {
    throw new Error(`Command failed: ${command}\n${error.stderr || error.message}`)
  }
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

        runCommand(`mkdir -p "${worktreeBase()}"`)
        runCommand(`git worktree add -b "${branch}" "${path}" "${base}"`)

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
        const text = runCommand("git worktree list --porcelain")
        if (!text.trim()) return "No worktrees found."

        const entries = text.trim().split("\n\n")
        const lines = entries.map((entry) => {
          const path = entry.match(/^worktree (.+)$/m)?.[1] ?? "?"
          const branch = entry.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? "(detached)"
          const bare = entry.includes("bare") ? " [bare]" : ""
          const detached = entry.includes("detached") ? " [detached]" : ""
          return `  ${branch}: ${path}${bare}${detached}`
        })

        return [`Worktrees (${entries.length}):`, ...lines].join("\n")
      }

      case "status": {
        if (!args.branch) throw new Error("branch is required for status operation")

        const listText = runCommand("git worktree list --porcelain")
        const match = listText.match(
          new RegExp(`worktree (.+)\nbranch refs/heads/${args.branch}`, "m"),
        )
        if (!match) throw new Error(`Worktree for branch ${args.branch} not found`)

        const worktreeDir = match[1]

        const status = runCommand(`git -C "${worktreeDir}" status --short --branch`)
        const diff = runCommand(`git -C "${worktreeDir}" diff --stat`)

        return [
          `Status for ${args.branch}:`,
          ``,
          status,
          diff ? `\nDiff stat:\n${diff}` : "(no changes)",
        ].join("\n")
      }

      case "remove": {
        if (!args.branch) throw new Error("branch is required for remove operation")

        const listText = runCommand("git worktree list --porcelain")
        const match = listText.match(
          new RegExp(`worktree (.+)\nbranch refs/heads/${args.branch}`, "m"),
        )
        if (!match) throw new Error(`Worktree for branch ${args.branch} not found`)

        const worktreeDir = match[1]

        const forceFlag = args.force ? " --force" : ""
        runCommand(`git worktree remove${forceFlag} "${worktreeDir}"`)

        try {
          runCommand(`git branch -d "${args.branch}"`)
        } catch {
          // Branch may already be deleted or merged — not a hard error
        }

        return `Removed worktree for ${args.branch} at ${worktreeDir}`
      }

      default:
        throw new Error(`Unknown operation: ${args.operation}`)
    }
  },
})
