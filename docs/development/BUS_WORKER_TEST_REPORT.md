# Bus-Worker Architecture Test Report

## Test Environment

- **Date**: 2026-06-01
- **Branch**: dev (f1e7a1896)
- **Tester**: Bus agent (automated + manual verification)

## Test Results Summary

| Task | Status | Notes |
|------|--------|-------|
| 1.1 Agent Configuration Verification | PASS | All 4 agent configs valid |
| 1.2 Worktree Tool Testing | PASS | All operations work correctly |
| 1.3 Permission Boundary Verification | PASS | All permissions match spec |
| 2.1 Simple Task Execution | PASS | Bus can execute tasks directly |
| 2.2 Worker Invocation | PASS | Worker can create files in worktree |
| 2.3 Full Workflow | PASS | End-to-end flow works |
| 3.1 Invalid Task Handling | PASS | Errors handled correctly |
| 3.2 Permission Violation | PASS | Access denied as expected |
| 3.3 Cancel Operation | PASS | Cleanup works correctly |

## Issues Found and Fixed

### Issue 1: Worktree tool uses process.cwd() instead of context.directory

- **Severity**: High
- **File**: `.opencode/tool/worktree.ts`
- **Problem**: `worktreeBase()` and `projectName()` called `process.cwd()` directly. At tool execution time, `process.cwd()` returns the OpenCode startup directory (e.g., `/Users/tom`), not the project directory.
- **Impact**: Worktree tool calculated wrong paths and git commands ran in wrong directory.
- **Fix**:
  - Refactored `worktreeBase(cwd)`, `projectName(cwd)`, `worktreePath(task, cwd)` to accept `cwd` parameter
  - Changed `execute(args)` to `execute(args, context)`, using `context.directory`
  - Added `cwd` parameter to `runCommand()` and `detectDefaultBranch()`, passed to `execSync`
- **Commits**: `e316233f4`, `b5e112e84`

### Issue 2: Worker agents cannot access worktree paths

- **Severity**: High
- **File**: `.opencode/tool/worktree.ts`, `packages/opencode/src/tool/task.ts`, `packages/opencode/src/session/session.ts`
- **Problem**: Worktrees were created at `../_worktrees/` (outside project directory). Worker agents have `external_directory: deny`, so `containsPath()` returned false for worktree paths.
- **Root cause**: `InstanceRef` is project-level, not session-level. Setting `directory` in `sessions.create()` only stores it in the session record — it doesn't change the Worker's runtime `InstanceContext`.
- **Initial approach (Option B)**: Pass `worktree` to `sessions.create()` to override Worker's `directory`. This didn't work because `InstanceRef` is not per-session.
- **Final approach (Option A)**: Create worktrees inside project directory at `.worktrees/`. This ensures worktree paths are within `InstanceContext.directory`, so `containsPath()` returns true.
- **Fix**:
  - Changed `worktreeBase()` to return `path.join(cwd, ".worktrees")`
  - Added `path` import
  - `.worktrees` already in `.gitignore`
- **Commit**: `f1e7a1896`

### Issue 3: task.ts and session.ts worktree parameter (retained for future use)

- **Severity**: Low (not blocking)
- **Files**: `packages/opencode/src/tool/task.ts`, `packages/opencode/src/session/session.ts`
- **Problem**: No way to pass worktree path to subagent sessions.
- **Fix**: Added optional `worktree` parameter to `BaseParameterFields` and `sessions.create()`. Currently unused (Option A doesn't need it), but retained for future use if per-session `InstanceContext` is implemented.
- **Commit**: `e316233f4`

## Detailed Test Results

### Task 1.1: Agent Configuration Verification

**Bus Agent** (`bus.md`):
- Mode: `primary` ✓
- Has all required permissions (task, todowrite, question, read, bash, edit, glob, grep, worktree) ✓
- Description present ✓

**Implementation Worker** (`bus-worker-implementation.md`):
- Mode: `subagent` ✓
- Can: read, glob, grep, list, edit, write ✓
- Cannot: task, bash, external_directory ✓
- Description present ✓

**Diagnostic Worker** (`bus-worker-diagnostic.md`):
- Mode: `subagent` ✓
- Can: read, glob, grep, list, bash ✓
- Cannot: task, edit, external_directory ✓
- Description present ✓

**Full Worker** (`bus-worker-full.md`):
- Mode: `subagent` ✓
- Can: read, glob, grep, list, edit, bash ✓
- Cannot: task, external_directory ✓
- Description present ✓

### Task 1.2: Worktree Tool Testing

| Operation | Result | Notes |
|-----------|--------|-------|
| Create | PASS | Creates worktree at `.worktrees/<project>-<task>` |
| List | PASS | Shows all worktrees with branch info |
| Status | PASS | Shows git status and diff stats |
| Remove (clean) | PASS | Removes worktree and branch |
| Remove (dirty, no force) | PASS | Correctly refuses with error |
| Remove (dirty, force) | PASS | Force removes worktree |
| Naming convention | PASS | Follows `codex/<task>-YYYYMMDD` pattern |
| Path convention | PASS | Uses `.worktrees/` inside project directory |

### Task 1.3: Permission Boundary Verification

**Implementation Worker**:
- Read files: ALLOW ✓
- Edit files: ALLOW ✓
- Write new files: ALLOW ✓
- Run bash: DENY ✓
- Use task tool: DENY ✓
- Access external_directory: DENY ✓

**Diagnostic Worker**:
- Read files: ALLOW ✓
- Edit files: DENY ✓
- Run bash: ALLOW ✓
- Use task tool: DENY ✓
- Access external_directory: DENY ✓

**Full Worker**:
- Read files: ALLOW ✓
- Edit files: ALLOW ✓
- Run bash: ALLOW ✓
- Use task tool: DENY ✓
- Access external_directory: DENY ✓

### Task 2.1: Simple Task Execution

- Bus agent created file `bus-test-simple.txt` directly ✓
- File content verified ✓
- File cleaned up ✓

### Task 2.2: Worker Invocation

- Worktree created at `.worktrees/opencode-verify-fix` ✓
- Implementation Worker called with `task()` tool ✓
- Worker created `test.txt` with content "fix verified" ✓
- File content verified by Bus ✓
- Worktree cleaned up ✓

### Task 2.3: Full Workflow

End-to-end flow verified:
1. Bus creates worktree ✓
2. Worker creates file in worktree ✓
3. Bus verifies Worker output (git status, git diff, file content) ✓
4. Bus commits changes ✓
5. Bus merges to dev ✓
6. Bus cleans up worktree ✓

### Task 3.1: Invalid Task Handling

- Create worktree with invalid path: Git error returned ✓
- System continues to function after error ✓

### Task 3.2: Permission Violation

- Worker with `external_directory: deny` cannot access paths outside project ✓
- Error message is clear and actionable ✓

### Task 3.3: Cancel Operation

- Create worktree then immediately remove: Success ✓
- No residual files or branches ✓

## Test Suite Results

```
test/session/session.test.ts        — 4 pass, 0 fail
test/tool/task.test.ts              — 15 pass, 0 fail
test/tool/external-directory.test.ts — 5 pass, 0 fail

Total: 24 pass, 0 fail
```

## Architecture Insights

### InstanceRef is project-level, not session-level

The key discovery during testing: `InstanceRef` (which provides `InstanceContext`) is set per-project when the project is bootstrapped, not per-session. When a Worker is spawned via `sessions.create()`, it inherits the parent's `InstanceRef`. Setting `directory` in the session record only stores metadata — it doesn't change the Worker's runtime context.

This means Option B (pass worktree path to override Worker's `InstanceContext`) doesn't work as expected. The correct approach is Option A (create worktrees inside the project directory so they're within `InstanceContext.directory`).

### worktree parameter retained for future use

The `worktree` parameter added to `task.ts` and `session.ts` is currently unused but retained. If `InstanceRef` is ever made per-session in the future, this parameter would enable Option B.

## Remaining Items

| Item | Priority | Status |
|------|----------|--------|
| Desktop GUI interaction tests | Low | Pending (needs manual testing) |

## Conclusion

All automated tests pass. The Bus-Worker architecture is functional and ready for use. Three issues were discovered and fixed during testing. The most significant finding was that `InstanceRef` is project-level, which required changing the worktree creation strategy from `../_worktrees/` to `.worktrees/` inside the project directory.

---

## Commit History

| Commit | Description |
|--------|-------------|
| `e316233f4` | fix(bus-worker): use context.directory in worktree tool and pass worktree to subagent sessions |
| `b5e112e84` | fix(worktree): pass cwd to runCommand and detectDefaultBranch |
| `f1e7a1896` | fix(worktree): create worktrees inside project directory (.worktrees/) |
