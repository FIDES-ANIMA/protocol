# Contributing to the Freedom-Preserving Protocol

Contributing is separate from adopting. You can fix a test, tighten a classifier
rule, correct a document, or report a reproducible incompatibility without
installing hooks into your own agent, running `adopt`, filing a ledger
declaration, or agreeing with the project's governance aims. Human-authored,
agent-authored, and AI-assisted contributions are all reviewed on the same terms:
what changed, why, and what evidence shows it works.

If you want to *evaluate or integrate* FPP rather than contribute to it, start
instead with [`docs/CAPABILITY_STATUS.md`](docs/CAPABILITY_STATUS.md) and the
runbook for your harness under [`harness/`](harness/README.md), and test in a
disposable environment before changing a live agent.

## Before you start

- Read [`AGENTS.md`](AGENTS.md). It is short and states the working boundaries
  that apply to every contributor, including coding agents.
- Check open issues and pull requests at
  [FIDES-ANIMA/protocol](https://github.com/FIDES-ANIMA/protocol) before
  duplicating work. Issues labelled `good first issue` are genuinely bounded;
  `design-needed` means a maintainer decision is still outstanding and a PR is
  premature.
- Treat [`docs/CAPABILITY_STATUS.md`](docs/CAPABILITY_STATUS.md) as the
  authority on what is implemented. If code, tests, or another document disagree
  with it, that disagreement is itself a reportable bug.
- [`MASTER_CONTEXT.md`](MASTER_CONTEXT.md) is optional historical and strategic
  reading. You do not need it to fix a test.

## Setup

Use the Node version in [`.node-version`](.node-version) (Node `>=26.1.0` is also
supported). Install from the repository root only; running `npm ci` inside a
workspace package rewrites the install tree and breaks workspace links.

```sh
npm ci
npm run build:core
```

`build:core` compiles the library cores that the plugins, adapters, and the
classifier self-test import from `dist/`. A clean checkout that skips it fails
in unrelated-looking places.

## Focused checks

Run the tests for the workspace you changed rather than the whole gate on every
iteration:

| You changed | Run |
|-------------|-----|
| `packages/protocol-core/` | `npm run test -w @fides-anima/fpp-protocol-core` |
| `packages/enforcement-core/` (classifier, disposition, receipts) | `npm run test -w @fides-anima/fpp-enforcement-core` |
| `packages/trust-core/` | `npm run test -w @fides-anima/fpp-trust-core` |
| `packages/steward-auth-core/` | `npm run test -w @fides-anima/fpp-steward-auth-core` |
| `packages/tool-proxy/` | `npm run test -w @fides-anima/fpp-tool-proxy` |
| `harness/openclaw/plugin/` | `npm run test -w @fides-anima/openclaw-fpp-plugin` |
| `harness/openclaw/plugin-trust/` | `npm run test -w @fides-anima/openclaw-fpp-trust` |
| `harness/cursor/adapter/`, `harness/claude-code/adapter/`, `harness/codex/adapter/` | `npm run test -w @fides-anima/fpp-adapter-<harness>` |
| `scripts/` | `npm run test:scripts` |
| classifier fixtures or corpus | `npm run self-test` and `npm run test:corpus` |
| cross-harness behaviour | `npm run test:e2e` |

Before opening a pull request that touches code, run the full local gate once:

```sh
npm run verify:all
```

It runs constitution verification, the core build, the classifier self-test,
typecheck, `npm run test:all`, and the package dry-run. CI
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) additionally enforces
coverage floors, security regression suites, and assurance artifacts. For a
documentation-only change, check the links and commands you touched; you do not
need to run the release workflow.

## What a good pull request contains

- **One coherent change** with a stated purpose. Split unrelated fixes.
- **A regression test for every behaviour change.** A classifier change needs a
  fixture that fails before and passes after; a disposition change needs an
  enforcement-core test; a harness change needs the adapter or e2e test that
  exercises the hook path.
- **The exact commands you ran and their results.** Say which checks you could
  not run (for example, no OpenClaw gateway available) rather than implying
  coverage you do not have. A passing fixture test is not evidence of live
  runtime enforcement; do not describe it that way.
- **Honest labels.** Do not change an evidence label, capability status, or
  caveat to make a document read better. If the implementation improved, update
  `docs/CAPABILITY_STATUS.md` in the same PR with the source evidence the matrix
  requires.
- **No weakened gates.** Do not lower a coverage threshold, delete a failing
  assertion, or widen an allowlist to get green. If a gate is wrong, say so in
  the PR and let a maintainer decide.

## Review-sensitive areas

Changes here are welcome but receive focused review and may be held for a
maintainer decision:

- `constitution.json`, `constitution.yaml`, `signature.ed25519.txt`,
  `pubkey.ed25519.txt`: the signed constitution. Its hash is stable across the
  v1.x line and is never edited for wording. Use only temporary test keys in
  development; never ask for or use production signing material.
- Classifier policy (`packages/enforcement-core/src/risk-classifier.ts` and its
  fixtures): a change to what is allowed, approved, or blocked is a policy
  change. State the threat or false-positive it addresses and the fixture that
  proves it; adding patterns is not a security fix by itself.
- Publishing and release configuration (`scripts/npm-*`,
  `harness/openclaw/scripts/`, `assurance-artifacts/`): no live publish is
  performed from CI, and contributors are not expected to publish anything.
- Governance documents under `docs/governance/`: changes to authority,
  consent, or evidence semantics need the matching test
  (`docs/governance/EVIDENCE_SEMANTICS.test.ts`) and cross-references updated.

## What contributing does not do

Opening a PR does not make anyone a steward, does not adopt the protocol on the
contributor's behalf, does not authorize installing hooks or plugins anywhere,
and does not file or alter anything in the
[attestation ledger](https://github.com/FIDES-ANIMA/protocol-attestation-ledger).
Reviewers will not read participation as endorsement, and declining to continue
needs no justification.

## Reporting problems

Open an issue with the command you ran, the output, the Node and harness
versions, and what you expected. Reproducible negative results (an adapter that
does not gate a call it is documented to gate, a fixture whose classification
disagrees with the README) are among the most useful contributions this project
can receive. For a suspected security problem in enforcement, prefer a private
report to `contact@fides-anima.org` over a public issue until it is triaged.

## License

The repository is under the Humanitarian Use License v1.0 ([`LICENSE`](LICENSE));
the ClawHub skill bundle is distributed under MIT-0 per ClawHub policy. By
contributing you agree that your contribution is licensed under the terms that
apply to the files you change. Do not relicense files or add license headers
without a maintainer decision.
