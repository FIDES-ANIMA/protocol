# OpenClaw

OpenClaw dispatcher plugins and ClawHub skill packaging.

| Path | Package / artifact |
|------|-------------------|
| [`plugin/`](plugin/) | `@fides-anima/openclaw-fpp-plugin` — `before_tool_call` enforcement |
| [`plugin-trust/`](plugin-trust/) | `@fides-anima/openclaw-fpp-trust` — trust graph and handshake |
| [`skill/`](skill/) | ClawHub skill metadata and allowlist |
| [`scripts/`](scripts/) | Stage + publish helpers |
| Prompt source | [`../shared/prompt/`](../shared/prompt/) |

Install (ClawHub):

```bash
openclaw skills install freedom-preserving-protocol
openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin
openclaw plugins install clawhub:ovrsr/openclaw-fpp-trust
```

## Publishing

Never publish the monorepo root as a skill. Stage a flat tree, then publish that.

| Surface | Path |
|---------|------|
| Publish script | `harness/openclaw/scripts/clawhub-publish.sh` |
| Stage skill | `harness/openclaw/scripts/stage-skill.ts` |
| Skill self-check | `harness/openclaw/scripts/skill-self-check.ts` |
| Allowlist | `harness/openclaw/skill/ALLOWLIST` |
| Staged skill root | `harness/openclaw/skill-dist/` (generated, gitignored, **flat**) |
| Enforcement plugin | `harness/openclaw/plugin/` |
| Trust plugin | `harness/openclaw/plugin-trust/` |

```bash
npm run publish:status
npm run publish:skill -- --changelog "…"
npm run publish:plugin -- --changelog "…"
npm run publish:trust -- --changelog "…"
```

`npx tsx harness/openclaw/scripts/skill-self-check.ts --root .` validates `harness/openclaw/skill-dist/` — it must not pass just because the root package declares workspaces. Cores are not published; plugin tarballs embed them via `bundledDependencies`.

Capability matrix: [`../shared/harness-capabilities.json`](../shared/harness-capabilities.json).
