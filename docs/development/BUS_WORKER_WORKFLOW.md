# Bus-Worker Workflow Guide

Status: 2026-05-27.

## Step-by-Step Workflow

### 1. Receive Task

The user gives the Bus a task. The Bus should:

- Clarify scope if ambiguous
- Identify which modules or files are affected
- Determine if the task is suitable for a worker (bounded, clear ownership)

**Good worker tasks:**
- Narrow implementation slices with clear entry points
- Documentation updates after scope is fixed
- Mechanical refactors or repeated edits
- Focused test additions

**Bad worker tasks (do directly):**
- Broad architecture decisions
- Final release or signing operations
- Work involving secrets or credentials
- Unbounded refactors

### 2. Prepare the Worktree

Create an isolated worktree:

```
worktree.create({ task: "short-descriptive-name", base: "main" })
```

This creates:
- Branch: `codex/short-descriptive-name-YYYYMMDD`
- Worktree: `../_worktrees/<project>-short-descriptive-name`

### 3. Write the Worker Prompt

Fill in the prompt template for the chosen worker mode. The prompt must include:

1. **Worktree path** — absolute path the worker should `cd` into mentally
2. **Base commit** — the commit hash the worktree starts from
3. **Files to read first** — entry files the worker should understand before editing
4. **Pinned implementation anchors** — exact files, functions, classes to modify
5. **In-scope rules** — what the worker should do
6. **Out-of-scope rules** — what the worker must NOT touch
7. **Planned write set** — files the worker is expected to modify
8. **Acceptance commands** — commands for the Bus to run afterward (NOT for the worker)
9. **Feedback format** — how the worker should structure its response

### 4. Spawn the Worker

```
task({
  subagent_type: "bus-worker-implementation",  // or diagnostic, full
  prompt: "<filled-in prompt>",
  description: "Short task description"
})
```

For foreground workers (default), the Bus waits for the result.
For background workers, the Bus continues and gets notified on completion.

### 5. Review Worker Output

When the worker returns:

1. **Inspect the diff:**
   ```
   bash: git -C <worktree> diff --stat
   bash: git -C <worktree> diff
   ```

2. **Check scope compliance:**
   - Are only the planned files modified?
   - Did the worker touch out-of-scope files?

3. **Check for secrets:**
   ```
   bash: git -C <worktree> diff | grep -i "password\|secret\|token\|api_key"
   ```

4. **Run acceptance commands:**
   - Run all commands the worker listed as acceptance commands
   - Run any additional commands from the original task requirements
   - NEVER trust the worker's claim that tests passed

### 6. Decide

Based on the review:

- **Acceptable:** Commit the changes and proceed to cleanup
- **Needs correction:** Send a narrower correction prompt to a new worker
- **Abandon:** Clean up the worktree and handle the task directly

### 7. Commit and Clean Up

If accepted:

```
bash: git -C <worktree> add -A
bash: git -C <worktree> commit -m "type(scope): description"
bash: git -C <worktree> push origin codex/<task>-YYYYMMDD
```

Then clean up:

```
worktree.remove({ branch: "codex/<task>-YYYYMMDD" })
```

## Prompt Templates

### Implementation Worker Prompt Template

```markdown
## Task: <task title>

### Worktree
- Path: <absolute worktree path>
- Branch: codex/<task>-YYYYMMDD
- Base commit: <commit hash>

### Required Reading
Read these files first:
- <file 1> — <why>
- <file 2> — <why>

### Implementation Anchors
Modify these specific locations:
- `<file>:<line>` — <function/class name> — <what to change>
- `<file>:<line>` — <function/class name> — <what to change>

### Nearby Conventions
Follow the patterns in:
- <file> — <convention to follow>

### In Scope
- <specific change 1>
- <specific change 2>

### Out of Scope
- Do NOT modify <file/module>
- Do NOT touch <specific area>
- Do NOT run any commands (you do not have bash access)

### Planned Write Set
Files you are expected to modify:
- <file 1>
- <file 2>

### Known Conflict Points
- <file> is shared with <other task> — be careful with <specific lines>

### Acceptance Commands (for Bus to run, NOT for you)
- `bun run test -- --filter <test>`
- `bun run lint`
- `bun run typecheck`

### Feedback Format
Report:
1. Changed files
2. What was changed and why
3. Risks or blockers
4. Recommended acceptance commands for the Bus
```

### Diagnostic Worker Prompt Template

```markdown
## Investigation: <question>

### Worktree
- Path: <absolute worktree path>
- Branch: codex/<task>-YYYYMMDD

### Question
<Specific question to answer>

### Files to Inspect
- <file 1> — <what to look for>
- <file 2> — <what to look for>

### Scope
- Read-only investigation
- Do NOT modify any files
- Use bash for read-only commands only (grep, find, cat, git log, git diff)

### Output Format
Report:
1. Files inspected (with paths)
2. Key findings with file:line references
3. Entry points identified
4. Recommended implementation approach
5. Risks or blockers
```

### Full Worker Prompt Template

```markdown
## Task: <task title>

### Worktree
- Path: <absolute worktree path>
- Branch: codex/<task>-YYYYMMDD
- Base commit: <commit hash>

### Required Reading
- <file 1> — <why>
- <file 2> — <why>

### Implementation Anchors
- `<file>:<line>` — <what to change>

### In Scope
- <specific change>

### Out of Scope
- Do NOT modify <file/module>
- Do NOT perform destructive git operations

### Planned Write Set
- <file 1>

### Commands to Run
You may run these commands:
- `bun run test -- --filter <test>`
- `bun run lint`
- `bun run typecheck`

### Feedback Format
Report:
1. Changed files
2. Commands run and their actual output
3. Risks or blockers
4. Recommended acceptance commands for the Bus to verify
```

## Tips for Effective Bus Prompts

### Be Specific About Anchors

Bad: "Find where customer lookup is handled and update it"
Good: "Modify `_build_lookup_customer_response` in `src/api/customer.ts:45`"

### Separate Discovery from Implementation

If entry points are unclear:
1. First spawn a **diagnostic** worker to find them
2. Then spawn an **implementation** worker with the specific anchors

### Keep Scope Tight

One worker = one bounded task. If a task touches 10+ files, consider splitting
it into multiple worker tasks.

### Always Include Out-of-Scope Rules

Explicitly list what the worker must NOT touch. This prevents scope drift.

### Never Trust Worker Verification

The worker cannot run tests in implementation mode. Even in full mode, the Bus
must re-run acceptance commands. Worker-reported test results are advisory.
