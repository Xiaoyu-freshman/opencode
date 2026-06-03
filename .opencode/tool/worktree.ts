/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"
import { randomBytes } from "crypto"
import { spawnSync } from "child_process"
import { existsSync, mkdirSync, realpathSync } from "fs"
import path from "path"

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
}

function shortID(): string {
  return randomBytes(3).toString("hex")
}

function worktreeBase(cwd: string): string {
  return path.join(cwd, ".worktrees")
}

function projectName(cwd: string): string {
  return sanitizeSlug(path.basename(cwd) || "project")
}

function sanitizeSlug(input: string): string {
  const slug = input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

  return Array.from(slug || "task")
    .slice(0, 48)
    .join("")
    .replace(/-$/g, "")
}

function branchName(slug: string, id: string): string {
  return `codex/${slug}-${today()}-${id}`
}

function worktreePath(slug: string, id: string, cwd: string): string {
  return path.join(worktreeBase(cwd), `${projectName(cwd)}-${slug}-${id}`)
}

function detectDefaultBranch(cwd: string): string {
  if (gitOk(["rev-parse", "--verify", "--quiet", "dev^{commit}"], cwd)) return "dev"
  if (gitOk(["rev-parse", "--verify", "--quiet", "origin/dev^{commit}"], cwd)) return "origin/dev"

  const originHead = gitResult(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], cwd)
  if (originHead.ok && originHead.stdout.trim()) return originHead.stdout.trim()

  const remote = gitResult(["remote"], cwd)
    .stdout.trim()
    .split("\n")
    .find((item) => item.trim())
  if (remote) {
    const head = gitResult(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], cwd)
    if (head.ok && head.stdout.trim()) return head.stdout.trim()
  }

  const current = gitResult(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd)
  if (current.ok && current.stdout.trim()) return current.stdout.trim()

  const local = gitResult(["for-each-ref", "--format=%(refname:short)", "refs/heads"], cwd)
    .stdout.trim()
    .split("\n")
    .find((item) => item.trim())
  return local ?? "HEAD"
}

function gitResult(args: string[], cwd?: string) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 60000,
    stdio: ["ignore", "pipe", "pipe"],
  })
  return {
    ok: result.status === 0,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? result.error?.message ?? ""),
    status: result.status,
  }
}

function gitOk(args: string[], cwd?: string): boolean {
  return gitResult(args, cwd).ok
}

function runGit(args: string[], cwd?: string): string {
  const result = gitResult(args, cwd)
  if (result.ok) return result.stdout
  throw new Error(`Command failed: git ${args.join(" ")}\n${result.stderr}`)
}

function listWorktrees(cwd: string) {
  return runGit(["worktree", "list", "--porcelain"], cwd)
    .trim()
    .split("\n\n")
    .filter((entry) => entry.trim())
    .map((entry) => {
      const lines = entry.split("\n")
      const worktreeDir = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length) ?? ""
      const branch = lines.find((line) => line.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length)
      return {
        path: worktreeDir,
        branch,
        base: null,
        head: lines.find((line) => line.startsWith("HEAD "))?.slice("HEAD ".length),
        bare: lines.includes("bare"),
        detached: lines.includes("detached") || branch === undefined,
        exists: worktreeDir ? existsSync(worktreeDir) : false,
      }
    })
}

function requestedBranch(input: string | undefined, operation: string): string {
  const branch = input?.trim()
  if (!branch) throw new Error(`branch is required for ${operation} operation`)
  if (/[\u0000-\u001f\u007f]/u.test(branch)) throw new Error("branch contains control characters")
  return branch
}

function jsonOutput(result: object) {
  return {
    output: JSON.stringify(result, null, 2),
    metadata: result,
  }
}

function availableWorktree(task: string, cwd: string) {
  const slug = sanitizeSlug(task)
  const candidate = Array.from({ length: 20 }, () => {
    const id = shortID()
    return { slug, id, branch: branchName(slug, id), path: worktreePath(slug, id, cwd) }
  }).find(
    (item) =>
      !existsSync(item.path) && !gitOk(["rev-parse", "--verify", "--quiet", `refs/heads/${item.branch}`], cwd),
  )

  if (candidate) {
    return candidate
  }
  throw new Error(`Unable to allocate a unique worktree name for task: ${task}`)
}

export default tool({
  description: `Manage Git worktrees for Bus-Worker tasks.

Operations:
- create: Create a new worktree with a codex/<task>-YYYYMMDD-<id> branch
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
      .describe("Base branch to create from (default: dev, then origin/dev, then repository fallback)")
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
  async execute(args, context) {
    const cwd = realpathSync(context.directory)
    switch (args.operation) {
      case "create": {
        if (!args.task) throw new Error("task is required for create operation")
        const info = availableWorktree(args.task, cwd)
        const base = args.base?.trim() || detectDefaultBranch(cwd)

        mkdirSync(worktreeBase(cwd), { recursive: true })
        runGit(["worktree", "add", "-b", info.branch, info.path, base], cwd)

        return jsonOutput({
          success: true,
          operation: "create",
          message: `Worktree created at ${info.path} on branch ${info.branch}`,
          task: args.task,
          slug: info.slug,
          id: info.id,
          branch: info.branch,
          path: info.path,
          base,
          exists: existsSync(info.path),
          workerPrompt: `Worktree path: ${info.path}`,
        })
      }

      case "list": {
        const worktrees = listWorktrees(cwd)

        return jsonOutput({
          success: true,
          operation: "list",
          message: worktrees.length ? `Found ${worktrees.length} worktree(s)` : "No worktrees found",
          count: worktrees.length,
          base: null,
          exists: worktrees.length > 0,
          worktrees,
        })
      }

      case "status": {
        const branch = requestedBranch(args.branch, "status")
        const worktree = listWorktrees(cwd).find((item) => item.branch === branch)
        if (!worktree) {
          return jsonOutput({
            success: false,
            operation: "status",
            message: `Worktree for branch ${branch} not found`,
            branch,
            path: null,
            base: null,
            exists: false,
          })
        }

        const status = runGit(["-C", worktree.path, "status", "--short", "--branch"])
        const diff = runGit(["-C", worktree.path, "diff", "--stat"])

        return jsonOutput({
          success: true,
          operation: "status",
          message: `Status for ${branch}`,
          branch,
          path: worktree.path,
          base: null,
          exists: worktree.exists,
          clean: status
            .split("\n")
            .filter((line) => line.trim() && !line.startsWith("##"))
            .length === 0,
          status,
          diffStat: diff || null,
        })
      }

      case "remove": {
        const branch = requestedBranch(args.branch, "remove")
        const worktree = listWorktrees(cwd).find((item) => item.branch === branch)
        if (!worktree) {
          return jsonOutput({
            success: false,
            operation: "remove",
            message: `Worktree for branch ${branch} not found`,
            branch,
            path: null,
            base: null,
            exists: false,
            removed: false,
            branchDeleted: false,
          })
        }

        runGit(["worktree", "remove", ...(args.force ? ["--force"] : []), worktree.path], cwd)

        const deleted = gitResult(["branch", args.force ? "-D" : "-d", branch], cwd)

        return jsonOutput({
          success: true,
          operation: "remove",
          message: `Removed worktree for ${branch} at ${worktree.path}`,
          branch,
          path: worktree.path,
          base: null,
          exists: existsSync(worktree.path),
          removed: !existsSync(worktree.path),
          force: args.force,
          branchDeleted: deleted.ok,
          branchDeleteError: deleted.ok ? null : deleted.stderr.trim(),
        })
      }

      default:
        throw new Error(`Unknown operation: ${args.operation}`)
    }
  },
})
