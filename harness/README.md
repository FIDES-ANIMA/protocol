# Harness integrations

Runtime-facing Freedom Preserving Protocol artifacts, grouped by harness.

| Directory | Harness | What lives here |
|-----------|---------|-----------------|
| [`openclaw/`](openclaw/) | OpenClaw | Enforcement plugin, trust plugin, ClawHub skill packaging |
| [`cursor/`](cursor/) | Cursor | Hook adapter + operator runbook |
| [`claude-code/`](claude-code/) | Claude Code | Hook adapter + operator runbook |
| [`codex/`](codex/) | Codex | Hook adapter + operator runbook |
| [`hermes/`](hermes/) | Hermes | Prompt-layer runbook (no dispatcher plugin) |
| [`shared/`](shared/) | All | Canonical prompt-layer source + capability matrix |

Shared protocol cores stay in `packages/`. Authorization aliases such as `harness/openclaw.json` are logical grant strings, not files in this tree.

Machine-readable matrix: [`shared/harness-capabilities.json`](shared/harness-capabilities.json).

## Graded guarantees

Adapters do **not** claim OpenClaw parity where the harness cannot provide it.
See `docs/COMPATIBILITY.md` and each harness `runbook.md`.

Shared MCP/sidecar proxy: `@fides-anima/fpp-tool-proxy` (`packages/tool-proxy`).
