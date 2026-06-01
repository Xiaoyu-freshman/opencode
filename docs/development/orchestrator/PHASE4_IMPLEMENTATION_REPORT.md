# Phase 4 Implementation Report: Error Handling and Recovery

## Summary

Implemented comprehensive error handling and recovery mechanisms for the orchestrator system, including error classification, automatic retry with exponential backoff, task recovery, and error notification.

## Implementation Details

### Created Files

- `.opencode/tool/error-handler.ts` - Error handling and recovery tool

### Modified Files

- `.opencode/tool/orchestrate.ts` - Integrated error handling configuration

### Features Implemented

#### 1. Error Classification

Implemented automatic error classification into three categories:

**Execution Errors:**
- `worker_failed` - Worker execution failed (retryable, recoverable)
- `timeout` - Task timeout (retryable, recoverable)
- `permission_denied` - Permission denied (not retryable, not recoverable)
- `resource_not_found` - Resource not found (not retryable, not recoverable)
- `conflict` - Conflict (retryable, recoverable)

**System Errors:**
- `session_creation_failed` - Session creation failed (retryable, recoverable)
- `message_send_failed` - Message send failed (retryable, recoverable)
- `state_save_failed` - State save failed (retryable, recoverable)
- `network_error` - Network error (retryable, recoverable)
- `api_error` - API error (retryable, recoverable)

**User Errors:**
- `invalid_prompt` - Invalid prompt (not retryable, not recoverable)
- `invalid_task` - Invalid task (not retryable, not recoverable)
- `cancelled` - User cancelled (not retryable, not recoverable)

#### 2. Automatic Retry Mechanism

Implemented configurable retry with exponential backoff:

```typescript
interface RetryConfig {
  maxRetries: number        // Default: 3
  retryDelay: number        // Default: 1000ms
  backoffMultiplier: number // Default: 2
  retryableErrors: string[] // List of retryable error types
}
```

**Retry Behavior:**
- Automatic retry for retryable errors
- Exponential backoff: delay = retryDelay * (backoffMultiplier ^ attempt)
- Configurable maximum retry attempts
- Only retries errors in the retryableErrors list

#### 3. Task Recovery Mechanism

Implemented three recovery actions:

**Retry:**
- Reset task to pending state
- Clear error and progress
- Re-execute from beginning

**Resume:**
- Update task status to running
- Continue from last checkpoint (requires checkpoint implementation)

**Restart:**
- Reset task completely
- Clear all state (result, error, progress)
- Re-execute from beginning

#### 4. Error Notification

Implemented error notification with:
- Task state update with error metadata
- Console error output with detailed information
- Suggestions for retryable/recoverable errors

#### 5. Orchestrate Tool Integration

Enhanced the orchestrate tool with error handling configuration:

```typescript
interface ErrorHandlingConfig {
  maxRetries: number
  retryDelay: number
  backoffMultiplier: number
  retryableErrors: string[]
  autoRecover: boolean
  recoverableStatuses: string[]
  recoveryAction: "retry" | "resume" | "restart"
}
```

**New Features in Orchestrate:**
- Error handling configuration parameter
- Error handling instructions in generated prompts
- Recovery workflow documentation
- Error reporting in structured output

### Tool API

#### error-handler Tool

**Actions:**
- `classify` - Classify an error message
- `retry` - Reset a task for retry
- `recover` - Recover a failed task
- `notify` - Send error notification
- `execute-with-retry` - Execute a function with retry logic

**Parameters:**
- `taskID` - Task ID (required for retry, recover, notify)
- `error` - Error message (required for classify, notify)
- `errorType` - Error type (optional)
- `retryConfig` - Retry configuration (optional)
- `recoveryConfig` - Recovery configuration (optional)
- `fn` - Function to execute with retry (required for execute-with-retry)

### Exported Utilities

The error-handler tool exports utility functions for use by other tools:

```typescript
export {
  classifyError,
  executeWithRetry,
  notifyError,
  recoverTask,
  retryTask,
  resumeTask,
  restartTask,
  sleep,
  type ErrorInfo,
  type RetryConfig,
  type RecoveryConfig,
  defaultRetryConfig,
  defaultRecoveryConfig,
}
```

## Verification

### Functional Testing

**Error Classification Tests:**
- ✓ Worker failed error classification
- ✓ Timeout error classification
- ✓ Permission denied error classification
- ✓ Network error classification
- ✓ API error classification
- ✓ Cancelled error classification
- ✓ Unknown error classification

**Retry Mechanism Tests:**
- ✓ Exponential backoff calculation
- ✓ Max retries limit
- ✓ Retryable error filtering
- ✓ Non-retryable error handling

**Recovery Mechanism Tests:**
- ✓ Task retry action
- ✓ Task resume action
- ✓ Task restart action
- ✓ Recovery status validation

### Integration Testing

- ✓ Error handler tool loads correctly
- ✓ Orchestrate tool integrates error handling
- ✓ Error configuration passes to generated prompts

## Acceptance Criteria

- [x] `.opencode/tool/error-handler.ts` file exists
- [x] Tool can be loaded
- [x] Tool parameters are correctly defined
- [x] Tool description is clear
- [x] Can classify errors correctly
- [x] Can retry tasks automatically
- [x] Can recover failed tasks
- [x] Can notify errors
- [x] Integrates with orchestrate tool
- [x] Error handling configuration works

## Design Decisions

### 1. Error Classification Strategy

Used keyword-based classification for simplicity and extensibility. The classification checks for specific keywords in error messages to determine error type and category.

### 2. Retry Configuration

Default configuration includes:
- 3 maximum retries
- 1 second initial delay
- 2x backoff multiplier
- Common retryable errors pre-configured

### 3. Recovery Actions

Implemented three recovery actions to cover different scenarios:
- `retry` - For transient failures
- `resume` - For interrupted tasks (requires checkpoint support)
- `restart` - For complete failures

### 4. Integration Approach

Integrated error handling into the orchestrate tool by:
- Adding error handling configuration parameter
- Including error handling instructions in generated prompts
- Documenting error types and recovery actions

## Known Limitations

1. **Checkpoint Support**: The `resume` recovery action requires checkpoint implementation, which is not yet fully implemented.

2. **Persistent Retry State**: Retry state is not persisted across process restarts. If the process crashes during retry, the retry count is lost.

3. **Concurrent Recovery**: Multiple recovery attempts on the same task may cause conflicts.

4. **Error Classification Accuracy**: Keyword-based classification may produce false positives for complex error messages.

## Future Improvements

1. **Checkpoint Implementation**: Implement checkpoint mechanism for true resume capability.

2. **Persistent Retry State**: Store retry state in task metadata for persistence.

3. **Machine Learning Classification**: Use ML models for more accurate error classification.

4. **Custom Error Handlers**: Allow users to define custom error handling rules.

5. **Error Analytics**: Collect and analyze error patterns for system improvement.

## Commit

```
feat(tool): add error-handler tool for error handling and recovery

- Implement error classification for execution, system, and user errors
- Add automatic retry with exponential backoff
- Implement task recovery mechanisms (retry, resume, restart)
- Add error notification with detailed information
- Integrate error handling into orchestrate tool
- Export utility functions for other tools
```

## Next Steps

1. Implement checkpoint mechanism for resume capability
2. Add persistent retry state storage
3. Create error analytics dashboard
4. Add custom error handling rules
5. Improve error classification accuracy
