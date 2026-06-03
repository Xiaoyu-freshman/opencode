import type { ToolPart } from "@opencode-ai/sdk/v2"

export const ORCHESTRATOR_COCKPIT_TOOL = "orchestrator-cockpit"

const HIDDEN_TOOLS = new Set(["todowrite"])

export function toolPartRenderable(part: ToolPart) {
  if (HIDDEN_TOOLS.has(part.tool)) return false
  if (!cockpitToolVisible(part)) return false
  if (part.tool === "question") return part.state.status !== "pending" && part.state.status !== "running"
  return true
}

function cockpitAction(part: ToolPart) {
  const action = part.state.input.action
  if (typeof action === "string") return action
}

function cockpitToolVisible(part: ToolPart) {
  if (part.tool !== ORCHESTRATOR_COCKPIT_TOOL) return true
  if (part.state.status === "error") return true
  return cockpitAction(part) === "display"
}
