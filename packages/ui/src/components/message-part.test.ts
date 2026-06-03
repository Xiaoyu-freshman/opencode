import { describe, expect, test } from "bun:test"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { toolPartRenderable } from "./message-part-visibility"
import { readPartText } from "./message-part-text"

describe("readPartText", () => {
  test("returns empty string when accum is undefined and part text is undefined", () => {
    expect(readPartText(undefined, { id: "part_1" })).toBe("")
  })

  test("returns trimmed part text when accum is undefined", () => {
    expect(readPartText(undefined, { id: "part_1", text: "  hello  " })).toBe("hello")
  })

  test("prefers accum value over part text when accum has a hit", () => {
    expect(readPartText({ part_1: "  from accum  " }, { id: "part_1", text: "from part" })).toBe("from accum")
  })

  test("falls back to part text when accum misses", () => {
    expect(readPartText({ other_part: "ignored" }, { id: "part_1", text: "  from part  " })).toBe("from part")
  })

  test("returns empty string for whitespace-only text", () => {
    expect(readPartText(undefined, { id: "part_1", text: "   \n\t  " })).toBe("")
  })

  test("trims leading and trailing whitespace", () => {
    expect(readPartText(undefined, { id: "part_1", text: "\n  body  \n" })).toBe("body")
  })
})

describe("renderable", () => {
  test("hides internal orchestrator cockpit events", () => {
    expect(toolPartRenderable(cockpitToolPart("event"))).toBe(false)
    expect(toolPartRenderable(cockpitToolPart("create"))).toBe(false)
    expect(toolPartRenderable(cockpitToolPart("complete"))).toBe(false)
    expect(toolPartRenderable(cockpitToolPart("status"))).toBe(false)
  })

  test("shows orchestrator cockpit display output", () => {
    expect(toolPartRenderable(cockpitToolPart("display"))).toBe(true)
  })

  test("shows orchestrator cockpit errors", () => {
    expect(toolPartRenderable(cockpitToolPart("event", "error"))).toBe(true)
  })
})

function cockpitToolPart(action: string, status: "completed" | "error" = "completed"): ToolPart {
  const base = {
    id: `part_${action}_${status}`,
    sessionID: "ses_test",
    messageID: "msg_test",
    type: "tool",
    callID: `call_${action}_${status}`,
    tool: "orchestrator-cockpit",
  } satisfies Omit<ToolPart, "state">

  if (status === "error") {
    return {
      ...base,
      state: {
        status,
        input: { action },
        error: "failed",
        time: { start: 1, end: 2 },
      },
    } satisfies ToolPart
  }

  return {
    ...base,
    state: {
      status,
      input: { action },
      output: "Current run\nStatus: completed",
      title: "completed",
      metadata: {},
      time: { start: 1, end: 2 },
    },
  } satisfies ToolPart
}
