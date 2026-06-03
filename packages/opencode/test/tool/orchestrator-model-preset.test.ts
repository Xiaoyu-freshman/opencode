import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { orchestratorModelPreset } from "../../../../.opencode/tool/orchestrator-model-preset"

const lowerAgentFiles = [
  "bus.md",
  "bus-worker-diagnostic.md",
  "bus-worker-implementation.md",
  "bus-worker-full.md",
]

describe("orchestrator model preset", () => {
  test("discovers configured models and applies only to lower agents", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "opencode-model-preset-config-"))
    const projectDir = await mkdtemp(join(tmpdir(), "opencode-model-preset-project-"))
    const home = await mkdtemp(join(tmpdir(), "opencode-model-preset-home-"))
    const previousHome = process.env.HOME
    try {
      process.env.HOME = home
      await mkdir(join(configDir, "agent"), { recursive: true })
      await writeFile(
        join(configDir, "opencode.jsonc"),
        JSON.stringify({
          provider: {
            mimo: {
              name: "xiaomi",
              models: {
                "mimo-v2.5-pro": { name: "mimo-v2.5-pro" },
              },
            },
          },
        }),
      )
      await Promise.all(
        lowerAgentFiles.map((file) => writeFile(join(configDir, "agent", file), agent(file, "openai/gpt-5.4-mini"))),
      )
      await writeFile(join(configDir, "agent", "orchestrator.md"), agent("orchestrator", "openai/gpt-5.5"))

      const listed = await orchestratorModelPreset({ action: "list", configDir, projectDir })

      expect(listed.discoveredModels).toContain("openai/gpt-5.4-mini")
      expect(listed.discoveredModels).toContain("openai/gpt-5.5")
      expect(listed.discoveredModels).toContain("mimo/mimo-v2.5-pro")
      expect(listed.discoveredModels).not.toContain("xiaomo/mimo-v2.5-pro")
      expect(listed.currentLowerModel).toBe("openai/gpt-5.4-mini")

      const applied = await orchestratorModelPreset({ action: "apply", configDir, projectDir, model: "mimo/mimo-v2.5-pro" })

      expect(applied.currentLowerModel).toBe("mimo/mimo-v2.5-pro")
      expect(applied.restartRequired).toBe(true)
      expect(await Promise.all(lowerAgentFiles.map((file) => readFile(join(configDir, "agent", file), "utf8")))).toEqual(
        lowerAgentFiles.map((file) => agent(file, "mimo/mimo-v2.5-pro")),
      )
      expect(await readFile(join(configDir, "agent", "orchestrator.md"), "utf8")).toBe(agent("orchestrator", "openai/gpt-5.5"))
      expect((await readdir(join(configDir, "backups"))).some((file) => file.startsWith("model-preset-"))).toBe(true)
    } finally {
      process.env.HOME = previousHome
      await rm(configDir, { recursive: true, force: true })
      await rm(projectDir, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  })

  test("supports dry run without writing agent files", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "opencode-model-preset-dry-run-"))
    try {
      await mkdir(join(configDir, "agent"), { recursive: true })
      await Promise.all(
        lowerAgentFiles.map((file) => writeFile(join(configDir, "agent", file), agent(file, "openai/gpt-5.4-mini"))),
      )

      const preview = await orchestratorModelPreset({ action: "apply", configDir, projectDir: configDir, model: "mimo/mimo-v2.5-pro", dryRun: true })

      expect(preview.restartRequired).toBe(false)
      expect(preview.currentLowerModel).toBe("openai/gpt-5.4-mini")
      expect(await readFile(join(configDir, "agent", "bus.md"), "utf8")).toBe(agent("bus.md", "openai/gpt-5.4-mini"))
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test("treats empty optional strings as omitted and defaults auto scope to global", async () => {
    const home = await mkdtemp(join(tmpdir(), "opencode-model-preset-home-"))
    const projectDir = await mkdtemp(join(tmpdir(), "opencode-model-preset-empty-strings-"))
    const previousHome = process.env.HOME
    try {
      process.env.HOME = home
      await mkdir(join(home, ".config", "opencode", "agent"), { recursive: true })
      await mkdir(join(projectDir, ".opencode", "agent"), { recursive: true })
      await Promise.all(
        lowerAgentFiles.flatMap((file) => [
          writeFile(join(home, ".config", "opencode", "agent", file), agent(file, "openai/gpt-5.4-mini")),
          writeFile(join(projectDir, ".opencode", "agent", file), agent(file, "xiaomo/mimo-v2.5-pro")),
        ]),
      )
      await writeFile(join(home, ".config", "opencode", "agent", "orchestrator.md"), agent("orchestrator", "openai/gpt-5.5"))
      await writeFile(join(projectDir, ".opencode", "agent", "orchestrator.md"), agent("orchestrator", "openai/gpt-5.5"))

      const status = await orchestratorModelPreset({ action: "status", model: "", scope: "auto", configDir: "", projectDir })

      expect(status.targetDir).toBe(join(home, ".config", "opencode"))
      expect(status.currentLowerModel).toBe("openai/gpt-5.4-mini")
      expect(status.lowerAgents.every((agent) => agent.exists)).toBe(true)

      const projectStatus = await orchestratorModelPreset({ action: "status", scope: "project", configDir: "", projectDir })
      expect(projectStatus.targetDir).toBe(join(projectDir, ".opencode"))
      expect(projectStatus.currentLowerModel).toBe("xiaomo/mimo-v2.5-pro")
    } finally {
      process.env.HOME = previousHome
      await rm(home, { recursive: true, force: true })
      await rm(projectDir, { recursive: true, force: true })
    }
  })
})

function agent(name: string, model: string) {
  return `---\nmode: subagent\nmodel: ${model}\ndescription: ${name}\n---\n\nBody\n`
}
