/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"
import { existsSync } from "fs"
import { readFile, rm } from "fs/promises"
import { join } from "path"
import { pathToFileURL } from "url"

export const requiredAgents = [
  "orchestrator.md",
  "bus.md",
  "bus-worker-implementation.md",
  "bus-worker-full.md",
  "bus-worker-diagnostic.md",
]

export const requiredTools = [
  "orchestrate.ts",
  "task-state.ts",
  "progress-display.ts",
  "log-viewer.ts",
  "confirm-dialog.ts",
  "error-display.ts",
  "error-handler.ts",
  "concurrency-manager.ts",
  "memory-manager.ts",
  "storage-manager.ts",
  "performance-monitor.ts",
  "worktree.ts",
  "scheduler.ts",
  "orchestrator-health.ts",
]

type Check = {
  name: string
  ok: boolean
  message: string
  path?: string
}

type RuntimeTool = {
  execute: (args: Record<string, unknown>, context: ToolContext) => unknown | Promise<unknown>
}

type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  directory: string
  worktree: string
  abort: AbortSignal
  metadata: () => Record<string, never>
  ask: () => Promise<{ type: "allow" }>
}

export async function checkOrchestratorHealth(input: { configDir?: string; smoke?: boolean } = {}) {
  const configDir = input.configDir ?? join(process.env.HOME || "~", ".config", "opencode")
  const checks: Check[] = []

  for (const agent of requiredAgents) {
    checks.push(await fileCheck(`agent/${agent}`, join(configDir, "agent", agent)))
  }

  for (const toolFile of requiredTools) {
    checks.push(await fileCheck(`tool/${toolFile}`, join(configDir, "tool", toolFile)))
  }

  const pluginResolution = await resolvePlugin(configDir)
  checks.push(pluginResolution)

  const importableTools = await Promise.all(
    requiredTools.map(async (toolFile) => {
      const file = join(configDir, "tool", toolFile)
      if (!existsSync(file)) {
        return { name: `import tool/${toolFile}`, ok: false, message: "missing tool file", path: file }
      }
      try {
        const imported = await import(`${pathToFileURL(file).href}?health=${Date.now()}-${Math.random()}`)
        return isRuntimeTool(imported.default)
          ? { name: `import tool/${toolFile}`, ok: true, message: "imported executable tool", path: file }
          : { name: `import tool/${toolFile}`, ok: false, message: "default export is not an executable tool", path: file }
      } catch (error) {
        return { name: `import tool/${toolFile}`, ok: false, message: errorMessage(error), path: file }
      }
    }),
  )
  checks.push(...importableTools)

  if (input.smoke ?? true) {
    checks.push(...(await smokeTools(configDir)))
  }

  const ok = checks.every((check) => check.ok)
  return {
    ok,
    configDir,
    summary: `${checks.filter((check) => check.ok).length}/${checks.length} checks passed`,
    checks,
    report: formatReport(ok, configDir, checks),
  }
}

export default tool({
  description: `Validate a global Orchestrator installation under ~/.config/opencode.

Checks required agent files, required tool files, @opencode-ai/plugin installation,
dynamic tool imports, and selected tool smoke execution using unique IDs.`,
  args: {
    configDir: tool.schema.string().optional().describe("Config directory to check (defaults to ~/.config/opencode)"),
    smoke: tool.schema.boolean().optional().default(true).describe("Run selected smoke executions"),
  },
  async execute(args) {
    const result = await checkOrchestratorHealth({ configDir: args.configDir, smoke: args.smoke })
    return {
      output: result.report,
      metadata: {
        ok: result.ok,
        configDir: result.configDir,
        summary: result.summary,
        checks: result.checks,
      },
    }
  },
})

async function fileCheck(name: string, path: string): Promise<Check> {
  return existsSync(path)
    ? { name, ok: true, message: "exists", path }
    : { name, ok: false, message: "missing", path }
}

async function resolvePlugin(configDir: string): Promise<Check> {
  const path = join(configDir, "node_modules", "@opencode-ai", "plugin", "package.json")
  if (!existsSync(path)) {
    return { name: "resolve @opencode-ai/plugin", ok: false, message: "missing package.json", path }
  }

  try {
    const pkg = JSON.parse(await readFile(path, "utf8"))
    return { name: "resolve @opencode-ai/plugin", ok: true, message: `installed${pkg.version ? ` ${pkg.version}` : ""}`, path }
  } catch (error) {
    return { name: "resolve @opencode-ai/plugin", ok: false, message: errorMessage(error), path }
  }
}

async function smokeTools(configDir: string): Promise<Check[]> {
  const id = `orchestrator-health-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const context = smokeContext(configDir, id)
  const checks: Check[] = []

  checks.push(
    await smokeTool(configDir, "task-state", { action: "create", taskID: `${id}-task`, task: "Orchestrator health" }, context),
  )
  checks.push(await smokeTool(configDir, "task-state", { action: "delete", taskID: `${id}-task` }, context))
  checks.push(await smokeTool(configDir, "concurrency-manager", { action: "acquire", taskID: `${id}-lock` }, context))
  checks.push(await smokeTool(configDir, "concurrency-manager", { action: "release", taskID: `${id}-lock` }, context))
  checks.push(
    await smokeTool(
      configDir,
      "orchestrate",
      { task: "Health Smoke", prompt: "Validate Orchestrator health tool protocol.", timeout: 1 },
      context,
    ),
  )
  checks.push(
    await smokeTool(
      configDir,
      "scheduler",
      {
        action: "plan",
        configDir,
        schedulerTaskId: `${id}-scheduler`,
        title: "Orchestrator health scheduler smoke",
        tier: "M",
        workers: [
          {
            subagent_type: "bus-worker-diagnostic",
            description: "Health scheduler diagnostic worker",
            prompt: "Validate scheduler state protocol only. Do not modify files.",
          },
        ],
      },
      context,
    ),
  )
  checks.push(await smokeTool(configDir, "scheduler", { action: "status", configDir, schedulerTaskId: `${id}-scheduler` }, context))
  checks.push(await smokeTool(configDir, "scheduler", { action: "cleanup", configDir, schedulerTaskId: `${id}-scheduler` }, context))

  await rm(join(configDir, "tasks", `${id}-task.json`), { force: true }).catch(() => {})
  await rm(join(configDir, "scheduler", `${id}-scheduler.json`), { force: true }).catch(() => {})
  return checks
}

async function smokeTool(configDir: string, name: string, args: Record<string, unknown>, context: ToolContext): Promise<Check> {
  const path = join(configDir, "tool", `${name}.ts`)
  try {
    const imported = await import(`${pathToFileURL(path).href}?smoke=${Date.now()}-${Math.random()}`)
    if (!isRuntimeTool(imported.default)) {
      return { name: `smoke ${name}`, ok: false, message: "default export is not an executable tool", path }
    }
    const result = await imported.default.execute(args, context)
    return validToolResult(result)
      ? { name: `smoke ${name}`, ok: true, message: "returned valid plugin tool result", path }
      : { name: `smoke ${name}`, ok: false, message: "result must be a string or { output: string }", path }
  } catch (error) {
    return { name: `smoke ${name}`, ok: false, message: errorMessage(error), path }
  }
}

function smokeContext(configDir: string, id: string): ToolContext {
  return {
    sessionID: `${id}-session`,
    messageID: `${id}-message`,
    agent: "orchestrator",
    directory: configDir,
    worktree: configDir,
    abort: new AbortController().signal,
    metadata: () => ({}),
    async ask() {
      return { type: "allow" }
    },
  }
}

function isRuntimeTool(value: unknown): value is RuntimeTool {
  return typeof value === "object" && value !== null && "execute" in value && typeof value.execute === "function"
}

function validToolResult(value: unknown) {
  return typeof value === "string" || (typeof value === "object" && value !== null && "output" in value && typeof value.output === "string")
}

function formatReport(ok: boolean, configDir: string, checks: Check[]) {
  return [
    `Orchestrator health: ${ok ? "OK" : "FAILED"}`,
    `Config dir: ${configDir}`,
    `Checks: ${checks.filter((check) => check.ok).length}/${checks.length} passed`,
    "",
    ...checks.map((check) => `${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.message}${check.path ? ` (${check.path})` : ""}`),
  ].join("\n")
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}${error.cause ? `; cause: ${String(error.cause)}` : ""}`
  return String(error)
}
