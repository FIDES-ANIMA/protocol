# Public npm package staging

**Status:** IMPLEMENTED — staged only; no package published

**Created:** 2026-09-08

## Scope

Prepare the reusable FPP libraries, harness adapters, and OpenClaw plugins for public npm distribution under `@fides-anima`.

In scope:

- Rename active package identities and imports from `@ovrsr` to `@fides-anima`.
- Make four cores, tool-proxy, three adapters, and two OpenClaw plugins public-packable.
- Preserve the private root skill workspace, private ClawHub skill manifest, and private gateway reference stub.
- Keep exact dependency pins and bundled workspace dependencies through the first registry release.
- Add package-contract checks, public npm dry-runs, and an operator runbook.

Out of scope:

- Live npm or ClawHub publishing.
- Changing OpenClaw plugin ids.
- Rewriting completed historical plans.
- Removing bundled dependencies before the public core packages exist.

## Package order

1. `@fides-anima/fpp-protocol-core`
2. `@fides-anima/fpp-steward-auth-core`
3. `@fides-anima/fpp-enforcement-core`
4. `@fides-anima/fpp-trust-core`
5. `@fides-anima/fpp-tool-proxy`
6. `@fides-anima/fpp-adapter-cursor`
7. `@fides-anima/fpp-adapter-claude-code`
8. `@fides-anima/fpp-adapter-codex`
9. `@fides-anima/openclaw-fpp-plugin`
10. `@fides-anima/openclaw-fpp-trust`

## Acceptance gates

- Every publishable manifest sets `publishConfig.access` to `public`, includes the Humanitarian Use License, and omits `private: true`.
- Package tarballs contain built entry points, declarations, README, and LICENSE but exclude source tests and test helpers.
- Runtime imports, test expectations, workspace scripts, and exact dependency pins use `@fides-anima`.
- Existing ClawHub install coordinates remain `clawhub:ovrsr/...`.
- `npm run verify:all` and `npm run publish:npm:dry` pass.
- No live registry write occurs.

Operator procedure: [`docs/runbooks/npm-publish.md`](../runbooks/npm-publish.md).
