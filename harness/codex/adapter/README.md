# @fides-anima/fpp-adapter-codex

Codex `FppRuntimeAdapter` for the Freedom Preserving Protocol.

## Package availability

This adapter is staged for public npm but has not been published from this repository yet. Until the first release, use the workspace or a local packed tarball.

```bash
npm install @fides-anima/fpp-adapter-codex@0.1.0
```

## Interception strategy

**Native Codex hooks** (`PreToolUse` / `PostToolUse`) via `~/.codex/hooks.json`.
The shipped `hooks/hooks.json` invokes the packaged `fpp-codex-hook` CLI
through `npx --no-install`.

### Graded guarantees

- Shell/Bash PreToolUse: reliable deny path
- `apply_patch` / some MCP tools: historically incomplete coverage — do not claim parity
- Skill `trigger:` frontmatter: partial on some Codex runtimes
- No FPP operator approval UI → `dispositionMode: "unattended"` forced; `require_approval` → deny

See `harness/shared/harness-capabilities.json` and `harness/codex/runbook.md`.

**Matcher:** Codex hooks use `matcher: "Bash"` (graded shell coverage — not full tool parity).

**Config:** Optional `FPP_ENFORCEMENT_CONFIG` must stay under the Codex workspace profile root (`~/.fpp/codex` or `$FPP_WORKSPACE`).

## License

See [LICENSE](./LICENSE).
