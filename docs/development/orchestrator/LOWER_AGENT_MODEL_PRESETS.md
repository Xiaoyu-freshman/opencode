# Lower-Agent Model Presets

## Purpose

Orchestrator should stay on the premium reasoning model, while the lower execution agents can be switched as a group.

Default target agents:

- `bus`
- `bus-worker-diagnostic`
- `bus-worker-implementation`
- `bus-worker-full`

The top-level `orchestrator` agent is reported for reference but is not modified by the preset flow.

## Default Scope

The preset tool modifies the global OpenCode config by default:

```text
~/.config/opencode/agent/
```

This makes the Bus/Worker preset apply across projects. Use a project-local preset only when explicitly requested:

```text
orchestrator-model-preset({ action: "apply", scope: "project", model: "provider/model" })
```

## Model Discovery

`orchestrator-model-preset` discovers model IDs from:

- Global and project agent files: `agent/*.md` and `agents/*.md`
- Global and project `opencode.json` / `opencode.jsonc`
- Direct `model` and `small_model` config fields
- Custom provider declarations in `provider.<providerKey>.models.<modelKey>`

Custom provider model IDs use the provider object key, not the provider display name.

Example:

```jsonc
{
  "provider": {
    "mimo": {
      "name": "xiaomi",
      "models": {
        "mimo-v2.5-pro": {
          "name": "mimo-v2.5-pro"
        }
      }
    }
  }
}
```

The valid model ID is:

```text
mimo/mimo-v2.5-pro
```

Not:

```text
xiaomo/mimo-v2.5-pro
```

## Typical Orchestrator Conversation Flow

1. User asks to view or change the Bus/Worker preset.
2. Orchestrator calls:

   ```text
   orchestrator-model-preset({ action: "list" })
   ```

3. Orchestrator presents discovered models and optionally accepts a custom `provider/model` ID.
4. User chooses the lower-agent model.
5. Orchestrator applies the global preset by default:

   ```text
   orchestrator-model-preset({
     action: "apply",
     scope: "global",
     model: "mimo/mimo-v2.5-pro"
   })
   ```

6. User restarts OpenCode/Desktop.

Agent config is loaded at startup and is not hot-reloaded, so a restart is required after every preset change.

## Current Expected Shape

The intended layered configuration is:

```text
Orchestrator: openai/gpt-5.5
Bus/Workers: configurable lower-agent preset
```

The compatibility default is:

```text
openai/gpt-5.4-mini
```

Codex-only or account-restricted model IDs should not be made the default unless the active account supports them and the user or Orchestrator explicitly chooses that path.

## Global Install Behavior

The source Orchestrator agent files keep the compatibility default (`openai/gpt-5.4-mini`) for lower agents so the repo works across accounts.

When `script/install-orchestrator-global.ts` updates an existing global installation, it preserves the existing global lower-agent `model:` values for the four Bus/Worker agents. This prevents a reinstall from accidentally resetting a user's chosen global preset.

For a first-time global install, the source compatibility default is used until the user changes the preset.

## Validation

Useful validation commands from `packages/opencode`:

```text
bun test test/tool/orchestrator-model-preset.test.ts
bun typecheck
```

Global installation health can be checked with the OpenCode tool:

```text
orchestrator-health({ configDir: "~/.config/opencode", smoke: true })
```
