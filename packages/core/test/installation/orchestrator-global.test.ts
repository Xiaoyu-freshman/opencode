import { describe, expect, test } from "bun:test"
import { safePluginVersion } from "../../../../script/install-orchestrator-global"

describe("safePluginVersion", () => {
  test("preserves an existing npm dependency version", () => {
    expect(safePluginVersion("1.15.13", "1.15.11", "1.15.11")).toBe("1.15.13")
    expect(safePluginVersion("^1.15.13", "1.15.11", "1.15.11")).toBe("^1.15.13")
  })

  test("falls back when the existing dependency is local", () => {
    expect(safePluginVersion("local", "1.15.11", "1.15.12")).toBe("1.15.11")
    expect(safePluginVersion("workspace:*", "1.15.11", "1.15.12")).toBe("1.15.11")
    expect(safePluginVersion("file:../plugin", "1.15.11", "1.15.12")).toBe("1.15.11")
  })

  test("falls back to opencode version when repo plugin version is local", () => {
    expect(safePluginVersion(undefined, "local", "1.15.12")).toBe("1.15.12")
    expect(safePluginVersion(undefined, "workspace:*", "1.15.12")).toBe("1.15.12")
  })
})
