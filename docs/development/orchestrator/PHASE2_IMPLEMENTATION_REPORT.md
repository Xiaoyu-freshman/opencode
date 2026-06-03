# Phase 2 Implementation Report: Orchestrate Tool

## Implementation Summary

**Date**: 2026-06-01
**Task**: Implement the orchestrate tool for orchestrator mode
**Status**: Completed

## Architecture Decision

### Plugin Tool Constraint

Plugin tools in OpenCode cannot directly call built-in tools (like `task`) or access internal services (like `Session.Service`). This is by design — plugin tools receive a limited `ToolContext` with only `sessionID`, `messageID`, `agent`, `abort`, `metadata`, `ask`, `directory`, and `worktree`.

### Chosen Approach: Prompt Enhancement + Two-Step Dispatch

The orchestrate tool acts as a **prompt enhancer and validator** that prepares a complete, bus-ready prompt. The orchestrator agent then passes this enhanced prompt to the built-in `task` tool.

**Workflow**:
1. Orchestrator agent calls `orchestrate({ task, prompt, workers?, timeout? })`
2. Orchestrate tool validates inputs and returns enhanced prompt
3. Orchestrator agent calls `task({ subagent_type: "bus", prompt: enhancedPrompt, description: task })`

**Why not direct session creation (Approach A)?**
- Plugin tools cannot access `Session.Service` or `SessionPrompt.Service`
- Plugin tools cannot call other tools programmatically
- HTTP API approach would require knowing the server URL and handling auth

**Why this approach is better than raw `task` calls?**
- Input validation (non-empty task/prompt)
- Automatic worktree isolation instructions
- Worker type specifications
- Timeout configuration
- Structured output format for consistent reports
- Single responsibility: orchestrate handles prompt engineering, task handles execution

## Implementation Content

### 1. Created Orchestrate Tool

**File**: `.opencode/tool/orchestrate.ts`

**Features**:
- Input validation for `task` and `prompt`
- Enhanced prompt generation with:
  - Worktree isolation instructions
  - Worker type specifications (if provided)
  - Timeout configuration
  - Structured output format template
- Returns structured `ToolResult` with `title`, `output`, and `metadata`

**Tool Schema**:
```typescript
{
  task: string           // Short task name
  prompt: string         // Detailed instructions
  workers?: string[]     // Worker types (optional)
  timeout?: number       // Timeout in minutes (default: 30)
}
```

**Output Structure**:
```typescript
{
  title: string          // "Orchestrate: {task}"
  output: string         // Enhanced prompt (passed to task tool)
  metadata: {
    task: string
    timeout: number
    workers: string[]
    workerCount: number
  }
}
```

### 2. Updated Orchestrator Agent

**File**: `.opencode/agent/orchestrator.md`

**Changes**:
- Added `orchestrate: allow` permission
- Updated Phase 3 workflow to use orchestrate tool
- Updated "Creating Implementation Bus Sessions" section with two-step pattern

## Verification Results

### Tool Loading Verification

```bash
$ bun -e "const mod = await import('./.opencode/tool/orchestrate.ts'); console.log(Object.keys(mod));"
[ "default" ]

$ bun -e "const mod = await import('./.opencode/tool/orchestrate.ts'); console.log(typeof mod.default);"
object
```

### Functionality Verification

```bash
# Basic execution
$ bun -e "const mod = await import('./.opencode/tool/orchestrate.ts');
  const r = await mod.default.execute({ task: 'test', prompt: 'Do stuff', workers: ['impl'], timeout: 15 }, {});"
# Result: Title "Orchestrate: test", 1317 chars output, correct metadata

# Empty task validation
$ bun -e "try { await mod.default.execute({ task: '', prompt: 'test' }, {}); } catch(e) { console.log(e.message); }"
# Result: "task must be a non-empty string"

# Empty prompt validation
$ bun -e "try { await mod.default.execute({ task: 'test', prompt: '' }, {}); } catch(e) { console.log(e.message); }"
# Result: "prompt must be a non-empty string"

# No workers (auto-determine)
$ bun -e "const r = await mod.default.execute({ task: 'test', prompt: 'do stuff' }, {});
  console.log(r.output.includes('Determine appropriate'));"
# Result: true
```

### Security Verification

```bash
$ rg -i "token|api.?key|secret|password|credential" .opencode/tool/orchestrate.ts
# No secrets found
```

### Style Compliance

- Uses `const` exclusively (no `let`)
- Uses early returns (no `else`)
- Uses ternary for conditional string building
- Uses functional `.map()` / `.join()` for array formatting
- No unnecessary destructuring
- Inlines logic at call site
- Follows existing tool patterns

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `.opencode/tool/orchestrate.ts` | Created | New orchestrate tool |
| `.opencode/agent/orchestrator.md` | Modified | Added orchestrate permission and usage instructions |
| `docs/development/orchestrator/PHASE2_IMPLEMENTATION_REPORT.md` | Created | This report |

## Acceptance Checklist

### Tool Verification

- [x] `.opencode/tool/orchestrate.ts` file exists
- [x] Tool loads correctly as a module
- [x] Tool args definition is correct (task, prompt, workers, timeout)
- [x] Tool description is clear and accurate

### Functionality Verification

- [x] Validates non-empty task and prompt
- [x] Generates enhanced prompt with worktree instructions
- [x] Includes worker specifications when provided
- [x] Falls back to auto-determine when no workers specified
- [x] Includes timeout configuration
- [x] Includes structured output format template
- [x] Returns correct metadata

### Integration Verification

- [x] Tool follows same pattern as `worktree.ts` and `github-pr-search.ts`
- [x] Orchestrator agent references orchestrate tool
- [x] Orchestrator agent has `orchestrate: allow` permission
- [x] Two-step workflow (orchestrate → task) is documented

### Security Verification

- [x] No secrets, tokens, or API keys in code
- [x] No production data or runtime logs
- [x] Input validation prevents empty prompts

## Known Limitations

1. **Two-step workflow**: The orchestrator agent must call orchestrate, then task separately. This is inherent to the plugin tool architecture.
2. **No direct session management**: The orchestrate tool cannot create sessions, send messages, or monitor execution directly.
3. **No progress tracking**: Progress is reported by the task tool and bus agent, not by orchestrate.

## Future Improvements

### Phase 3 Recommendations

1. **Async task queue**: Implement a task queue tool for parallel execution
2. **Progress aggregation**: Collect progress from multiple bus sessions
3. **State persistence**: Save orchestration state for recovery

### Architecture Enhancement

1. **Internal orchestrate tool**: Create a built-in orchestrate tool (not plugin) that has full access to session services
2. **Event-driven notifications**: Use the bus event system for real-time updates
3. **Batch orchestration**: Support orchestrating multiple tasks in parallel

## Conclusion

Phase 2 implementation is complete. The orchestrate tool provides a clean abstraction layer for preparing bus-ready prompts with:
- Input validation
- Worktree isolation instructions
- Worker specifications
- Timeout configuration
- Structured output format

The tool integrates seamlessly with the existing orchestrator agent and follows the same patterns as other plugin tools. The two-step workflow (orchestrate → task) is a pragmatic solution that works within the plugin tool architecture constraints.
