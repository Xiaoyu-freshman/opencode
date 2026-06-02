/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"
import { existsSync } from "fs"
import { mkdir, readFile, readdir, writeFile } from "fs/promises"
import { basename, dirname, join } from "path"

const lowerAgentFiles = [
  "bus.md",
  "bus-worker-diagnostic.md",
  "bus-worker-implementation.md",
  "bus-worker-full.md",
]
const orchestratorAgentFile = "orchestrator.md"
const compatibleDefaultModel = "openai/gpt-5.4-mini"

type Scope = "auto" | "project" | "global"
type Action = "list" | "status" | "apply"

type AgentModel = {
  file: string
  path: string
  exists: boolean
  model?: string
}

export async function orchestratorModelPreset(input: {
  action: Action
  model?: string
  scope?: Scope
  configDir?: string
  projectDir?: string
  dryRun?: boolean
  backup?: boolean
}) {
  const projectDir = nonEmpty(input.projectDir) ?? process.cwd()
  const globalDir = join(process.env.HOME || "~", ".config", "opencode")
  const targetDir = nonEmpty(input.configDir) ?? resolveTargetDir(input.scope ?? "auto", projectDir, globalDir)
  const lowerAgents = await Promise.all(lowerAgentFiles.map((file) => readAgentModel(targetDir, file)))
  const orchestrator = await readAgentModel(targetDir, orchestratorAgentFile)

  if (input.action === "apply") {
    const model = nonEmpty(input.model)
    if (!model) throw new Error("model is required for apply")
    if (!isModelID(model)) throw new Error("model must use provider/model format, for example openai/gpt-5.4-mini")
    const missing = lowerAgents.filter((agent) => !agent.exists).map((agent) => agent.file)
    if (missing.length > 0) throw new Error(`missing lower agent files in ${targetDir}: ${missing.join(", ")}`)
    const updated = input.dryRun
      ? lowerAgents.map((agent) => ({ file: agent.file, path: agent.path, previousModel: agent.model, nextModel: model, changed: agent.model !== model }))
      : await applyModel(targetDir, lowerAgents, model, input.backup ?? true)
    return result(
      targetDir,
      input.dryRun ? lowerAgents : await Promise.all(lowerAgentFiles.map((file) => readAgentModel(targetDir, file))),
      orchestrator,
      await discoverModels(projectDir, globalDir, targetDir),
      updated,
      input.dryRun ?? false,
    )
  }

  return result(targetDir, lowerAgents, orchestrator, await discoverModels(projectDir, globalDir, targetDir))
}

export default tool({
  description: `Manage the lower-level Orchestrator model preset.

Lists model IDs visible in current OpenCode config/agent files and can apply a chosen model to Bus and Bus-Worker agents only. The top-level Orchestrator agent is reported but never modified. By default this modifies the global OpenCode config so Bus/Worker presets apply across projects; pass scope=project only when the user explicitly asks for a project-local preset. Restart OpenCode/Desktop after applying changes because agent config is loaded at startup.`,
  args: {
    action: tool.schema.enum(["list", "status", "apply"]).describe("Operation type"),
    model: tool.schema.string().optional().describe("Model ID to apply to lower agents, using provider/model format"),
    scope: tool.schema.enum(["auto", "project", "global"]).optional().default("auto").describe("Config scope to modify; auto defaults to global"),
    configDir: tool.schema.string().optional().describe("Explicit OpenCode config directory to read/write"),
    projectDir: tool.schema.string().optional().describe("Project directory used for model discovery"),
    dryRun: tool.schema.boolean().optional().default(false).describe("Preview apply changes without writing files"),
    backup: tool.schema.boolean().optional().default(true).describe("Create backups before writing agent files"),
  },
  async execute(args, context) {
    const output = await orchestratorModelPreset({
      action: args.action,
      model: nonEmpty(args.model),
      scope: args.scope,
      configDir: nonEmpty(args.configDir),
      projectDir: nonEmpty(args.projectDir) ?? context.directory,
      dryRun: args.dryRun,
      backup: args.backup,
    })
    return { output: JSON.stringify(output, null, 2) }
  },
})

function resolveTargetDir(scope: Scope, projectDir: string, globalDir: string) {
  if (scope === "global") return globalDir
  if (scope === "project") return join(projectDir, ".opencode")
  return globalDir
}

async function readAgentModel(configDir: string, file: string): Promise<AgentModel> {
  const path = [join(configDir, "agent", file), join(configDir, "agents", file)].find((candidate) => existsSync(candidate)) ?? join(configDir, "agent", file)
  if (!existsSync(path)) return { file, path, exists: false }
  return { file, path, exists: true, model: extractFrontmatterModel(await readFile(path, "utf8")) }
}

async function applyModel(configDir: string, agents: AgentModel[], model: string, backup: boolean) {
  const backupDir = join(configDir, "backups", `model-preset-${new Date().toISOString().replace(/[:.]/g, "-")}`)
  return Promise.all(
    agents.map(async (agent) => {
      const content = await readFile(agent.path, "utf8")
      if (backup) {
        await mkdir(join(backupDir, dirname(relativeAgentPath(agent))), { recursive: true })
        await writeFile(join(backupDir, relativeAgentPath(agent)), content)
      }
      await writeFile(agent.path, replaceFrontmatterModel(content, model))
      return { file: agent.file, path: agent.path, previousModel: agent.model, nextModel: model, changed: agent.model !== model }
    }),
  )
}

function relativeAgentPath(agent: AgentModel) {
  return `${basename(dirname(agent.path))}/${agent.file}`
}

async function discoverModels(projectDir: string, globalDir: string, targetDir: string) {
  return Array.from(
    new Set(
      [compatibleDefaultModel]
        .concat(await modelsFromConfigDir(globalDir))
        .concat(await modelsFromConfigDir(join(projectDir, ".opencode")))
        .concat(await modelsFromConfigFiles(projectDir))
        .concat(await modelsFromConfigDir(targetDir)),
    ),
  ).sort()
}

async function modelsFromConfigDir(configDir: string) {
  return (await Promise.all([modelsFromAgentDir(join(configDir, "agent")), modelsFromAgentDir(join(configDir, "agents")), modelsFromConfigFiles(configDir)])).flat()
}

async function modelsFromAgentDir(dir: string) {
  if (!existsSync(dir)) return []
  return (await Promise.all(
    (await readdir(dir))
      .filter((file) => file.endsWith(".md"))
      .map(async (file) => extractFrontmatterModel(await readFile(join(dir, file), "utf8"))),
  )).filter((model): model is string => Boolean(model))
}

async function modelsFromConfigFiles(dir: string) {
  return (await Promise.all(
    ["opencode.json", "opencode.jsonc"].map(async (file) => {
      const path = join(dir, file)
      if (!existsSync(path)) return []
      return extractJsonModelStrings(await readFile(path, "utf8"))
    }),
  )).flat()
}

function extractFrontmatterModel(content: string) {
  return content.match(/^model:\s*([^\s#]+)/m)?.[1]
}

function replaceFrontmatterModel(content: string, model: string) {
  if (!content.startsWith("---\n")) return `---\nmodel: ${model}\n---\n\n${content}`
  if (/^model:\s*[^\s#]+/m.test(content)) return content.replace(/^model:\s*[^\s#]+/m, `model: ${model}`)
  return content.replace(/^---\n/, `---\nmodel: ${model}\n`)
}

function extractJsonModelStrings(content: string) {
  const directModels = Array.from(content.matchAll(/"(?:model|small_model)"\s*:\s*"([^"]+)"/g)).map((match) => match[1])
  const parsed = parseJsoncObject(content)
  const providerModels = isRecord(parsed?.provider)
    ? Object.entries(parsed.provider).flatMap(([providerID, provider]) =>
        isRecord(provider) && isRecord(provider.models)
          ? Object.keys(provider.models).map((modelID) => `${providerID}/${modelID}`)
          : [],
      )
    : []
  return directModels.concat(providerModels).filter(isModelID)
}

function parseJsoncObject(content: string) {
  try {
    const parsed = JSON.parse(stripJsonComments(content))
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function stripJsonComments(content: string) {
  let result = ""
  let inString = false
  let escaped = false
  let inLineComment = false
  let inBlockComment = false
  for (let index = 0; index < content.length; index++) {
    const char = content[index]
    const next = content[index + 1]
    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false
        result += char
      }
      continue
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false
        index++
      }
      continue
    }
    if (!inString && char === "/" && next === "/") {
      inLineComment = true
      index++
      continue
    }
    if (!inString && char === "/" && next === "*") {
      inBlockComment = true
      index++
      continue
    }
    result += char
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === '"') inString = !inString
  }
  return result
}

function isModelID(value: string) {
  return /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.:/-]*$/i.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function result(targetDir: string, lowerAgents: AgentModel[], orchestrator: AgentModel, discoveredModels: string[], updates?: unknown, dryRun = false) {
  return {
    success: true,
    targetDir,
    lowerAgents,
    orchestrator,
    currentLowerModel: lowerAgents.every((agent) => agent.model === lowerAgents[0]?.model) ? lowerAgents[0]?.model : undefined,
    discoveredModels,
    updates,
    dryRun,
    restartRequired: Boolean(updates) && !dryRun,
    note: updates && !dryRun
      ? "Lower Bus/Worker agent model files were updated. Restart OpenCode/Desktop for the new agent config to load."
      : updates
        ? "Dry run only. No files were changed. Apply without dryRun to update Bus/Worker agents."
      : "Use action=apply with one discovered model or a custom provider/model ID to update global Bus/Worker agents by default. Pass scope=project only for an explicit project-local preset. Orchestrator is not modified.",
  }
}
