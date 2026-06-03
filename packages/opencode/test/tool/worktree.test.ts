import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { basename, join } from "path"
import worktree from "../../../../.opencode/tool/worktree"

const cleanupDirs = new Set<string>()

afterEach(async () => {
  await Promise.all(Array.from(cleanupDirs).map((dir) => rm(dir, { recursive: true, force: true })))
  cleanupDirs.clear()
})

describe("worktree tool", () => {
  test("creates, lists, statuses, and removes real git worktrees with special task names", async () => {
    const repo = await createRepo()
    const task = "实现 worktree 硬化: spaces & symbols .* [x]"
    const first = await execute(repo, { operation: "create", task })
    const second = await execute(repo, { operation: "create", task })

    expect(first).toMatchObject({ success: true, operation: "create", base: "dev", exists: true })
    expect(second).toMatchObject({ success: true, operation: "create", base: "dev", exists: true })

    const firstBranch = stringField(first, "branch")
    const secondBranch = stringField(second, "branch")
    const firstPath = stringField(first, "path")
    const secondPath = stringField(second, "path")

    expect(firstBranch).not.toBe(secondBranch)
    expect(firstPath).not.toBe(secondPath)
    expect(firstBranch).toStartWith("codex/")
    expect(firstBranch).not.toMatch(/[ \[\]*.:]/)
    expect(basename(firstPath)).not.toMatch(/[ \[\]*.:]/)
    expect(existsSync(firstPath)).toBe(true)
    expect(existsSync(secondPath)).toBe(true)

    const listed = await execute(repo, { operation: "list" })
    if (!Array.isArray(listed.worktrees)) throw new Error("list result missing worktrees")
    expect(listed).toMatchObject({ success: true, operation: "list", exists: true })
    expect(listed.worktrees.filter(isRecord).map((item) => item.branch)).toContain(firstBranch)
    expect(listed.worktrees.filter(isRecord).map((item) => item.branch)).toContain(secondBranch)

    const status = await execute(repo, { operation: "status", branch: firstBranch })
    expect(status).toMatchObject({
      success: true,
      operation: "status",
      branch: firstBranch,
      path: firstPath,
      exists: true,
      clean: true,
    })
    expect(stringField(status, "status")).toContain(`## ${firstBranch}`)

    const removed = await execute(repo, { operation: "remove", branch: firstBranch })
    expect(removed).toMatchObject({
      success: true,
      operation: "remove",
      branch: firstBranch,
      path: firstPath,
      exists: false,
      removed: true,
      branchDeleted: true,
    })
    expect(existsSync(firstPath)).toBe(false)

    const afterRemove = await execute(repo, { operation: "list" })
    if (!Array.isArray(afterRemove.worktrees)) throw new Error("list result missing worktrees")
    expect(afterRemove.worktrees.filter(isRecord).map((item) => item.branch)).not.toContain(firstBranch)
    expect(afterRemove.worktrees.filter(isRecord).map((item) => item.branch)).toContain(secondBranch)

    await execute(repo, { operation: "remove", branch: secondBranch })
  })

  test("falls back to origin/dev before the current branch", async () => {
    const repo = await createRepo()
    await git(repo, ["update-ref", "refs/remotes/origin/dev", "HEAD"])
    await git(repo, ["checkout", "-b", "feature/current"])
    await git(repo, ["branch", "-D", "dev"])

    const created = await execute(repo, { operation: "create", task: "origin dev fallback" })

    expect(created).toMatchObject({ success: true, operation: "create", base: "origin/dev", exists: true })
    await execute(repo, { operation: "remove", branch: stringField(created, "branch") })
  })
})

async function createRepo() {
  const repo = await mkdtemp(join(tmpdir(), "opencode-worktree-tool-"))
  cleanupDirs.add(repo)
  await git(repo, ["init", "--initial-branch=dev"])
  await git(repo, ["config", "user.email", "test@example.com"])
  await git(repo, ["config", "user.name", "Test User"])
  await Bun.write(join(repo, "README.md"), "test repo\n")
  await git(repo, ["add", "README.md"])
  await git(repo, ["commit", "-m", "initial commit"])
  return repo
}

async function execute(directory: string, args: Parameters<typeof worktree.execute>[0]) {
  return parseJsonOutput(
    await worktree.execute(args, {
      sessionID: "ses_worktree_tool_test",
      messageID: "msg_worktree_tool_test",
      agent: "orchestrator",
      directory,
      worktree: directory,
      abort: new AbortController().signal,
      metadata: () => ({}),
      async ask() {},
    }),
  )
}

async function git(cwd: string, args: string[]) {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(stderr.trim() || stdout.trim() || `git ${args.join(" ")} failed`)
  return stdout.trim()
}

function parseJsonOutput(result: unknown) {
  if (!isRecord(result) || typeof result.output !== "string") throw new Error("Tool result must be { output: string }")
  const parsed = JSON.parse(result.output) as unknown
  if (!isRecord(parsed)) throw new Error("Tool output must be a JSON object")
  expect(result.metadata).toEqual(parsed)
  return parsed
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  if (typeof value !== "string") throw new Error(`${key} must be a string`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
