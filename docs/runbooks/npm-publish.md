# Public npm publishing runbook

This runbook validates and, with two explicit authorization gates, publishes
the ten public packages under the `@fides-anima` npm scope.

## Verified package names

The names and versions come from these package manifests:

- [`packages/protocol-core/package.json`](../../packages/protocol-core/package.json)
- [`packages/steward-auth-core/package.json`](../../packages/steward-auth-core/package.json)
- [`packages/enforcement-core/package.json`](../../packages/enforcement-core/package.json)
- [`packages/trust-core/package.json`](../../packages/trust-core/package.json)
- [`packages/tool-proxy/package.json`](../../packages/tool-proxy/package.json)
- [`harness/cursor/adapter/package.json`](../../harness/cursor/adapter/package.json)
- [`harness/claude-code/adapter/package.json`](../../harness/claude-code/adapter/package.json)
- [`harness/codex/adapter/package.json`](../../harness/codex/adapter/package.json)
- [`harness/openclaw/plugin/package.json`](../../harness/openclaw/plugin/package.json)
- [`harness/openclaw/plugin-trust/package.json`](../../harness/openclaw/plugin-trust/package.json)

The root [`package.json`](../../package.json), the ClawHub skill manifest, and `@fides-anima/fpp-gateway-reference` remain private.

## Registry and access preflight

These read-only queries were run on 2026-09-08:

```bash
npm whoami
# fa-steward

npm org ls fides-anima
# fa-steward - owner

for package_name in \
  @fides-anima/fpp-protocol-core \
  @fides-anima/fpp-steward-auth-core \
  @fides-anima/fpp-enforcement-core \
  @fides-anima/fpp-trust-core \
  @fides-anima/fpp-tool-proxy \
  @fides-anima/fpp-adapter-cursor \
  @fides-anima/fpp-adapter-claude-code \
  @fides-anima/fpp-adapter-codex \
  @fides-anima/openclaw-fpp-plugin \
  @fides-anima/openclaw-fpp-trust
do
  npm view "$package_name" version
done
# All ten returned E404: none has been published
```

The staging host is authenticated as an organization owner, and all ten target names were checked. Before a later live release, rerun these checks and require the same identity and organization access. For an initial release, every name must return E404; for later releases, compare every returned version with its local manifest. Missing access or an unexpected existing version is a release blocker.

## Clean install and verification

Run from the repository root with Node `>=24.16.0 <25` or `>=26.1.0` (`.node-version` pins `24.16.0`):

```bash
npm ci
npm run verify:all
npm run publish:npm:dry
```

`publish:npm:dry` invokes `npm publish --dry-run --access public` for every unpublished exact version, in dependency order. If that exact version is already on the registry, it runs `npm pack --dry-run` instead so a partial or completed release does not fail npm's overwrite check. Both paths run the package's `prepack`, validate the tarball listing, and never upload a release.

The order is:

1. `@fides-anima/fpp-protocol-core`
2. `@fides-anima/fpp-steward-auth-core`
3. `@fides-anima/fpp-enforcement-core`, then `@fides-anima/fpp-trust-core`
4. `@fides-anima/fpp-tool-proxy`
5. `@fides-anima/fpp-adapter-cursor`, `@fides-anima/fpp-adapter-claude-code`, then `@fides-anima/fpp-adapter-codex`
6. `@fides-anima/openclaw-fpp-plugin`, then `@fides-anima/openclaw-fpp-trust`

For an individual package:

```bash
npm pack --dry-run --json -w @fides-anima/fpp-protocol-core
npm publish --dry-run --access public -w @fides-anima/fpp-protocol-core
```

Inspect the output for `dist/index.js`, `dist/index.d.ts`, `README.md`,
`LICENSE`, `constitution.json`, `constitution.yaml`, and `SKILL.md`. The three
constitutional files must match their canonical repository copies. Source tests
and `test-helpers.ts` must not be listed.

## ClawHub transition

Keep `bundledDependencies` until the first npm release is complete. ClawHub packages are still owned by `ovrsr`, so existing installs continue to use:

```bash
openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin
openclaw plugins install clawhub:ovrsr/openclaw-fpp-trust
```

The npm scope migration does not rename the OpenClaw plugin ids. The ClawHub
publisher therefore keeps `--name @ovrsr/openclaw-fpp-plugin` and
`--name @ovrsr/openclaw-fpp-trust`, independently of the `@fides-anima` npm
manifest names. Do not run a ClawHub publish as part of npm staging.

## Release handoff

The guarded publisher derives names and versions from the manifests listed
above. It requires a clean Git tree, the verified `fa-steward` identity,
`fides-anima` owner access, the configured and explicit
`https://registry.npmjs.org/` registry, `npm ci`, the full verification gate,
and dry-runs of every public package. Exact versions that already exist are a
release blocker unless `--resume` is used.

Store the granular npm token in the ignored repository-root `.env`:

```dotenv
NPM_TOKEN=npm_replace_with_the_granular_token
```

The token needs read/write access to the `fides-anima` scope and **Bypass 2FA**
enabled when the account does not use publishing 2FA. Limit it to the required
packages/scope, choose the shortest practical expiration, and revoke it after
the release. The script reads only `NPM_TOKEN`, sends it over stdin to the npm
launcher, and injects it only into authenticated npm commands. `npm ci`,
verify:all, dry-run, and pack use a token-free npm config. Registry existence
checks use the token with a fresh npm cache so a cached preflight 404 cannot
hide a version that `npm publish` already accepted. Live publish disables
lifecycle scripts. No temporary token file or token-bearing command argument is
created. Do not commit `.env`.

After committing the release changes, run the non-publishing preflight:

```bash
npm run publish:npm -- --preflight-only
```

With explicit release authorization, run:

```bash
FPP_NPM_PUBLISH=YES npm run publish:npm -- --confirm-live
```

If a registry or network failure interrupts a partial release, inspect the npm
registry first, then resume:

```bash
FPP_NPM_PUBLISH=YES npm run publish:npm -- --confirm-live --resume
```

`--resume` does not rerun `npm ci`, `verify:all`, or `publish:npm:dry`. It still
requires a clean Git tree, the `fa-steward` identity, organization owner access,
and matching registry integrity for versions that already exist. It then
publishes missing versions in dependency order. Live `--package <name>`
recovery skips the same verification gate. Use `--preflight-only` when you
want the full gate without publishing.

Registry existence checks use a fresh npm cache so a preflight 404 cannot hide
a version that `npm publish` already accepted. If `npm view` still lags after a
successful publish, the script warns and continues instead of aborting the
remaining packages. Never use `--force`; bump any conflicting version. It does
not publish or modify ClawHub packages.
