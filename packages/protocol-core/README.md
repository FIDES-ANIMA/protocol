# @fides-anima/fpp-protocol-core

Shared versioned schemas and cryptographic contracts for the Freedom Preserving Protocol.

Package version and protocol schema version are independent. This package (`1.0.2`) carries **schema version 2**.

## Install

This package is staged for public npm but has not been published from this repository yet. Until the first release, use the workspace or a local packed tarball.

```bash
npm install @fides-anima/fpp-protocol-core@1.0.2
```

Published plugins pin an **exact** core version to prevent silent protocol drift.

## Workspace profiles

Path defaults are resolved via `resolveWorkspaceRoot` / `workspaceFile`:

| Profile | Root |
|---------|------|
| `openclaw` (default) | `<homedir>/.openclaw/workspace` (absolute) |
| `generic` | `$FPP_WORKSPACE` or `~/.fpp` |

`FPP_WORKSPACE` overrides the root for any profile when set.

This package is developed via npm workspaces from the repository root. Local consumers (`plugin/`, `plugin-trust/`) resolve the workspace package while published manifests keep the exact version pin.

```bash
npm run build -w @fides-anima/fpp-protocol-core
npm test -w @fides-anima/fpp-protocol-core
```

### Lockfile migration

Nested plugin lockfiles were removed when workspaces were introduced. The single root `package-lock.json` is the source of truth for local development. Plugin tarballs declare an exact `@fides-anima/fpp-protocol-core` version and continue to bundle it during the first-registry-release transition.

## License

See [LICENSE](./LICENSE).
