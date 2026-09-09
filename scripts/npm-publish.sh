#!/usr/bin/env bash
set -euo pipefail

# Guarded live publisher for the ten public npm packages.
# This script never publishes unless both --confirm-live and
# FPP_NPM_PUBLISH=YES are supplied.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
REGISTRY="https://registry.npmjs.org/"
cd "$ROOT"

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

expected_names=(
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

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Guarded live npm publisher for @fides-anima packages.

Usage:
  npm run publish:npm -- --preflight-only
  FPP_NPM_PUBLISH=YES npm run publish:npm -- --confirm-live
  FPP_NPM_PUBLISH=YES npm run publish:npm -- --confirm-live --package <name>

Options:
  --preflight-only  Run all checks without publishing.
  --confirm-live    Authorize the live npm publish phase.
  --package <name>  Publish or preflight one package for partial-run recovery.
  --help            Show this help.

The live mode requires a clean Git tree, the verified fa-steward npm identity,
owner access to the fides-anima organization, successful verify:all and npm
publish dry-runs, and exact-version registry checks.
USAGE
}

mode=""
selected_name=""
package_selected="false"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --preflight-only)
      [[ -z "$mode" ]] || die "Choose only one mode"
      mode="preflight"
      ;;
    --confirm-live)
      [[ -z "$mode" ]] || die "Choose only one mode"
      mode="live"
      ;;
    --package)
      [[ $# -ge 2 ]] || die "--package requires a package name"
      [[ -n "$2" ]] || die "--package requires a non-empty package name"
      selected_name="$2"
      package_selected="true"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
  shift
done

[[ -n "$mode" ]] || {
  usage >&2
  die "No mode selected"
}
if [[ "$mode" == "live" && "${FPP_NPM_PUBLISH:-}" != "YES" ]]; then
  die "Live publish requires FPP_NPM_PUBLISH=YES"
fi

require_clean_tree() {
  git diff --quiet -- || die "Working tree has unstaged changes"
  git diff --cached --quiet -- || die "Working tree has staged changes"
  [[ -z "$(git ls-files --others --exclude-standard)" ]] \
    || die "Working tree has untracked files"
}

manifest_field() {
  local package_dir="$1" expression="$2"
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const value = ${expression};
    process.stdout.write(value === undefined ? '' : String(value));
  " "$package_dir/package.json"
}

internal_dependencies() {
  local package_dir="$1"
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    for (const [name, version] of Object.entries(p.dependencies ?? {})) {
      if (name.startsWith('@fides-anima/')) {
        process.stdout.write(name + '\\t' + version + '\\n');
      }
    }
  " "$package_dir/package.json"
}

registry_observed=""
registry_exact_version() {
  local package_name="$1" version="$2" output status
  registry_observed=""
  set +e
  output="$(npm view "${package_name}@${version}" version --registry "$REGISTRY" 2>&1)"
  status=$?
  set -e
  if [[ $status -eq 0 ]]; then
    registry_observed="$output"
    return 0
  fi
  if printf '%s' "$output" | grep -Eq 'E404|404 Not Found'; then
    return 1
  fi
  die "Registry query failed for ${package_name}@${version}: ${output}"
}

verify_published_version() {
  local package_name="$1" version="$2"
  for _ in 1 2 3 4 5; do
    if registry_exact_version "$package_name" "$version"; then
      [[ "$registry_observed" == "$version" ]] \
        || die "Registry returned unexpected version for ${package_name}: ${registry_observed}"
      return 0
    fi
    sleep 2
  done
  die "Published version did not become visible: ${package_name}@${version}"
}

require_internal_dependencies_published() {
  local package_dir="$1" dependency_name dependency_version
  while IFS=$'\t' read -r dependency_name dependency_version; do
    [[ -n "$dependency_name" ]] || continue
    [[ "$dependency_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-].*)?$ ]] \
      || die "${package_dir} has non-exact internal dependency ${dependency_name}@${dependency_version}"
    if ! registry_exact_version "$dependency_name" "$dependency_version"; then
      die "Required dependency is not published: ${dependency_name}@${dependency_version}"
    fi
    [[ "$registry_observed" == "$dependency_version" ]] \
      || die "Registry returned unexpected dependency version for ${dependency_name}: ${registry_observed}"
  done < <(internal_dependencies "$package_dir")
}

require_clean_tree

configured_registry="$(npm config get registry 2>/dev/null)" \
  || die "Unable to read npm registry configuration"
[[ "$configured_registry" == "$REGISTRY" ]] \
  || die "npm registry must be ${REGISTRY}, got ${configured_registry}"

identity="$(npm whoami --registry "$REGISTRY" 2>/dev/null)" \
  || die "npm authentication is required; run npm login"
[[ "$identity" == "fa-steward" ]] \
  || die "Expected npm identity fa-steward, got ${identity}"

org_access="$(npm org ls fides-anima --registry "$REGISTRY" 2>/dev/null)" \
  || die "Unable to verify fides-anima organization access"
printf '%s\n' "$org_access" \
  | grep -Eq "^${identity}[[:space:]]+-[[:space:]]+owner$" \
  || die "${identity} is not listed as an owner of fides-anima"

names=()
versions=()
dirs=()
selected_found="false"
for i in "${!package_dirs[@]}"; do
  package_dir="${package_dirs[$i]}"
  expected_name="${expected_names[$i]}"
  name="$(manifest_field "$package_dir" 'p.name')"
  version="$(manifest_field "$package_dir" 'p.version')"
  private="$(manifest_field "$package_dir" 'p.private')"
  access="$(manifest_field "$package_dir" 'p.publishConfig?.access')"
  manifest_registry="$(manifest_field "$package_dir" 'p.publishConfig?.registry')"

  [[ "$name" == "$expected_name" ]] \
    || die "${package_dir}/package.json name mismatch: ${name}"
  [[ -n "$version" ]] || die "${name} has no version"
  [[ "$private" != "true" ]] || die "${name} is private"
  [[ "$access" == "public" ]] || die "${name} publishConfig.access is not public"
  [[ -z "$manifest_registry" ]] \
    || die "${name} must not override publishConfig.registry"

  if [[ "$package_selected" == "true" && "$name" != "$selected_name" ]]; then
    continue
  fi
  selected_found="true"

  names+=("$name")
  versions+=("$version")
  dirs+=("$package_dir")
  if registry_exact_version "$name" "$version"; then
    [[ "$registry_observed" == "$version" ]] \
      || die "Registry returned unexpected version for ${name}: ${registry_observed}"
    die "${name}@${version} already exists; bump it before publishing"
  fi
done
[[ "$selected_found" == "true" ]] \
  || die "Unknown --package target: ${selected_name}"

printf 'Authenticated as %s (fides-anima owner).\n' "$identity"
printf 'Running clean install and complete verification...\n'
npm ci
npm run verify:all
npm run publish:npm:dry
require_clean_tree

if [[ "$package_selected" == "true" ]]; then
  require_internal_dependencies_published "${dirs[0]}"
fi

if [[ "$mode" == "preflight" ]]; then
  printf 'Live-publish preflight passed; nothing was published.\n'
  exit 0
fi

# Close the registry race between the initial preflight and the live phase.
for i in "${!names[@]}"; do
  if registry_exact_version "${names[$i]}" "${versions[$i]}"; then
    die "${names[$i]}@${versions[$i]} appeared during preflight; refusing publish"
  fi
done

for i in "${!names[@]}"; do
  name="${names[$i]}"
  version="${versions[$i]}"
  require_internal_dependencies_published "${dirs[$i]}"
  printf '=== LIVE npm publish: %s@%s ===\n' "$name" "$version"
  npm publish --access public --registry "$REGISTRY" -w "$name"
  verify_published_version "$name" "$version"
  printf 'Verified on npm: %s@%s\n' "$name" "$version"
done

printf 'All requested @fides-anima package versions were published and verified.\n'
