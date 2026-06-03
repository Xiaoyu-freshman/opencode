# Phase B Orchestrator SOP

Phase B productizes the Orchestrator workflow so the user talks to Orchestrator only. Orchestrator classifies the task, chooses the lightest safe execution path, and dispatches Bus/Worker execution only when coordination or isolation is useful.

## Workflow

```text
User -> Orchestrator -> Bus -> Worker
```

- **User**: States the goal and confirms high-risk actions.
- **Orchestrator**: Classifies tier, owns product and architecture decisions, confirms risky work, prepares Bus prompts with `orchestrate`, and reports final results.
- **Bus**: Executes the confirmed policy, bounds scope, creates worktrees for implementation tasks, dispatches workers, verifies output, and reports back to Orchestrator.
- **Worker**: Performs a bounded diagnostic, implementation, or review task in the assigned scope.

## Task Tiers

| Tier | Criteria | Examples | Execution Path |
| --- | --- | --- | --- |
| S | Low risk, read-only or direct guidance, no meaningful blast radius | Explain a file, answer a usage question, inspect status | Orchestrator answers directly or provides light guidance. No Bus unless needed. |
| M | Contained code/config/doc change or bounded diagnostic | Fix a small test, update one doc, inspect one failure | Concise plan, brief confirmation before modifying code/config unless already confirmed, usually one Bus worker. |
| L | Multi-file feature, architecture-sensitive fix, migration, user-visible behavior change | Implement a package feature, refactor a subsystem, debug a cross-package failure | Solution analysis, user confirmation, Bus/Worker execution, verification, quality report. |
| XL | High-risk or broad-blast-radius work | Architecture redesign, broad refactor, release, data migration | Full architecture, diagnostic, implementation, and review flow with explicit rollback and validation. |

Use the highest tier indicated by blast radius, reversibility, ambiguity, package count, validation complexity, production impact, secrets, global config, data, releases, or destructive operations.

Any task that modifies code, configuration, dependencies, tests, documentation, generated assets, git state, global state, or user-visible behavior is at least **M tier**, even if it touches only one file. Reserve **S tier** for direct answers, narrow guidance, and read-only lookup or diagnostics.

## Confirmation Rules

Always confirm before:

- Major architecture changes
- Commits, pushes, releases, or publish steps
- Global config changes
- Destructive operations
- Broad refactors
- Data migrations or security-sensitive work

Confirmation may be optional or automatic for low-risk read-only diagnostics, direct answers, and implementation already confirmed by the user. Confirmations should state what will change, scope, validation, and rollback when relevant.

## Execution Paths

### Direct Path

Use for S tasks. Orchestrator answers, inspects, or guides without Bus.

### Light Bus Path

Use for most M tasks. Orchestrator sends one bounded diagnostic or implementation prompt through `orchestrate`, then `task({ subagent_type: "bus" })`.

### Full Bus Path

Use for L tasks. Orchestrator provides solution analysis and confirmation, then dispatches Bus with scope, tier, worker selection, acceptance criteria, validation commands, and report requirements.

### XL Path

Use for high-risk tasks. Orchestrator confirms architecture, rollback, and validation. Bus coordinates diagnostic, implementation, and review workers, verifies all output, and reports residual risks.

Worker selection guidance:

- **Diagnostic**: Reproduction, logs, root cause, read-only investigation.
- **Implementation**: Bounded code/config/docs changes.
- **Full**: Diagnostic plus implementation plus review/verification.

## Health And Global Safety

- Use the `orchestrator-health` OpenCode tool for global Orchestrator health checks.
- Custom tools are OpenCode tools, not shell commands. Do not ask users to run `orchestrator-health` in a terminal.
- Avoid Bun runtime assumptions in global custom tools unless the tool is explicitly executed by Bun.
- Sanitize prompts before dispatching workers. Exclude secrets, credentials, tokens, private keys, `.env` contents, and sensitive customer data.
- Use worktrees for implementation tasks unless Orchestrator explicitly chooses a read-only or already-isolated path.

## Reporting Templates

### Success

```text
Status: Success
Tier: <S|M|L|XL>
Files Changed: <paths>
Validation: <commands and results>
Quality: <scope, risks, maintainability>
Next Steps: <optional>
```

### Partial

```text
Status: Partial
Completed: <what is done>
Blocked: <what remains and why>
Validation: <commands and results>
Decision Needed: <user or Orchestrator choice>
```

### Failure

```text
Status: Failure
Failure Point: <where it failed>
Likely Cause: <classification>
Recovery Attempted: <retry or rollback>
Safe Next Options: <choices>
```

## Failure And Recovery

Classify failures as environment, dependency, permissions, test regression, merge/scope conflict, or ambiguous requirement. Retry transient failures once with narrower scope or clearer prompts. Ask the user when recovery requires credentials, destructive actions, product decisions, or expanded scope.

## Known Limitations

- Parallelism is soft and depends on OpenCode task execution behavior.
- There is no system scheduler yet for durable background orchestration.
- Bus and workers rely on prompt discipline for scope control; Orchestrator must provide clear boundaries and validation.
