# @fides-anima/fpp-adapter-cursor

Cursor `FppRuntimeAdapter` for the Freedom Preserving Protocol.

## Package availability

This adapter is staged for public npm but has not been published from this repository yet. Until the first release, use the workspace or a local packed tarball.

```bash
npm install @fides-anima/fpp-adapter-cursor@0.1.0
```

## Interception strategy

**Native Cursor hooks** (`preToolUse` / `beforeMCPExecution`), not an invented
extension API. The sample hook config runs the packaged
`fpp-cursor-hook` CLI.

| Capability | Status |
|------------|--------|
| Pre-tool deny | yes — via hook `permissionDecision: "deny"` |
| Operator ask | yes — `permissionDecision: "ask"` when disposition is `require_approval` |
| Unattended abstain | yes — default `dispositionMode: "unattended"` |
| Non-bypassable gateway | no — operator can disable hooks (Plan 12) |

See `harness/shared/harness-capabilities.json` and `harness/cursor/runbook.md`.

## Workspace

Default profile: `cursor` → `~/.fpp/cursor` (override with `FPP_WORKSPACE`).

Optional `FPP_ENFORCEMENT_CONFIG` must point to a JSON file **inside** that workspace root; paths outside are rejected.

## Install (hooks)

Copy [`hooks/hooks.json`](./hooks/hooks.json) into `.cursor/hooks.json` (project)
or `~/.cursor/hooks.json` (user). It invokes
`npx --no-install fpp-cursor-hook`.

## License

See [LICENSE](./LICENSE).
