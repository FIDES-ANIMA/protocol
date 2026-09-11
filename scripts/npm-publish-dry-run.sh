#!/usr/bin/env bash
set -euo pipefail

# Validate every public npm package in dependency order without publishing.
# Already-published exact versions use pack --dry-run so a partial release
# (and later CI) is not blocked by npm's overwrite check.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
REGISTRY="https://registry.npmjs.org/"
PUBLIC_NPM_LAUNCHER="$SCRIPT_DIR/npm-public.mjs"
cd "$ROOT"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

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

package_dirs=(
  "packages/protocol-core"
  "packages/steward-auth-core"
  "packages/enforcement-core"
  "packages/trust-core"
  "packages/tool-proxy"
  "harness/cursor/adapter"
  "harness/claude-code/adapter"
  "harness/codex/adapter"
  "harness/openclaw/plugin"
  "harness/openclaw/plugin-trust"
)

local_version() {
  local package_name="$1"
  node -e "
    const fs = require('fs');
    const path = require('path');
    const root = process.argv[1];
    const name = process.argv[2];
    const dirs = process.argv.slice(3);
    for (const dir of dirs) {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8'),
      );
      if (manifest.name === name) {
        process.stdout.write(String(manifest.version ?? ''));
        process.exit(0);
      }
    }
    process.exit(2);
  " "$ROOT" "$package_name" "${package_dirs[@]}" \
    || die "Unable to read local version for ${package_name}"
}

registry_has_exact_version() {
  local package_name="$1" version="$2" output status cache_dir
  cache_dir="$(mktemp -d)" || die "Unable to create npm view cache directory"
  set +e
  output="$(
    node "$PUBLIC_NPM_LAUNCHER" view "${package_name}@${version}" version \
      --registry "$REGISTRY" --cache "$cache_dir" --loglevel=error 2>&1
  )"
  status=$?
  set -e
  rm -rf "$cache_dir"
  if [[ $status -eq 0 ]]; then
    output="$(printf '%s' "$output" | tr -d '\r' | awk '
      NF && $0 !~ /^npm / { line = $0 }
      END { print line }
    ')"
    [[ -n "$output" ]] \
      || die "Registry view returned no version for ${package_name}@${version}"
    [[ "$output" == "$version" ]] \
      || die "Registry returned unexpected version for ${package_name}: ${output}"
    return 0
  fi
  if printf '%s' "$output" | grep -Eq 'E404|404 Not Found'; then
    return 1
  fi
  die "Registry query failed for ${package_name}@${version}: ${output}"
}

for package_name in "${packages[@]}"; do
  version="$(local_version "$package_name")"
  [[ -n "$version" ]] || die "${package_name} has no version"
  if registry_has_exact_version "$package_name" "$version"; then
    echo "=== npm pack --dry-run (already published): $package_name@$version ==="
    node "$PUBLIC_NPM_LAUNCHER" pack --dry-run --registry "$REGISTRY" \
      -w "$package_name" \
      || die "Pack dry-run failed for ${package_name}@${version}"
  else
    echo "=== npm publish --dry-run: $package_name ==="
    node "$PUBLIC_NPM_LAUNCHER" publish --dry-run --access public \
      --registry "$REGISTRY" -w "$package_name"
  fi
done

echo "All public npm package dry-runs passed; nothing was published."
