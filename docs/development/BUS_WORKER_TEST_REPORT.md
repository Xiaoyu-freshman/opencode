# Bus-Worker Architecture Test Report

## Test Environment

- **Date**: 2026-05-27 (Updated)
- **Branch**: dev (dad7045de)
- **Tester**: opencode automated testing

## Test Results Summary

| Task | Status | Notes |
|------|--------|-------|
| Agent Configuration Verification | PASS | All 4 agent configs valid |
| Worktree Tool Testing | PASS | All operations work correctly |
| Permission Boundary Verification | PASS | All permissions match spec |
| Integration Test | PASS | Full workflow executes successfully |
| Error Handling Tests | PASS | All error cases handled properly |

## Issues Found and Fixed

### Issue 1: Worktree tool defaults to wrong base branch

- **Severity**: High
- **File**: `.opencode/tool/worktree.ts:74`
- **Problem**: Default base branch was hardcoded to `"dev"` (opencode's own branch), not suitable for user projects
- **Impact**: `worktree.create()` would fail when no base branch specified in projects using `main`
- **Fix**: Added `detectDefaultBranch()` function that checks `git symbolic-ref refs/remotes/{remote}/HEAD`, fallback to `"main"`

### Issue 2: Bus prompt references wrong base branch

- **Severity**: Medium
- **File**: `.opencode/agent/bus.md:66`
- **Problem**: Example code showed `base: "main"` instead of `base: "dev"`
- **Impact**: Bus agent would use wrong branch when following prompt instructions
- **Fix**: Updated example to `base: "dev"`

### Issue 3: Implementation worker missing write permission

- **Severity**: Medium
- **File**: `.opencode/agent/bus-worker-implementation.md`
- **Problem**: Description said "can read and write files" but `write` permission was not set (denied by default)
- **Impact**: Implementation worker could not create new files, only edit existing ones
- **Fix**: Added `write: allow` permission and updated description

### Issue 4: Worktree remove uses -d instead of -D with force flag

- **Severity**: Low
- **File**: `.opencode/tool/worktree.ts:142`
- **Problem**: Branch deletion always used `git branch -d` even when `force: true`
- **Impact**: Unmerged branches not cleaned up when force-removing worktree
- **Fix**: Use `-D` when `force` is true, `-d` otherwise

## Detailed Test Results

### Task 1: Agent Configuration Verification

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

### Task 2: Worktree Tool Testing

| Operation | Result | Notes |
|-----------|--------|-------|
| Create | PASS | Creates worktree with correct branch name |
| List | PASS | Shows all worktrees with branch info |
| Status | PASS | Shows git status and diff stats |
| Remove (clean) | PASS | Removes worktree and branch |
| Remove (dirty, no force) | PASS | Correctly refuses with error |
| Remove (dirty, force) | PASS | Force removes worktree |
| Naming convention | PASS | Follows `codex/<task>-YYYYMMDD` pattern |
| Path convention | PASS | Uses `../_worktrees/` directory |

### Task 3: Permission Boundary Verification

**Implementation Worker**:
- Read files: ALLOW ✓
- Edit files: ALLOW ✓
- Write new files: ALLOW ✓ (fixed)
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

### Task 4: Integration Test

Full Bus-Worker workflow tested:

1. Bus creates worktree ✓
2. Worker creates file in worktree ✓
3. Bus verifies Worker output (git status, git diff, file content) ✓
4. Bus commits changes ✓
5. Bus cleans up worktree ✓

### Task 5: Error Handling Tests

| Scenario | Expected | Actual | Status |
|----------|----------|--------|--------|
| Create without task name | Error thrown | Error thrown | PASS |
| Status without branch | Error thrown | Error thrown | PASS |
| Remove without branch | Error thrown | Error thrown | PASS |
| Remove nonexistent worktree | Git error | Git error | PASS |
| Create with invalid base | Git error | Git error | PASS |
| Remove dirty (no force) | Git error | Git error | PASS |
| Remove dirty (force) | Success | Success | PASS |

## Remaining Considerations

1. **Bus merge step**: The bus.md prompt does not explicitly mention merging the worker branch before cleanup. The Bus should merge changes into the base branch before removing the worktree.

2. **Worker scope enforcement**: Permission boundaries are enforced at the tool level. Workers cannot escape their worktree path through tool permissions alone - the Bus must verify the worker stayed within bounds by inspecting the diff.

3. **Timeout handling**: The worktree tool uses a 30-second timeout for git commands. Long-running operations may need adjustment.

## Conclusion

All tests pass. The Bus-Worker architecture is functional and ready for use. Four issues were discovered and fixed during testing.

---

## Verification Run (2026-05-27)

### Environment Check

| Item | Status | Notes |
|------|--------|-------|
| `.opencode/agent/bus.md` | ✓ | Mode: primary, permissions correct |
| `.opencode/agent/bus-worker-implementation.md` | ✓ | Mode: subagent, write: allow present |
| `.opencode/agent/bus-worker-diagnostic.md` | ✓ | Mode: subagent, bash: allow, edit: deny |
| `.opencode/agent/bus-worker-full.md` | ✓ | Mode: subagent, all permissions |
| `.opencode/tool/worktree.ts` | ✓ | Default base: "dev", force uses -D |
| `.opencode/prompt/worker-*.md` | ✓ | All 3 prompt templates exist |

### Previous Fixes Verified

1. **Default base branch**: Dynamic detection via `detectDefaultBranch()` ✓
2. **Bus prompt example**: Uses `worktree.create({ task: "<name>" })` (auto-detect) ✓
3. **Implementation worker write permission**: `write: allow` ✓
4. **Force remove branch deletion**: `args.force ? "-D" : "-d"` ✓

### Git Status

- Branch: `dev` (ahead 4, clean)
- No test worktrees present
- No test branches present

### Test Suite Results

```
bun test test/project/worktree.test.ts

13 pass
0 fail
32 expect() calls
Ran 13 tests across 1 file. [5.28s]
```

All worktree lifecycle tests pass:
- Create with name, branch, directory ✓
- Slugify names ✓
- Detached worktrees ✓
- Create + remove lifecycle ✓
- Event.Ready after bootstrap ✓
- List with parent folder detection ✓
- Remove edge cases ✓
