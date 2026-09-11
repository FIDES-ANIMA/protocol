#!/usr/bin/env bash
set -euo pipefail

# Guarded live publisher for the ten public npm packages.
# This script never publishes unless both --confirm-live and
# FPP_NPM_PUBLISH=YES are supplied.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
REGISTRY="https://registry.npmjs.org/"
PUBLIC_NPM_CONFIG="$SCRIPT_DIR/npm-public.npmrc"
PUBLIC_NPM_LAUNCHER="$SCRIPT_DIR/npm-public.mjs"
TOKEN_AUTH_LAUNCHER="$SCRIPT_DIR/npm-token-auth.mjs"
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
  FPP_NPM_PUBLISH=YES npm run publish:npm -- --confirm-live --resume
  FPP_NPM_PUBLISH=YES npm run publish:npm -- --confirm-live --package <name>

Options:
  --preflight-only  Run all checks without publishing.
  --confirm-live    Authorize the live npm publish phase.
  --resume          Continue a partial release after integrity verification.
                    Skips npm ci, verify:all, and dry-run.
  --package <name>  Publish or preflight one package for partial-run recovery.
                    Live recovery also skips npm ci, verify:all, and dry-run.
  --help            Show this help.

A first live publish requires a clean Git tree, the verified fa-steward npm
identity, owner access to the fides-anima organization, successful verify:all
and npm publish dry-runs, and exact-version registry checks. --resume and live
--package keep the identity, tree, and artifact checks, and skip the full
verification gate. Set NPM_TOKEN in the ignored repository-root .env file or
export it before running this command.
USAGE
}

mode=""
selected_name=""
package_selected="false"
resume="false"
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
    --resume)
      resume="true"
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
[[ "$resume" != "true" || "$mode" == "live" ]] \
  || die "--resume is valid only with --confirm-live"
[[ "$resume" != "true" || "$package_selected" != "true" ]] \
  || die "--resume and --package cannot be combined"

load_npm_token() {
  if [[ -z "${NPM_TOKEN:-}" ]]; then
    [[ -f "$ROOT/.env" ]] \
      || die "NPM_TOKEN is not exported and ${ROOT}/.env does not exist"
    NPM_TOKEN="$(
      node -e "
        const fs = require('fs');
        const lines = fs.readFileSync(process.argv[1], 'utf8').split(/\\r?\\n/);
        const line = lines.find((entry) =>
          /^(?:export[ \\t]+)?NPM_TOKEN[ \\t]*=/.test(entry.trim())
        );
        if (!line) process.exit(2);
        let value = line.slice(line.indexOf('=') + 1).trim();
        if (
          value.length >= 2 &&
          ((value.startsWith('\"') && value.endsWith('\"')) ||
            (value.startsWith(\"'\") && value.endsWith(\"'\")))
        ) {
          value = value.slice(1, -1);
        }
        process.stdout.write(value);
      " "$ROOT/.env"
    )" || die ".env must contain NPM_TOKEN=<granular-access-token>"
  fi
  [[ -n "$NPM_TOKEN" ]] || die "NPM_TOKEN in .env is empty"
  [[ "$NPM_TOKEN" != *$'\r'* && "$NPM_TOKEN" != *$'\n'* ]] \
    || die "NPM_TOKEN must not contain control characters"
  [[ "$NPM_TOKEN" =~ ^npm_[A-Za-z0-9_-]{20,}$ ]] \
    || die "NPM_TOKEN must be a granular npm token"
  export -n NPM_TOKEN 2>/dev/null || true
}

public_npm() {
  node "$PUBLIC_NPM_LAUNCHER" "$@"
}

authenticated_npm() {
  printf '%s' "$NPM_TOKEN" | env -u NPM_TOKEN -u NODE_AUTH_TOKEN \
    NPM_CONFIG_USERCONFIG="$PUBLIC_NPM_CONFIG" \
    node "$TOKEN_AUTH_LAUNCHER" "$@"
}

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

last_nonempty_line() {
  printf '%s' "$1" | tr -d '\r' | awk 'NF { line = $0 } END { print line }'
}

# Query the registry through a fresh npm cache. Preflight 404s otherwise stick
# in the shared npm cache and make a successful publish look unpublished.
npm_view_field() {
  local package_name="$1" version="$2" field="$3" cache_dir output status
  cache_dir="$(mktemp -d)" || die "Unable to create npm view cache directory"
  set +e
  output="$(
    authenticated_npm view "${package_name}@${version}" "$field" \
      --registry "$REGISTRY" --cache "$cache_dir" 2>&1
  )"
  status=$?
  set -e
  rm -rf "$cache_dir"
  if [[ $status -eq 0 ]]; then
    _npm_view_output="$(last_nonempty_line "$output")"
    return 0
  fi
  if printf '%s' "$output" | grep -Eq 'E404|404 Not Found'; then
    return 1
  fi
  die "Registry query failed for ${package_name}@${version}: ${output}"
}

registry_observed=""
registry_exact_version() {
  local package_name="$1" version="$2"
  registry_observed=""
  if npm_view_field "$package_name" "$version" version; then
    registry_observed="$_npm_view_output"
    return 0
  fi
  return 1
}

verify_published_version() {
  local package_name="$1" version="$2"
  for attempt in $(seq 1 3); do
    if registry_exact_version "$package_name" "$version"; then
      [[ "$registry_observed" == "$version" ]] \
        || die "Registry returned unexpected version for ${package_name}: ${registry_observed}"
      return 0
    fi
    [[ "$attempt" -eq 3 ]] || sleep 1
  done
  printf 'WARNING: npm accepted %s@%s, but npm view has not shown it yet; continuing.\n' \
    "$package_name" "$version"
  return 1
}

verify_existing_artifact() {
  local package_name="$1" version="$2" pack_json local_integrity remote_integrity
  pack_json="$(
    public_npm pack --dry-run --json --ignore-scripts -w "$package_name"
  )" || die "Unable to calculate local integrity for ${package_name}@${version}"
  local_integrity="$(
    printf '%s' "$pack_json" | node -e "
      const fs = require('fs');
      const packs = JSON.parse(fs.readFileSync(0, 'utf8'));
      const integrity = packs[0]?.integrity;
      if (typeof integrity !== 'string' || !integrity) process.exit(2);
      process.stdout.write(integrity);
    "
  )" || die "Local pack did not report integrity for ${package_name}@${version}"
  npm_view_field "$package_name" "$version" dist.integrity \
    || die "Unable to read registry integrity for ${package_name}@${version}"
  remote_integrity="$_npm_view_output"
  [[ "$local_integrity" == "$remote_integrity" ]] \
    || die "Published artifact differs from local package: ${package_name}@${version}"
  printf 'RESUME: verified existing artifact %s@%s\n' "$package_name" "$version"
}

require_internal_dependencies_published() {
  local package_dir="$1" dependency_name dependency_version
  while IFS=$'\t' read -r dependency_name dependency_version; do
    [[ -n "$dependency_name" ]] || continue
    [[ "$dependency_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-].*)?$ ]] \
      || die "${package_dir} has non-exact internal dependency ${dependency_name}@${dependency_version}"
    if registry_exact_version "$dependency_name" "$dependency_version"; then
      [[ "$registry_observed" == "$dependency_version" ]] \
        || die "Registry returned unexpected dependency version for ${dependency_name}: ${registry_observed}"
      continue
    fi
    if was_accepted "$dependency_name" "$dependency_version"; then
      continue
    fi
    die "Required dependency is not published: ${dependency_name}@${dependency_version}"
  done < <(internal_dependencies "$package_dir")
}

accepted_names=()
accepted_versions=()

mark_accepted() {
  accepted_names+=("$1")
  accepted_versions+=("$2")
}

was_accepted() {
  local i
  [[ ${#accepted_names[@]} -eq 0 ]] && return 1
  for i in "${!accepted_names[@]}"; do
    if [[ "${accepted_names[$i]}" == "$1" && "${accepted_versions[$i]}" == "$2" ]]; then
      return 0
    fi
  done
  return 1
}

load_npm_token
require_clean_tree

configured_registry="$(public_npm config get registry 2>/dev/null)" \
  || die "Unable to read npm registry configuration"
[[ "$configured_registry" == "$REGISTRY" ]] \
  || die "npm registry must be ${REGISTRY}, got ${configured_registry}"

identity="$(authenticated_npm whoami --registry "$REGISTRY" 2>/dev/null)" \
  || die "npm authentication is required; check NPM_TOKEN"
[[ "$identity" == "fa-steward" ]] \
  || die "Expected npm identity fa-steward, got ${identity}"

org_access="$(authenticated_npm org ls fides-anima --registry "$REGISTRY" 2>/dev/null)" \
  || die "Unable to verify fides-anima organization access"
printf '%s\n' "$org_access" \
  | grep -Eq "^${identity}[[:space:]]+-[[:space:]]+owner$" \
  || die "${identity} is not listed as an owner of fides-anima"

names=()
versions=()
dirs=()
pending=()
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
    if [[ "$resume" == "true" ]]; then
      pending+=("false")
    else
      die "${name}@${version} already exists; bump it or use --resume after a partial release"
    fi
  else
    pending+=("true")
  fi
done
[[ "$selected_found" == "true" ]] \
  || die "Unknown --package target: ${selected_name}"

printf 'Authenticated as %s (fides-anima owner).\n' "$identity"
if [[ "$resume" == "true" || ( "$mode" == "live" && "$package_selected" == "true" ) ]]; then
  printf 'Skipping npm ci, verify:all, and publish:npm:dry for partial-run recovery.\n'
else
  printf 'Running clean install and complete verification...\n'
  public_npm ci
  public_npm run verify:all
  public_npm run publish:npm:dry
  require_clean_tree
fi

for i in "${!names[@]}"; do
  if [[ "${pending[$i]}" == "false" ]]; then
    verify_existing_artifact "${names[$i]}" "${versions[$i]}"
  fi
done

if [[ "$package_selected" == "true" ]]; then
  require_internal_dependencies_published "${dirs[0]}"
fi

if [[ "$mode" == "preflight" ]]; then
  printf 'Live-publish preflight passed; nothing was published.\n'
  exit 0
fi

# Close the registry race between the initial preflight and the live phase.
for i in "${!names[@]}"; do
  [[ "${pending[$i]}" == "true" ]] || continue
  if registry_exact_version "${names[$i]}" "${versions[$i]}"; then
    die "${names[$i]}@${versions[$i]} appeared during preflight; refusing publish"
  fi
done

for i in "${!names[@]}"; do
  [[ "${pending[$i]}" == "true" ]] || continue
  name="${names[$i]}"
  version="${versions[$i]}"
  require_internal_dependencies_published "${dirs[$i]}"
  printf '=== LIVE npm publish: %s@%s ===\n' "$name" "$version"
  authenticated_npm publish --ignore-scripts --access public \
    --registry "$REGISTRY" -w "$name"
  mark_accepted "$name" "$version"
  if verify_published_version "$name" "$version"; then
    printf 'Verified on npm: %s@%s\n' "$name" "$version"
  fi
done

printf 'All requested @fides-anima package versions were published and verified.\n'
