import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "fs/promises"
import { join } from "path"

type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  directory: string
  worktree: string
  abort: AbortSignal
  metadata: () => unknown
  ask: () => Promise<unknown>
}

type RuntimeTool = {
  execute: (args: Record<string, unknown>, context: ToolContext) => unknown | Promise<unknown>
}

type ToolModule = {
  default: RuntimeTool
}

const configDir = join(process.env.HOME ?? "~", ".config", "opencode")
const cleanupFiles = new Set<string>()
const context = {
  sessionID: "ses_orchestrator_real_tools_test",
  messageID: "msg_orchestrator_real_tools_test",
  agent: "build",
  directory: process.cwd(),
  worktree: process.cwd(),
  abort: new AbortController().signal,
  metadata: () => ({}),
  async ask() {
    return { type: "allow" }
  },
}

afterEach(async () => {
  await Promise.all(Array.from(cleanupFiles).map((file) => rm(file, { force: true })))
  cleanupFiles.clear()
})

describe("real orchestrator project tools", () => {
  test("execute with plugin runtime result protocol", async () => {
    const id = `orchestrator-real-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    cleanupFiles.add(join(configDir, "tasks", `${id}-task.json`))
    cleanupFiles.add(join(configDir, "progress", `${id}-progress.json`))
    cleanupFiles.add(join(configDir, "logs", `${id}-session.json`))
    cleanupFiles.add(join(configDir, "dialogs", `${id}-dialog.json`))
    cleanupFiles.add(join(configDir, "errors", `${id}-error.json`))

    const taskState = await importRealTool("task-state")
    const createdTask = parseJsonOutput(
      await executeTool(taskState.default, {
        action: "create",
        taskID: `${id}-task`,
        task: "Real tools smoke task",
        prompt: "Validate task-state create/delete",
      }),
    )
    expect(createdTask).toMatchObject({ success: true, taskID: `${id}-task` })
    expect(
      parseJsonOutput(await executeTool(taskState.default, { action: "delete", taskID: `${id}-task` })),
    ).toMatchObject({ success: true })

    const errorHandler = await importRealTool("error-handler")
    expect(
      parseJsonOutput(
        await executeTool(errorHandler.default, { action: "classify", error: "worker failed after timeout" }),
      ),
    ).toMatchObject({ success: true })

    const progressDisplay = await importRealTool("progress-display")
    expect(
      parseJsonOutput(
        await executeTool(progressDisplay.default, {
          action: "update",
          taskID: `${id}-progress`,
          currentTask: "Real progress task",
          taskStatus: "running",
          progress: 25,
          totalTasks: 1,
        }),
      ),
    ).toMatchObject({ success: true })

    const logViewer = await importRealTool("log-viewer")
    expect(
      parseJsonOutput(
        await executeTool(logViewer.default, {
          action: "log",
          sessionID: `${id}-session`,
          level: "info",
          source: "real-test",
          message: "real tool log entry",
        }),
      ),
    ).toMatchObject({ success: true })
    expect(
      parseJsonOutput(await executeTool(logViewer.default, { action: "get", sessionID: `${id}-session` })),
    ).toMatchObject({ success: true, count: 1 })

    const confirmDialog = await importRealTool("confirm-dialog")
    expect(
      parseJsonOutput(
        await executeTool(confirmDialog.default, {
          action: "create",
          dialogID: `${id}-dialog`,
          title: "Real dialog",
          message: "Confirm real tool test",
        }),
      ),
    ).toMatchObject({ success: true, dialogID: `${id}-dialog` })
    expect(
      parseJsonOutput(
        await executeTool(confirmDialog.default, { action: "answer", dialogID: `${id}-dialog`, answer: "confirm" }),
      ),
    ).toMatchObject({ success: true })
    expect(
      parseJsonOutput(await executeTool(confirmDialog.default, { action: "get", dialogID: `${id}-dialog` })),
    ).toMatchObject({ success: true })

    const errorDisplay = await importRealTool("error-display")
    expect(
      parseJsonOutput(
        await executeTool(errorDisplay.default, {
          action: "show",
          errorID: `${id}-error`,
          title: "Real error",
          message: "Real tool error display",
        }),
      ),
    ).toMatchObject({ success: true, errorID: `${id}-error` })
    expect(
      parseJsonOutput(
        await executeTool(errorDisplay.default, {
          action: "resolve",
          errorID: `${id}-error`,
          resolution: "resolved by test",
        }),
      ),
    ).toMatchObject({ success: true })
    expect(
      parseJsonOutput(await executeTool(errorDisplay.default, { action: "get", errorID: `${id}-error` })),
    ).toMatchObject({ success: true })

    const concurrencyManager = await importRealTool("concurrency-manager")
    expect(
      parseJsonOutput(await executeTool(concurrencyManager.default, { action: "acquire", taskID: `${id}-concurrent` })),
    ).toMatchObject({ success: true, taskID: `${id}-concurrent` })
    expect(
      parseJsonOutput(await executeTool(concurrencyManager.default, { action: "release", taskID: `${id}-concurrent` })),
    ).toMatchObject({ success: true, taskID: `${id}-concurrent` })

    const memoryManager = await importRealTool("memory-manager")
    expect(parseJsonOutput(await executeTool(memoryManager.default, { action: "status" }))).toMatchObject({
      success: true,
    })

    const storageManager = await importRealTool("storage-manager")
    expect(parseJsonOutput(await executeTool(storageManager.default, { action: "status" }))).toMatchObject({
      success: true,
    })

    const performanceMonitor = await importRealTool("performance-monitor")
    expect(parseJsonOutput(await executeTool(performanceMonitor.default, { action: "status" }))).toMatchObject({
      success: true,
    })

    const orchestrate = await importRealTool("orchestrate")
    const output = extractOutput(
      await executeTool(orchestrate.default, {
        task: "Real Tools Smoke",
        prompt: "Coordinate a minimal real tools validation.",
        workers: ["implementer", "reviewer"],
        timeout: 5,
      }),
    )
    expect(output).toContain("Real Tools Smoke")
    expect(output).toContain("- **implementer**")
    expect(output).toContain("- **reviewer**")
    expect(output).toContain("## Structured Output")
  })
})

async function importRealTool(name: string) {
  const mod = (await import(`../../../../.opencode/tool/${name}`)) as unknown
  if (!isToolModule(mod)) throw new Error(`Imported module ${name} does not export a default executable tool`)
  return mod
}

async function executeTool(tool: unknown, args: Record<string, unknown>) {
  if (!isRuntimeTool(tool)) throw new Error("Imported module default export is not an executable tool")
  return await tool.execute(args, context)
}

function extractOutput(result: unknown) {
  if (typeof result === "string") return result
  if (!isRecord(result) || typeof result.output !== "string") {
    throw new Error("Tool result must be a string or an object with string output")
  }
  return result.output
}

function parseJsonOutput(result: unknown) {
  return JSON.parse(extractOutput(result)) as unknown
}

function isRuntimeTool(value: unknown): value is RuntimeTool {
  return isRecord(value) && typeof value.execute === "function"
}

function isToolModule(value: unknown): value is ToolModule {
  return isRecord(value) && isRuntimeTool(value.default)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
