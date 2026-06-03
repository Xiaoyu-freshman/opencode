# Phase A Global Orchestrator Usage

## Install Or Update

Run from the repository root:

```sh
bun script/install-orchestrator-global.ts
```

The script copies the Orchestrator agent, Bus/Worker agents, and required tools from `.opencode` into `~/.config/opencode`. Existing managed files are backed up under `~/.config/opencode/backups/orchestrator-*` before overwrite.

It also ensures `@opencode-ai/plugin` is installed in `~/.config/opencode` using a release package version, never `local`, and runs Bun install with scripts disabled.

## Health Check

After install, restart OpenCode/Desktop and run the `orchestrator-health` OpenCode custom tool, not a shell command. It validates required global files, checks the config-local `@opencode-ai/plugin` package, dynamically imports required tools, and smoke-executes selected tools with unique IDs.

The tool returns a human-readable report plus metadata containing `ok`, `configDir`, `summary`, and per-check details.

## Rollback

Run from the repository root:

```sh
bun script/install-orchestrator-global.ts --rollback
```

Rollback restores the latest backup and removes only Orchestrator-managed files that did not exist before that backup.

## Caveat

OpenCode and Desktop load global agents/tools at startup. Restart after install, update, or rollback.
