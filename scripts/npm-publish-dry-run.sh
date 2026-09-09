#!/usr/bin/env bash
set -euo pipefail

# Validate every public npm package in dependency order without publishing.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
REGISTRY="https://registry.npmjs.org/"
PUBLIC_NPM_LAUNCHER="$SCRIPT_DIR/npm-public.mjs"
cd "$ROOT"

packages=(
  "@fides-anima/fpp-protocol-core"
  "@fides-anima/fpp-steward-auth-core"
  "@fides-anima/fpp-enforcement-core"
  "@fides-anima/fpp-trust-core"
  "@fides-anima/fpp-tool-proxy"
  "@fides-anima/fpp-adapter-cursor"
  "@fides-anima/fpp-adapter-claude-code"
  "@fides-anima/fpp-adapter-codex"
  "@fides-anima/openclaw-fpp-plugin"
  "@fides-anima/openclaw-fpp-trust"
)

for package_name in "${packages[@]}"; do
  echo "=== npm publish --dry-run: $package_name ==="
  node "$PUBLIC_NPM_LAUNCHER" publish --dry-run --access public \
    --registry "$REGISTRY" -w "$package_name"
done

echo "All public npm package dry-runs passed; nothing was published."
