#!/usr/bin/env bun

import { $ } from "bun"
import { cp, mkdir, readdir, readFile, rm, writeFile } from "fs/promises"
import { existsSync } from "fs"
import { dirname, join } from "path"

const repo = import.meta.dir.replace(/\/script$/, "")
const globalDir = join(process.env.HOME || "~", ".config", "opencode")
const backupRoot = join(globalDir, "backups")
const requiredAgents = [
  "orchestrator.md",
  "bus.md",
  "bus-worker-implementation.md",
  "bus-worker-full.md",
  "bus-worker-diagnostic.md",
]
const requiredTools = [
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
  "orchestrator-model-preset.ts",
  "orchestrator-health.ts",
]
const lowerAgentFiles = new Set([
  "bus.md",
  "bus-worker-implementation.md",
  "bus-worker-full.md",
  "bus-worker-diagnostic.md",
])
const managedFiles = [
  ...requiredAgents.map((file) => `agent/${file}`),
  ...requiredTools.map((file) => `tool/${file}`),
]
const dependencyFiles = ["package.json", "bun.lock", "bun.lockb", "package-lock.json"]

type BackupManifest = {
  createdAt: string
  files: { path: string; existed: boolean }[]
}

if (import.meta.main) {
  if (process.argv.includes("--rollback")) await rollback()
  else await install()
}

async function install() {
  await mkdir(globalDir, { recursive: true })
  const backupDir = join(backupRoot, `orchestrator-${new Date().toISOString().replace(/[:.]/g, "-")}`)
  const manifest: BackupManifest = { createdAt: new Date().toISOString(), files: [] }

  for (const file of [...managedFiles, ...dependencyFiles]) {
    const target = join(globalDir, file)
    const existed = existsSync(target)
    manifest.files.push({ path: file, existed })
    if (!existed) continue
    await mkdir(dirname(join(backupDir, file)), { recursive: true })
    await cp(target, join(backupDir, file))
  }
  await mkdir(backupDir, { recursive: true })
  await writeFile(join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2))

  for (const file of managedFiles) {
    await mkdir(dirname(join(globalDir, file)), { recursive: true })
    await writeManagedFile(file)
  }

  await ensurePluginDependency()

  console.log(`Installed global Orchestrator into ${globalDir}`)
  console.log(`Backup written to ${backupDir}`)
  console.log("Next steps: restart OpenCode/Desktop, then run the orchestrator-health tool.")
}

async function writeManagedFile(file: string) {
  const source = join(repo, ".opencode", file)
  const target = join(globalDir, file)
  if (!file.startsWith("agent/") || !lowerAgentFiles.has(file.replace(/^agent\//, "")) || !existsSync(target)) {
    await cp(source, target)
    return
  }

  const existingModel = extractFrontmatterModel(await readFile(target, "utf8"))
  if (!existingModel) {
    await cp(source, target)
    return
  }
  await writeFile(target, replaceFrontmatterModel(await readFile(source, "utf8"), existingModel))
}

async function rollback() {
  const backups = existsSync(backupRoot)
    ? (await readdir(backupRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("orchestrator-"))
        .map((entry) => entry.name)
        .sort()
    : []
  const latest = backups.at(-1)
  if (!latest) throw new Error(`No Orchestrator backups found in ${backupRoot}`)

  const backupDir = join(backupRoot, latest)
  const manifest = JSON.parse(await readFile(join(backupDir, "manifest.json"), "utf8")) as BackupManifest
  for (const file of manifest.files) {
    const target = join(globalDir, file.path)
    if (file.existed) {
      await mkdir(dirname(target), { recursive: true })
      await cp(join(backupDir, file.path), target)
      continue
    }
    await rm(target, { force: true })
  }

  console.log(`Rolled back global Orchestrator from ${backupDir}`)
  console.log("Next steps: restart OpenCode/Desktop.")
}

async function ensurePluginDependency() {
  const packageJsonPath = join(globalDir, "package.json")
  const existing = existsSync(packageJsonPath)
    ? (JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>)
    : {}
  const dependencies = isRecord(existing.dependencies) ? existing.dependencies : {}
  const version = await pluginVersion(dependencies["@opencode-ai/plugin"])
  await writeFile(
    packageJsonPath,
    JSON.stringify(
      {
        ...existing,
        private: true,
        dependencies: {
          ...dependencies,
          "@opencode-ai/plugin": version,
        },
      },
      null,
      2,
    ),
  )
  await $`bun install --ignore-scripts --cwd ${globalDir}`
}

async function pluginVersion(existing: unknown) {
  const version = (JSON.parse(await readFile(join(repo, "packages", "plugin", "package.json"), "utf8")) as { version?: string }).version
  const opencodeVersion = (JSON.parse(await readFile(join(repo, "packages", "opencode", "package.json"), "utf8")) as { version?: string }).version
  const safeVersion = safePluginVersion(existing, version, opencodeVersion)
  if (safeVersion) return safeVersion
  throw new Error("Could not determine a release version for @opencode-ai/plugin")
}

export function safePluginVersion(existing: unknown, repoPluginVersion: unknown, opencodeVersion: unknown) {
  if (isSafeNpmVersion(existing)) return existing
  if (isSafeNpmVersion(repoPluginVersion)) return repoPluginVersion
  if (isSafeNpmVersion(opencodeVersion)) return opencodeVersion
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isSafeNpmVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "local" &&
    !value.startsWith("workspace:") &&
    !value.startsWith("file:")
  )
}

function extractFrontmatterModel(content: string) {
  return content.match(/^model:\s*([^\s#]+)/m)?.[1]
}

function replaceFrontmatterModel(content: string, model: string) {
  if (!content.startsWith("---\n")) return `---\nmodel: ${model}\n---\n\n${content}`
  if (/^model:\s*[^\s#]+/m.test(content)) return content.replace(/^model:\s*[^\s#]+/m, `model: ${model}`)
  return content.replace(/^---\n/, `---\nmodel: ${model}\n`)
}
