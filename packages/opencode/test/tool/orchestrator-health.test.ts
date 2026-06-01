import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { checkOrchestratorHealth, requiredAgents, requiredTools } from "../../../../.opencode/tool/orchestrator-health"

describe("orchestrator health", () => {
  test("reports required files and metadata without touching real global config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-orchestrator-health-"))
    try {
      await mkdir(join(dir, "agent"), { recursive: true })
      await mkdir(join(dir, "tool"), { recursive: true })
      await mkdir(join(dir, "node_modules", "@opencode-ai", "plugin"), { recursive: true })
      await Promise.all([
        ...requiredAgents.map((file) => writeFile(join(dir, "agent", file), "# test\n")),
        ...requiredTools.map((file) => writeFile(join(dir, "tool", file), "export default { execute() { return 'ok' } }\n")),
        writeFile(join(dir, "node_modules", "@opencode-ai", "plugin", "package.json"), JSON.stringify({ version: "1.2.3" })),
      ])

      const result = await checkOrchestratorHealth({ configDir: dir, smoke: false })

      expect(result.configDir).toBe(dir)
      expect(result.checks.some((check) => check.name === "agent/orchestrator.md" && check.ok)).toBe(true)
      expect(result.checks.some((check) => check.name === "tool/orchestrator-health.ts" && check.ok)).toBe(true)
      expect(result.checks.some((check) => check.name === "resolve @opencode-ai/plugin" && check.ok && check.message === "installed 1.2.3")).toBe(true)
      expect(result.report).toContain("Orchestrator health:")
      expect(result.summary).toContain("checks passed")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
