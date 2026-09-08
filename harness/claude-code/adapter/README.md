# @fides-anima/fpp-adapter-claude-code

Claude Code `FppRuntimeAdapter` for the Freedom Preserving Protocol.

## Package availability

This adapter is staged for public npm but has not been published from this repository yet. Until the first release, use the workspace or a local packed tarball.

```bash
npm install @fides-anima/fpp-adapter-claude-code@0.1.0
```

## Interception strategy

**Native Claude Code hooks** (`PreToolUse` / `PostToolUse`) via
`.claude/settings.json`. Returns `hookSpecificOutput.permissionDecision`.

Prompt-layer skills continue to work under `.claude/skills/` independently.
The shipped `hooks/settings.fragment.json` invokes the packaged
`fpp-claude-code-hook` CLI through `npx --no-install`.

| Capability | Status |
|------------|--------|
| Pre-tool deny | yes |
| Operator ask | yes (`ask`) when `require_approval` |
| Unattended abstain | yes (default) |
| Bypass risk | `--dangerously-skip-permissions` / disabled hooks |

**Matcher scope:** `hooks/settings.fragment.json` uses `matcher: "*"` intentionally so PreToolUse covers all tools (full enforcement). Narrowing the matcher would leave ungated tools.

**Config:** Optional `FPP_ENFORCEMENT_CONFIG` must point to a JSON file **inside** the Claude Code workspace profile root (`~/.fpp/claude-code` or `$FPP_WORKSPACE`). Paths outside that root are rejected.

See `harness/claude-code/runbook.md`.

## License

See [LICENSE](./LICENSE).
