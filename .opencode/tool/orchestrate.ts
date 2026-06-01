/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"

export default tool({
  description: `Prepare and enhance a prompt for dispatching work to a Bus agent via the task tool.

This tool validates inputs and generates a complete, bus-ready prompt with:
- Worker type specifications
- Timeout configuration
- Worktree isolation instructions
- Structured output format requirements

Workflow:
1. Call orchestrate({ task, prompt, workers?, timeout? })
2. Pass the returned enhancedPrompt to the task tool: task({ subagent_type: "bus", prompt: result.enhancedPrompt, description: result.taskDescription })`,
  args: {
    task: tool.schema
      .string()
      .describe("Short task name (used for worktree directory naming)"),
    prompt: tool.schema
      .string()
      .describe("Detailed instructions for the bus agent and workers"),
    workers: tool.schema
      .array(tool.schema.string())
      .describe("Worker types to create (e.g. ['implementer', 'reviewer'])")
      .optional(),
    timeout: tool.schema
      .number()
      .describe("Timeout in minutes for the orchestration (default: 30)")
      .default(30)
      .optional(),
  },
  async execute(args) {
    if (!args.task.trim()) {
      throw new Error("task must be a non-empty string")
    }
    if (!args.prompt.trim()) {
      throw new Error("prompt must be a non-empty string")
    }

    const timeout = args.timeout ?? 30
    const workers = args.workers ?? []
    const workerSection = workers.length > 0
      ? `## Workers\n\nCreate the following workers:\n${workers.map((w) => `- **${w}**`).join("\n")}`
      : "## Workers\n\nDetermine appropriate worker types based on the task."

    const enhancedPrompt = `# Orchestration Task: ${args.task}

${args.prompt}

## Worktree Isolation

Each worker MUST operate in an isolated git worktree under \`.worktrees/\`.
- Use the \`worktree\` tool to create worktrees: \`worktree({ operation: "create", task: "<worker-task-name>" })\`
- Workers should operate within their assigned worktree path
- After completion, worktrees can be cleaned up with \`worktree({ operation: "remove", branch: "<branch>" })\`

${workerSection}

## Timeout

This orchestration has a ${timeout}-minute timeout. Plan work accordingly.
If a worker cannot complete within the time limit, it should commit partial progress and report status.

## Structured Output

When all workers complete, produce a final report in this exact format:

\`\`\`
## Orchestration Report: ${args.task}

### Summary
- Status: <completed | partial | failed>
- Workers: <count>
- Duration: <elapsed time>

### Worker Results
For each worker:
#### <worker-name>
- Status: <completed | partial | failed>
- Files changed: <list of files>
- Tests run: <yes/no> | Results: <pass/fail>
- Errors: <none or description>
- Notes: <any additional context>

### Integration Notes
- <any conflicts, dependencies, or follow-up items>
\`\`\`

If any worker fails, still report results from successful workers and describe the failure.`
    return {
      title: `Orchestrate: ${args.task}`,
      output: enhancedPrompt,
      metadata: {
        task: args.task,
        timeout,
        workers,
        workerCount: workers.length,
      },
    }
  },
})
