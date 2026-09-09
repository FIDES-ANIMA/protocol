# Release Assurance

This document describes pre-release package checks for the Freedom Preserving Protocol skill, shared protocol-core package, and plugins.

## Signed release manifests (Plan 6)

Release manifests bind source commit, package hash, lockfile hash, test-corpus hash, constitution hash, dependencies, and supported runtime. They are signed in the **release** signing domain — distinct from constitution-root and agent-identity keys (`docs/governance/KEY_GOVERNANCE.md`).

Verification is **anchored**, not self-consistent (audit F11):

1. The signer must be one of the independently pinned public keys in `assurance-artifacts/release-signing-keys.json`. The `publicKeyPem` embedded in a manifest only selects a pinned key; the signature is checked against the pinned copy. An empty or missing pin file fails closed.
2. Every provenance field — `sourceCommit`, `packageName`, `packageVersion`, `packageHash` (sha256 over the package's git-tracked files), `lockfileHash`, `testCorpusHash`, `supportedRuntime` (`engines.node`), `dependenciesHash` — is recomputed from the current checkout and must match.

```bash
# Generate (dedicated release key; its public half must be pinned first)
npm run release:manifest -- --package harness/openclaw/plugin --key /secure/release-key.pem

# Verify against pinned keys + this checkout (what the publish gate runs)
npm run release:verify -- --manifest assurance-artifacts/release-manifest.json --package harness/openclaw/plugin
```

`--self-attested` / `--no-expectations` exist for local inspection only and print a warning; the publish gate never uses them.

`harness/openclaw/scripts/clawhub-publish.sh` refuses to publish the enforcement plugin unless the manifest passes anchored verification. A missing manifest is a hard failure unless the operator sets `FPP_ALLOW_UNSIGNED_RELEASE=1` (explicit, logged opt-out). Offline root custody, rotation, and revocation prerequisites follow Plan 5 key governance; pinned keys carry optional `validFrom` / `validTo` / `revoked` fields for rotation.

## Canonical commands

| Command | Purpose |
|---------|---------|
| `npm run verify:all` | Constitution, fixtures, typecheck, tests, pack contents |
| `npm run assurance:packages` | Deterministic inventories + CycloneDX SBOMs (no publish) |
| `bash scripts/verify-pack.sh` | Builds cores first, confirms exact core pins, pack contents, and true isolated OpenClaw-flag installs of plugin tarballs alone (no side-loaded core tarballs; cores embedded via `bundledDependencies`) |
| `npm run publish:npm:dry` | Runs npm's public-package prepack and publish validation for all ten packages without publishing |
| `npm run release:manifest` | Compute checkout provenance and sign a release manifest with a dedicated release key |
| `npm run release:verify` | Verify a signed release manifest against pinned keys and the current checkout |

## Release order

1. **Build / test `@fides-anima/fpp-*-core`** — consumers must not pack against a missing `dist/`.
2. **Confirm exact core pins** in consumer `package.json` files (no `^` / `~`; pins must match workspace versions).
3. **Dry-run all public npm packages** with `npm run publish:npm:dry`.
4. **Publish npm packages in dependency order:** protocol-core; steward-auth-core; enforcement-core and trust-core; tool-proxy; adapters; OpenClaw plugins.
5. **Bundle cores into ClawHub consumers** via `bundledDependencies` + `npm run bundle:deps` / `prepack` (`scripts/bundle-workspace-deps.ts`) while registry migration remains in progress.
6. **Pack / publish the ClawHub skill**, then **enforcement plugin**, then **trust plugin** (tarballs must embed `node_modules/@fides-anima/fpp-*`).
7. **Smoke:** `bash scripts/smoke-plugin-install.sh` (OpenClaw-flag isolated install).

Detailed npm operator steps are in [`runbooks/npm-publish.md`](runbooks/npm-publish.md).

`harness/openclaw/scripts/clawhub-publish.sh` refuses to publish if the pack listing lacks bundled core paths.

### Rollback

- Roll back by republishing the previous **plugin** version (which embeds the previous exact core pins).
- Until the first public npm release completes, do not assume installers can fetch `@fides-anima/fpp-*-core` from npmjs.com.
- Workspace development uses npm workspaces (hoisted); published tarballs embed cores via `bundledDependencies`. Public deps (`@noble/*`, `@sinclair/typebox`) still resolve from the registry.

## Package reproducibility

`scripts/package-reproducibility.ts` stages the OpenClaw skill into `harness/openclaw/skill-dist/`, then builds a sorted file inventory with SHA-256 checksums from that flattened tree (not the git monorepo). Plugin and core packages still use `npm pack --dry-run` (or a declared-files fallback). Two inventories can be compared for added/removed/changed paths. Timestamps are not part of the inventory comparison.

```bash
npx tsx scripts/package-reproducibility.ts assurance-artifacts
```

Outputs (gitignored locally; retained as CI artifacts):

- `skill.inventory.json` / `plugin.inventory.json` / `plugin-trust.inventory.json`
- `skill.cdx.json` / `plugin.cdx.json` / `plugin-trust.cdx.json` (CycloneDX 1.5)

## SBOMs

SBOMs list the package itself plus runtime `dependencies` (including the exact `@fides-anima/fpp-protocol-core` pin for plugins). Peer/optional tooling such as `openclaw` is not treated as a shipped runtime dependency of the tarball. DevDependencies are omitted from the distributable SBOM.

## Raising the bar later

Signed release manifests, attestation, and provenance binding are explicitly out of scope here. Do not read an SBOM or inventory as proof of behavioral compliance.

When those controls arrive, they must follow signing-domain separation in
`docs/governance/KEY_GOVERNANCE.md`: release keys are distinct from
constitution-root, agent-identity, runtime-attestation, and amendment keys;
publisher-key revocation remains distinct from adoption revocation.
