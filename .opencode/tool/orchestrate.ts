/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin/tool"

// Error handling configuration interface
interface ErrorHandlingConfig {
  maxRetries: number
  retryDelay: number
  backoffMultiplier: number
  retryableErrors: string[]
  autoRecover: boolean
  recoverableStatuses: string[]
  recoveryAction: "retry" | "resume" | "restart"
}

// Default error handling configuration
const defaultErrorHandlingConfig: ErrorHandlingConfig = {
  maxRetries: 3,
  retryDelay: 1000,
  backoffMultiplier: 2,
  retryableErrors: [
    "timeout",
    "network_error",
    "api_error",
    "worker_failed",
    "session_creation_failed",
    "message_send_failed",
  ],
  autoRecover: true,
  recoverableStatuses: ["failed"],
  recoveryAction: "retry",
}

export default tool({
  description: `Prepare and enhance a prompt for dispatching work to a Bus agent via the task tool.

This tool validates inputs and generates a complete, bus-ready prompt with:
- Worker type specifications
- Timeout configuration
- Worktree isolation instructions
- Structured output format requirements
- Error handling and recovery instructions
- User experience components (progress, logs, dialogs, errors)

Workflow:
1. Call orchestrate({ task, prompt, workers?, timeout?, errorHandling? })
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
    errorHandling: tool.schema
      .any()
      .describe("Error handling configuration (optional)")
      .optional(),
    enableUX: tool.schema
      .boolean()
      .describe("Enable user experience components (default: true)")
      .default(true)
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
    const enableUX = args.enableUX ?? true
    const errorHandling: ErrorHandlingConfig = {
      ...defaultErrorHandlingConfig,
      ...(args.errorHandling || {}),
    }

    const workerSection =
      workers.length > 0
        ? `## Workers\n\nCreate the following workers:\n${workers.map((w) => `- **${w}**`).join("\n")}`
        : "## Workers\n\nDetermine appropriate worker types based on the task."

    const errorHandlingSection = `## Error Handling and Recovery

This orchestration includes automatic error handling and recovery:

### Retry Configuration
- Max retries: ${errorHandling.maxRetries}
- Retry delay: ${errorHandling.retryDelay}ms
- Backoff multiplier: ${errorHandling.backoffMultiplier}
- Retryable errors: ${errorHandling.retryableErrors.join(", ")}

### Recovery Configuration
- Auto-recover: ${errorHandling.autoRecover ? "enabled" : "disabled"}
- Recoverable statuses: ${errorHandling.recoverableStatuses.join(", ")}
- Recovery action: ${errorHandling.recoveryAction}

### Error Handling Workflow
1. If a worker fails, classify the error type
2. If the error is retryable, automatically retry with exponential backoff
3. If max retries reached, mark task as failed
4. If task is recoverable, attempt automatic recovery
5. Report error details and recovery status in the final report

### Error Types
- **Execution errors**: worker_failed, timeout, permission_denied, resource_not_found, conflict
- **System errors**: session_creation_failed, message_send_failed, state_save_failed, network_error, api_error
- **User errors**: invalid_prompt, invalid_task, cancelled

### Recovery Actions
- **retry**: Reset task to pending and re-execute
- **resume**: Continue from last checkpoint
- **restart**: Reset task completely and re-execute from beginning`

    const uxSection = enableUX
      ? `## User Experience Components

This orchestration includes user experience components for better visibility:

### Progress Display
Use the \`progress-display\` tool to show task progress:
- Update progress: \`progress-display({ action: "update", taskID: "<task-id>", progress: <0-100>, message: "<message>" })\`
- Get progress: \`progress-display({ action: "get", taskID: "<task-id>" })\`
- Display progress: \`progress-display({ action: "display", taskID: "<task-id>" })\`

### Log Viewer
Use the \`log-viewer\` tool to record and display logs:
- Record log: \`log-viewer({ action: "log", sessionID: "<session-id>", level: "info", source: "<source>", message: "<message>" })\`
- Get logs: \`log-viewer({ action: "get", sessionID: "<session-id>" })\`
- Filter logs: \`log-viewer({ action: "filter", sessionID: "<session-id>", filters: { level: "error" } })\`

### Confirm Dialog
Use the \`confirm-dialog\` tool for user confirmations:
- Create dialog: \`confirm-dialog({ action: "create", title: "<title>", message: "<message>", options: [...] })\`
- Answer dialog: \`confirm-dialog({ action: "answer", dialogID: "<dialog-id>", answer: "<answer>" })\`
- Check dialog: \`confirm-dialog({ action: "check", dialogID: "<dialog-id>" })\`

### Error Display
Use the \`error-display\` tool for error handling:
- Show error: \`error-display({ action: "show", title: "<title>", message: "<message>", suggestions: [...] })\`
- Get suggestions: \`error-display({ action: "suggest", message: "<error-message>" })\`
- Resolve error: \`error-display({ action: "resolve", errorID: "<error-id>", resolution: "<resolution>" })\`

### UX Workflow
1. At task start, initialize progress display
2. During execution, record logs and update progress
3. For user decisions, show confirm dialogs
4. On errors, display error information with suggestions
5. At completion, show final progress and summary`
      : ""

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

${errorHandlingSection}

${uxSection}

## Structured Output

When all workers complete, produce a final report in this exact format:

\`\`\`
## Orchestration Report: ${args.task}

### Summary
- Status: <completed | partial | failed>
- Workers: <count>
- Duration: <elapsed time>
- Retries: <number of retries>
- Recoveries: <number of recoveries>

### Worker Results
For each worker:
#### <worker-name>
- Status: <completed | partial | failed>
- Files changed: <list of files>
- Tests run: <yes/no> | Results: <pass/fail>
- Errors: <none or description>
- Retry count: <number of retries>
- Recovery attempts: <number of recovery attempts>
- Notes: <any additional context>

### Error Handling Report
- Total errors: <count>
- Retried errors: <count>
- Recovered errors: <count>
- Unrecoverable errors: <count>

### User Experience Report
- Progress updates: <count>
- Log entries: <count>
- Dialogs shown: <count>
- Errors displayed: <count>

### Integration Notes
- <any conflicts, dependencies, or follow-up items>
\`\`\`

If any worker fails, still report results from successful workers and describe the failure.
Include detailed error information and recovery attempts in the report.`

    return {
      title: `Orchestrate: ${args.task}`,
      output: enhancedPrompt,
      metadata: {
        task: args.task,
        timeout,
        workers,
        workerCount: workers.length,
        errorHandling,
        enableUX,
      },
    }
  },
})
