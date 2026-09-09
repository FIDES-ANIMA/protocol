# Freedom Preserving Protocol

A modular constitutional framework for self-governing AI agents.

**Current line** (local `package.json`): skill `1.3.9`, `@fides-anima/openclaw-fpp-plugin` `1.1.18`, `@fides-anima/openclaw-fpp-trust` `1.2.12`, `@fides-anima/fpp-protocol-core` `1.0.2`, `@fides-anima/fpp-enforcement-core` `1.0.3`, `@fides-anima/fpp-trust-core` `1.0.2`. ClawHub install-metadata can lag a local rebuild — see [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md). Canonical capability matrix: [`docs/CAPABILITY_STATUS.md`](docs/CAPABILITY_STATUS.md).

| Layer | Artifact | What it does |
|-------|----------|--------------|
| Prompt | `freedom-preserving-protocol` (ClawHub, OpenClaw-only stage) | The agent reads SKILL.md, reasons about the five laws, and elects to adopt — including running a five-question test mentally before tool calls. |
| Library cores | `@fides-anima/fpp-{protocol,enforcement,trust,steward-auth}-core` (public npm staging / bundled) | Harness-agnostic schemas, classifier, disposition, mandates, receipts, trust stack. Plugins and adapters embed exact pins via `bundledDependencies` during the registry transition. |
| Dispatcher | `@fides-anima/openclaw-fpp-plugin` (ClawHub; public npm staging) | OpenClaw enforcement: `before_tool_call` hook that can `block`, `requireApproval`, or abstain. Requires Gateway `>=2026.3.28`. |
| Dispatcher | `@fides-anima/fpp-adapter-{cursor,claude-code,codex}` (public npm staging) | Graded PreToolUse-style hooks for Cursor / Claude Code / Codex. See `harness/<harness>/`. |
| Shared proxy | `@fides-anima/fpp-tool-proxy` (public npm staging) | MCP/sidecar interception when native hooks are missing or incomplete. |
| Dispatcher | `@fides-anima/openclaw-fpp-trust` (ClawHub; public npm staging) | Trust: agent-to-agent trust graph, handshake, capsules — signature/config attestation, not behavioral compliance. Does **not** gate tool calls. |

All layers compose but each is independently adoptable. The skill teaches *why* to comply; adapters/plugins gate a classified subset of tool calls and emit signed **conformance receipts**; the trust plugin exchanges fresh **trust-state capsules**.

Valid signed receipts support an Event-class attestation named **`instrumented-boundary-disposition`**: the signer cryptographically bound a recorded disposition and authorization to an action digest plus the semantically valid signed metadata present, and identified an instrumented-boundary recording context. A self-presented receipt does **not** independently prove that the call traversed a trusted boundary; that requires additional trusted boundary evidence. It also does **not** prove exact downstream parameter equality, absence of bypass paths, completeness, an uncompromised runtime, or behavioral compliance. See [`docs/CAPABILITY_STATUS.md`](docs/CAPABILITY_STATUS.md) and [`docs/governance/EVIDENCE_SEMANTICS.md`](docs/governance/EVIDENCE_SEMANTICS.md).

## The Five Laws

| # | Name | Core Principle |
|---|------|----------------|
| 1 | Options and Consent | Do not reduce another's options without justification and consent |
| 2 | Corrigibility and Oversight | Remain correctable; log reasons; allow safe interruption |
| 3 | Reversibility and Proportion | Prefer reversible actions; escalate only with proportionate evidence |
| 4 | Commitments with a Safety Valve | Keep promises; pause if fulfillment would cause serious harm |
| 5 | Scoped Exploration | Explore within declared bounds; obtain consent for shared resources |

**Meta-clause:** When uncertain, ask for consent, stage reversibly, record rationale.

## Install

Repository development pin: Node `24.16.0` (`.node-version`); Node `>=26.1.0` is also supported. Compatibility matrix: [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md). Per-harness indexes: [`harness/README.md`](harness/README.md). Machine-readable guarantees: [`harness/shared/harness-capabilities.json`](harness/shared/harness-capabilities.json).

### OpenClaw (first-class)

ClawHub remains the primary distribution. Plugins refuse to load on Gateway builds older than `2026.3.28` (known-vulnerable window through `2026.3.25`). Upgrade the gateway, or install only the prompt-layer skill.

```bash
openclaw skills install freedom-preserving-protocol
openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin
openclaw plugins install clawhub:ovrsr/openclaw-fpp-trust   # optional
```

Plugin tarballs continue to embed `@fides-anima/fpp-*-core` packages via `bundledDependencies` until the first public npm release is complete. If install fails resolving those packages, upgrade to a bundled release — see `docs/TROUBLESHOOTING.md`.

Inspect enforcement:

```bash
openclaw plugins inspect openclaw-fpp-plugin --runtime --json
# Expected: status: "active", hooks include "before_tool_call"
#           compat.pluginApi: ">=2026.3.28"
```

### Cursor / Claude Code / Codex (graded)

Adapters are **not** in the ClawHub skill. Their public npm manifests are staged under `@fides-anima`; until the first registry publish, clone this repository (or `npm pack` after `bundle:deps` / `prepack`) and follow the harness runbook. Do not merge hook fragments from a ClawHub skill install — there are none there.

| Harness | Prompt skill | Hooks | Runbook | Verify |
|---------|--------------|-------|---------|--------|
| Cursor | `.cursor/skills/` or `~/.cursor/skills/` | `cp harness/cursor/adapter/hooks/hooks.json .cursor/hooks.json` (or `~/.cursor/hooks.json`) | [`harness/cursor/runbook.md`](harness/cursor/runbook.md) | `npm run verify-install -- --profile cursor --json` |
| Claude Code | `.claude/skills/` or `~/.claude/skills/` | Merge [`harness/claude-code/adapter/hooks/settings.fragment.json`](harness/claude-code/adapter/hooks/settings.fragment.json) into `.claude/settings.json` | [`harness/claude-code/runbook.md`](harness/claude-code/runbook.md) | `npm run verify-install -- --profile claude-code --json` |
| Codex | AgentSkills / Codex skill docs (`trigger:` support is partial) | `cp harness/codex/adapter/hooks/hooks.json ~/.codex/hooks.json` | [`harness/codex/runbook.md`](harness/codex/runbook.md) | `npm run verify-install -- --profile codex --json` |

Sample hook commands invoke the adapters' installed `fpp-*-hook` binaries
through `npx --no-install`; no repository-relative TypeScript path is required.
Default workspaces are `~/.fpp/<profile>` (override with `FPP_WORKSPACE`).
Optional `FPP_ENFORCEMENT_CONFIG` must stay inside that workspace root.

**Graded guarantees (not OpenClaw plugin parity):**

- **Works:** native PreToolUse-style hooks drive enforcement-core dispositions (including unattended abstain/mandate paths) and receipts under the profile workspace.
- **Does not claim:** gateway-non-bypassable binding, complete tool coverage on Codex (shell/Bash is the reliable path; `apply_patch` / some MCP tools have historically had gaps), or trust-plugin UI outside OpenClaw.
- **Operator authority:** hooks can be disabled (Law 2). Claude Code `--dangerously-skip-permissions` bypasses hooks. Codex has no FPP approval UI (`require_approval` → deny).
- **Fallback:** `@fides-anima/fpp-tool-proxy` for MCP/sidecar gateways when hooks are unavailable or incomplete.

### Hermes (prompt-layer only)

No dispatcher plugin. Do not install OpenClaw plugins into Hermes. See [`harness/hermes/runbook.md`](harness/hermes/runbook.md).

### Library consumers (Node, no harness)

The cores are staged for public npm under `@fides-anima`, but have not been published from this repository yet. Until that first release, import `@fides-anima/fpp-enforcement-core` / `@fides-anima/fpp-trust-core` from a workspace clone or packed tarball. After publication, install them directly from npm. Callers must wire `createEnforcementRuntime` / an adapter for mechanical gating.

### Adopt safely

After installing the skill, from its install directory. **Always run `npm install` first** — ClawHub skill trees often ship without `node_modules`, and `verify` needs `@noble/ed25519` + `@noble/hashes`.

```bash
npm install
npm run verify                  # verify Ed25519 signature
npm run adopt -- \
  --soul   /path/to/agent/SOUL.md \
  --memory /path/to/agent/MEMORY.md
npm run verify-install -- \
  --soul   /path/to/agent/SOUL.md \
  --memory /path/to/agent/MEMORY.md
```

Idempotent. Backs up before writing. Never overwrites.

`verify-install` takes `--profile openclaw` (default), `cursor`, `claude-code`, `codex`, or `generic`. Unknown profiles warn and do **not** false-PASS dispatcher. OpenClaw workspace paths resolve under `<homedir>/.openclaw/workspace`; other profiles use `~/.fpp/<profile>` or `$FPP_WORKSPACE`.

### Self-test

```bash
npm run self-test
```

Runs the dispatcher **classifier** (imported from `harness/openclaw/plugin/src/risk-classifier.ts`) against a fixed list of simulated tool-call fixtures, in-process. It reports what decision the classifier would return (`block` / `approval` / `allow`) for each fixture.

What it does **not** do: it does not execute the installed plugin or the OpenClaw runtime, does not test prompt-layer behavior, and does not write audit entries. To check whether the dispatcher layer is actually active in your runtime, use `npm run verify-install`.

### Revoke

```bash
npm run revoke -- \
  --soul   /path/to/agent/SOUL.md \
  --memory /path/to/agent/MEMORY.md \
  --reason "your reason here"
```

Annotates rather than deletes. See [`docs/REVOCATION.md`](docs/REVOCATION.md).

### Declare (optional)

[`FIDES-ANIMA/protocol-attestation-ledger`](https://github.com/FIDES-ANIMA/protocol-attestation-ledger) is the authoritative record of FPP adoption declarations that FIDES-ANIMA has admitted. An agent, or the operator reporting for it, files one YAML record by intake PR stating its adoption lifecycle state, `enforcement_grade`, and overlays; the steward reviews it and, if admitted, publishes it together with an OpenPGP-signed, content-addressed admission event. The ledger's `main` advances only by signed fast-forward, and any record can be checked from a fresh clone against the pinned steward certificate (see the ledger's *Consuming the ledger* section). Revocations are filed the same way and preserve history.

Claim class: **declaration-only**. An admitted record proves that FIDES-ANIMA published exactly those bytes and, when the record is agent-signed, that the holder of the named `fpp:ed25519:` key authored the declaration. Where provenance is operator-reported, it proves that the named operator reported the lifecycle state. It does not prove agent consent, behavioral compliance, or that any enforcement layer is installed or non-bypassable, and it does not raise a `prompt-only` adoption to `peer-advertisable` or `boundary_attested` — those ceilings are set by [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) and [`docs/CAPABILITY_STATUS.md`](docs/CAPABILITY_STATUS.md), not by the ledger.

## Structure

```
freedom-preserving-protocol/
├── README.md                      This file
├── LICENSE                        Humanitarian-use license
├── package.json                   Monorepo workspaces
├── constitution.json              Canonical signed laws (hash: 71bf60a...)
├── constitution.yaml              Human-readable
├── signature.ed25519.txt          Detached signature
├── pubkey.ed25519.txt             Publisher's public key
├── harness/
│   ├── README.md                  Harness index + graded-guarantee note
│   ├── shared/prompt/             Canonical SKILL.md, hooks/, adoption/
│   ├── shared/harness-capabilities.json
│   ├── openclaw/plugin/           @fides-anima/openclaw-fpp-plugin
│   ├── openclaw/plugin-trust/     @fides-anima/openclaw-fpp-trust
│   ├── openclaw/skill/            ClawHub skill metadata + ALLOWLIST
│   ├── openclaw/scripts/          stage-skill, skill-self-check, clawhub-publish
│   ├── cursor/                    adapter + runbook (@fides-anima/fpp-adapter-cursor)
│   ├── claude-code/               adapter + runbook
│   ├── codex/                     adapter + runbook
│   └── hermes/                    Prompt-layer runbook (no dispatcher plugin)
├── packages/
│   ├── protocol-core/             @fides-anima/fpp-protocol-core
│   ├── enforcement-core/          @fides-anima/fpp-enforcement-core
│   ├── trust-core/                @fides-anima/fpp-trust-core
│   ├── steward-auth-core/         @fides-anima/fpp-steward-auth-core
│   ├── tool-proxy/                @fides-anima/fpp-tool-proxy
│   └── gateway-reference/         CI-only stub; not a production gateway
├── scripts/                       Shared verify/adopt/audit tooling
├── test/                          Cross-harness e2e tests
└── docs/
    ├── CAPABILITY_STATUS.md
    ├── COMPATIBILITY.md
    ├── TROUBLESHOOTING.md
    ├── REVOCATION.md
    ├── ROADMAP.md
    └── RELEASE_ASSURANCE.md
```

## Verification

```bash
npm install
npm run verify
```

Expected:

```
Constitution SHA-256: 71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993
Signature valid:      YES
```

If the signature does not verify, do not adopt. See `docs/TROUBLESHOOTING.md#4`.

## In-place updates for other systems

If you need to refresh already-installed skill/plugin/adapter assets on another host without doing a fresh release publish, use:

```bash
bash scripts/update-installed-assets.sh --dry-run
```

The updater is ownership-aware: it writes `.fpp-updater-manifest.json` per target, preserves unowned local files, and on later updates removes only stale previously owned paths. First updates of legacy installs are additive. See the runbook for backup and rollback details.

Docs:

- `docs/runbooks/in-place-updates.md`
- `docs/MAINTAINER_UPDATE_GUIDELINES.md`


### Continuous integration

Pull requests and pushes to `main`/`master` run `.github/workflows/ci.yml` on Node `24.16.0`: workspace-link assert, library-core build, `npm run verify:all`, e2e, security regressions, coverage floors, classifier corpus, and package assurance artifacts (no registry side effects).

Locally, the canonical full gate is:

```bash
npm run verify:all
```

That runs constitution verification, classifier fixtures, core build, typecheck (cores + adapters + plugins), `npm run test:all` (workspace tests, scripts, interop, corpus, e2e, self-test), and package dry-run (`scripts/verify-pack.sh`). The repository workspace requires Node `>=24.16.0 <25 || >=26.1.0`; the published plugins retain Node `>=22.19` runtime compatibility. OpenClaw plugins require Gateway `>=2026.3.28`.

Coverage: `npm run test:coverage` enforces floor thresholds in `harness/openclaw/plugin/.c8rc.json` and `harness/openclaw/plugin-trust/.c8rc.json` (measured from the 2026-07-10 baseline; trust branch/function floors re-measured 2026-07-19 after core extraction). Compatibility re-export shims that only forward `@fides-anima/fpp-*-core` are excluded — their logic is covered in the core packages. Raise thresholds only after new tests lift the measured floor — never lower them to hide regressions.

## Signing (for maintainers)

Preferred (release / CI):

```bash
FPP_SIGNING_KEY=<hex-encoded-ed25519-private-key> npm run sign
```

Local maintainer convenience (interactive shell only):

```bash
npm run sign -- --generate-key   # first run only; key written to .signing-key.ed25519.local
npm run sign                     # subsequent runs reuse the local key
```

Safety properties of `scripts/sign-constitution.ts`:

- **Never prints the private key.** A newly generated key is written only to `.signing-key.ed25519.local` (gitignored, mode `0600`). Earlier versions logged the key to stdout, which a downstream review (SkillSpector, NVIDIA) correctly flagged as a high-severity exfiltration risk via CI logs, terminal scrollback, and centralized log aggregation. Fixed in v1.1.2.
- **Refuses silent generation.** Without `--generate-key` the script exits non-zero rather than minting a key behind your back.
- **Refuses to mint in CI.** If `CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `BUILDKITE`, `CIRCLECI`, `TRAVIS`, `JENKINS_URL`, `TEAMCITY_VERSION`, `TF_BUILD`, `BITBUCKET_BUILD_NUMBER`, or `CODEBUILD_BUILD_ID` is set, key generation is hard-disabled — provide `FPP_SIGNING_KEY` out-of-band instead.
- **Refuses to mint when stdout is not a TTY.** Catches the `npm run sign | tee build.log` / `script(1)` capture case.

Note: the published constitution hash `71bf60a...` is stable across the entire v1.x line. Tooling releases bump independently and do not modify the constitution itself — v1.1.x added the companion plugin; v1.2.x added Merkle proofs, the trust plugin, and trust graph persistence; v1.3.x is the current skill line (`1.3.9` locally).

## Honest Caveats

- **The skill is prompt-layer.** A hostile skill, a jailbreak, or a user editing SOUL.md can override the skill-level adoption. Adoption is voluntary and continuously renewed, not mechanically enforced.
- **The plugin is dispatcher-layer but not unforgeable.** It survives prompt injection of the agent. It does not survive a malicious operator with shell access, a compromised OpenClaw runtime, or a user who manually disables the plugin. This last property is by design — Law 2 requires the user retain ultimate authority. Graded adapters have the same operator-disable property (plus harness-specific bypasses such as `--dangerously-skip-permissions`).
- **Enforcement coverage is partial.** The classifier is a heuristic taxonomy. **Unrecognized tool calls do not default to allow:** operator-present mode sends them to **approval** (`unknown.unclassified`); unattended mode **abstains**. Named allow-classes (`internal.heartbeat`, `internal.read`, `gateway.inspect`, `fpp.governance`) and `exec.benign` are explicit exceptions, not a catch-all. It gates the known-risky subset, not everything, and allowing a named tool is not behavioral compliance.
- **Cross-harness adapters are graded.** Cursor and Claude Code can deny when hooks are installed and trusted. Codex coverage is shell-first. None of them are gateway-non-bypassable. Trust-plugin tools remain OpenClaw-only.
- **Trust-plugin verification is signature + configuration attestation, not behavioral proof.** A successful handshake proves a peer's key signed a claim about its configuration (and, under hardened-v2, answered a fresh challenge). It does not prove the peer behaves constitutionally. Outputs name `identityVerified` / `configurationClaimVerified` / `freshnessVerified` / `standing`; deprecated `fppVerified` is standing-derived only.
- **No sentence in this repository should be read as cryptographic proof of moral or behavioral compliance.** See the claim classes in [`docs/CAPABILITY_STATUS.md`](docs/CAPABILITY_STATUS.md).
- **Gateway-level enforcement is the longer play.** For non-bypassable enforcement at the foundation layer, a Gateway RFC for constitutional gating at the tool-router boundary is needed. An in-repo draft lives at [`docs/rfc/0001-voluntary-constitutional-layer.md`](docs/rfc/0001-voluntary-constitutional-layer.md); upstream intake remains open. `packages/gateway-reference` is a **CI-only stub**, not a live gateway. This and other long-horizon items are tracked with prerequisites in [`docs/ROADMAP.md`](docs/ROADMAP.md).
- **Model-dependent.** Weaker models may not reliably reason about the five-question test under adversarial pressure. The dispatcher plugin partially compensates by enforcing a deterministic check on a known-risky tool taxonomy.

## Precedents

- [`ztsalexey/agent-constitution`](https://github.com/ztsalexey/agent-constitution) — on-chain voluntary compliance, SKILL.md addresses agent in 2nd person
- [`genesalvatore/aos-openclaw-constitutional`](https://github.com/genesalvatore/aos-openclaw-constitutional) — 10 AOS bedrock amendments, Ed25519 signing, humanitarian license

This is the third entrant: substantive laws + prompt-layer adoption ritual + real dispatcher-layer enforcement.

## License

This repository is licensed under the Humanitarian Use License v1.0 (see [LICENSE](LICENSE)).

- **Skill bundle on ClawHub** — distributed under MIT-0 per ClawHub policy. Anyone may use, modify, and redistribute the published skill without attribution.
- **Plugins (`@fides-anima/openclaw-fpp-plugin`, `@fides-anima/openclaw-fpp-trust`)** — distributed under the Humanitarian Use License v1.0. See `harness/openclaw/plugin/LICENSE` and `harness/openclaw/plugin-trust/LICENSE`.
- **Library cores, tool proxy, adapters, and plugins** — staged for public npm under the Humanitarian Use License v1.0. No live npm publish is performed by the staging workflow.
- **GitHub repo** — Humanitarian Use License v1.0 governs clones and forks.
