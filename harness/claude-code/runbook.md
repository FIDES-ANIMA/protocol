# Runbook: Claude Code adapter

Graded dispatcher path for Claude Code via `PreToolUse` / `PostToolUse` hooks.
Prompt-layer skills already work under `.claude/skills/`. Operator can disable
hooks or use `--dangerously-skip-permissions`.

## Prerequisites

- Node `>=22.19`
- Clone of this repository **or** a packed adapter tarball after `bundle:deps` / `prepack`; `@fides-anima/fpp-adapter-claude-code` is staged for public npm but has not completed its first publish
- Claude Code with hooks configured in `.claude/settings.json` or `~/.claude/settings.json`

## Install prompt layer

```bash
# Project
cp -r . .claude/skills/freedom-preserving-protocol
# or user: ~/.claude/skills/freedom-preserving-protocol
```

## Enable adapter hooks

Merge `harness/claude-code/adapter/hooks/settings.fragment.json` (or
`node_modules/@fides-anima/fpp-adapter-claude-code/hooks/settings.fragment.json`
after package installation) into your Claude settings `hooks` block. The
sample command:

```text
npx --no-install fpp-claude-code-hook
```

Default workspace profile: `claude-code` → `~/.fpp/claude-code`.

## Adopt

```bash
npm run adopt -- --soul path/to/SOUL.md --memory path/to/MEMORY.md
```

## Verify

```bash
npm run verify-install -- --profile claude-code --json
```

Expected: `runtime.probe.claude-code` status `pass` / probe `active` when
`harness/claude-code/adapter/package.json` is present in the checkout.

```bash
npm run self-test
```

## Known gaps

| Gap | Notes |
|-----|-------|
| `--dangerously-skip-permissions` | Bypasses hooks — do not use for governed agents |
| Not OpenClaw plugin parity | No ClawHub tool registration / trust plugin UI |
| Hook trust | Claude may require reviewing new hook commands |

## Related

- Adapter: `harness/claude-code/adapter/`
- Matrix: `harness/shared/harness-capabilities.json`
- Compatibility: `docs/COMPATIBILITY.md`
