import { describe, expect, test } from "bun:test"
import { dependencyVersion } from "@opencode-ai/core/installation/version"

describe("dependencyVersion", () => {
  test("does not use local as a package dependency version", () => {
    expect(dependencyVersion("local")).toBeUndefined()
  })

  test("keeps release versions as package dependency versions", () => {
    expect(dependencyVersion("1.15.13")).toBe("1.15.13")
  })
})
