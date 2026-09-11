import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const root = join(import.meta.dirname, "..");
const script = join(import.meta.dirname, "npm-publish.sh");
const source = readFileSync(script, "utf8");

const expectedOrder = [
  "@fides-anima/fpp-protocol-core",
  "@fides-anima/fpp-steward-auth-core",
  "@fides-anima/fpp-enforcement-core",
  "@fides-anima/fpp-trust-core",
  "@fides-anima/fpp-tool-proxy",
  "@fides-anima/fpp-adapter-cursor",
  "@fides-anima/fpp-adapter-claude-code",
  "@fides-anima/fpp-adapter-codex",
  "@fides-anima/openclaw-fpp-plugin",
  "@fides-anima/openclaw-fpp-trust",
];

function runWithFakeCommands(
  args: string[],
  scenario = "normal",
  publishGate = "YES",
  initiallyPublished: string[] = [],
): { status: number | null; output: string; calls: string[] } {
  const temp = mkdtempSync(join(tmpdir(), "fpp-npm-publish-test-"));
  const log = join(temp, "calls.log");
  const published = join(temp, "published.txt");
  const bin = join(temp, "bin");
  mkdirSync(bin);
  writeFileSync(log, "");
  writeFileSync(
    published,
    initiallyPublished.length > 0 ? `${initiallyPublished.join("\n")}\n` : "",
  );

  writeFileSync(
    join(bin, "git"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'git %s\\n' "$*" >> "$CALL_LOG"
case "$1" in
  diff|ls-files) exit 0 ;;
  *) exit 99 ;;
esac
`,
  );
  writeFileSync(
    join(bin, "npm"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ -n "\${NPM_TOKEN:-}" || -n "\${NODE_AUTH_TOKEN:-}" ]]; then
  echo "raw token environment leaked" >&2
  exit 96
fi
if [[ "$1" != "whoami" && "$1" != "org" && "$1" != "publish" && "$1" != "view" ]]; then
  if env | cut -d= -f1 | grep -Eqi '^(npm_config.*(auth|password|username|otp|cert|key)|npm.?token|node.?auth.?token)'; then
    echo "credential-shaped environment leaked to public npm" >&2
    exit 95
  fi
fi
printf 'npm %s\\n' "$*" >> "$CALL_LOG"
if [[ "$1" == "config" && "$2" == "get" && "$3" == "registry" ]]; then
  if [[ "$SCENARIO" == "registry-mismatch" ]]; then
    echo "https://registry.example.invalid/"
  else
    echo "https://registry.npmjs.org/"
  fi
  exit 0
fi
if [[ "$1" == "whoami" ]]; then echo "fa-steward"; exit 0; fi
if [[ "$1" == "org" && "$2" == "ls" ]]; then
  echo "fa-steward - owner"
  exit 0
fi
if [[ "$1" == "view" ]]; then
  if [[ "$SCENARIO" == "network-error" ]]; then
    echo "npm error code ECONNRESET" >&2
    exit 1
  fi
  if [[ "$SCENARIO" == "view-stale" ]]; then
    echo "npm error code E404" >&2
    exit 1
  fi
  if [[ "$SCENARIO" == "cached-404" ]]; then
    has_fresh_cache="false"
    for arg in "$@"; do
      if [[ "\$arg" == "--cache" ]]; then has_fresh_cache="true"; fi
    done
    if [[ "\$has_fresh_cache" != "true" ]]; then
      echo "npm error code E404" >&2
      exit 1
    fi
  fi
  spec="$2"
  name="\${spec%@*}"
  version="\${spec##*@}"
  if grep -Fqx "$name" "$PUBLISHED_STATE"; then
    if [[ "\${3:-}" == "dist.integrity" ]]; then
      if [[ "$SCENARIO" == "integrity-mismatch" ]]; then
        echo "sha512-different-\${name}"
      else
        echo "sha512-test-\${name}"
      fi
    else
      echo "$version"
    fi
    exit 0
  fi
  echo "npm error code E404" >&2
  exit 1
fi
if [[ "$1" == "ci" || "$1" == "run" ]]; then exit 0; fi
if [[ "$1" == "pack" ]]; then
  name=""
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "-w" ]]; then name="$2"; break; fi
    shift
  done
  printf '[{"integrity":"sha512-test-%s"}]\\n' "$name"
  exit 0
fi
if [[ "$1" == "publish" ]]; then
  name=""
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "-w" ]]; then name="$2"; break; fi
    shift
  done
  [[ -n "$name" ]] || exit 98
  printf '%s\\n' "$name" >> "$PUBLISHED_STATE"
  exit 0
fi
exit 97
`,
  );
  chmodSync(join(bin, "git"), 0o755);
  chmodSync(join(bin, "npm"), 0o755);

  try {
    const result = spawnSync("bash", [script, ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        Path: `${bin}${delimiter}${process.env.Path ?? process.env.PATH ?? ""}`,
        CALL_LOG: log,
        PUBLISHED_STATE: published,
        SCENARIO: scenario,
        FPP_NPM_PUBLISH: publishGate,
        NPM_TOKEN: "npm_test_token_1234567890",
        "npm_config_//registry.npmjs.org/:_authToken":
          "inherited_test_secret",
        NPM_CONFIG__AUTH: "inherited_basic_auth",
        "npm_config_//registry.npmjs.org/:_password":
          "inherited_password",
        NPM_CONFIG_OTP: "123456",
        FPP_NPM_TEST_COMMAND: "bash",
        FPP_NPM_TEST_SCRIPT: join(bin, "npm"),
      },
    });
    return {
      status: result.status,
      output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
      calls: readFileSync(log, "utf8").trim().split(/\r?\n/).filter(Boolean),
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

describe("guarded live npm publisher", () => {
  it("requires an explicit mode before any live operation", () => {
    const result = runWithFakeCommands([]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /No mode selected/);
    assert.equal(result.calls.some((call) => call.startsWith("npm publish ")), false);
  });

  it("requires the independent live environment gate", () => {
    const result = runWithFakeCommands(["--confirm-live"], "normal", "");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /FPP_NPM_PUBLISH=YES/);
    assert.equal(result.calls.some((call) => call.startsWith("npm publish ")), false);
  });

  it("rejects an empty package selection without widening scope", () => {
    const result = runWithFakeCommands([
      "--confirm-live",
      "--package",
      "",
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /non-empty package name/);
    assert.equal(result.calls.some((call) => call.startsWith("npm publish ")), false);
  });

  it("runs every preflight gate without publishing", () => {
    const result = runWithFakeCommands(["--preflight-only"]);
    assert.equal(result.status, 0, result.output);
    assert.doesNotMatch(result.output, /npm_test_token_1234567890/);
    assert.doesNotMatch(result.output, /inherited_test_secret/);
    assert.equal(
      result.calls.some((call) => call.includes("npm_test_token_1234567890")),
      false,
    );
    assert.ok(result.calls.includes("npm ci"));
    assert.ok(result.calls.includes("npm run verify:all"));
    assert.ok(result.calls.includes("npm run publish:npm:dry"));
    assert.equal(result.calls.some((call) => call.startsWith("npm publish ")), false);
  });

  it("refuses registry mismatch and non-404 registry failures", () => {
    for (const scenario of ["registry-mismatch", "network-error"]) {
      const result = runWithFakeCommands(["--preflight-only"], scenario);
      assert.notEqual(result.status, 0, `${scenario}: ${result.output}`);
      assert.equal(
        result.calls.some((call) => call.startsWith("npm publish ")),
        false,
      );
    }
  });

  it("publishes only after verification and in dependency order", () => {
    const result = runWithFakeCommands(["--confirm-live"]);
    assert.equal(result.status, 0, result.output);
    const dryRun = result.calls.indexOf("npm run publish:npm:dry");
    const publishCalls = result.calls.filter((call) =>
      call.startsWith("npm publish "),
    );
    assert.equal(publishCalls.length, expectedOrder.length);
    const firstPublish = result.calls.indexOf(publishCalls[0]!);
    const beforePublish = result.calls.slice(0, firstPublish);
    assert.ok(firstPublish > dryRun);
    assert.equal(
      beforePublish.filter(
        (call) => call === "git ls-files --others --exclude-standard",
      ).length,
      2,
    );
    assert.match(
      beforePublish.at(-1) ?? "",
      /^npm view @fides-anima\/openclaw-fpp-trust@1\.2\.12 version --registry /,
    );
    assert.deepEqual(
      publishCalls.map((call) => call.match(/ -w (\S+)$/)?.[1]),
      expectedOrder,
    );
  });

  it("supports explicit one-package recovery without skipping versions", () => {
    const target = "@fides-anima/fpp-enforcement-core";
    const result = runWithFakeCommands([
      "--confirm-live",
      "--package",
      target,
    ], "normal", "YES", [
      "@fides-anima/fpp-protocol-core",
      "@fides-anima/fpp-steward-auth-core",
    ]);
    assert.equal(result.status, 0, result.output);
    const publishCalls = result.calls.filter((call) =>
      call.startsWith("npm publish "),
    );
    assert.equal(publishCalls.length, 1);
    assert.match(publishCalls[0]!, new RegExp(` -w ${target}$`));
    assert.equal(result.calls.some((call) => call === "npm ci"), false);
    assert.equal(
      result.calls.some((call) => call === "npm run verify:all"),
      false,
    );
  });

  it("resumes only after matching existing artifact integrity", () => {
    const alreadyPublished = "@fides-anima/fpp-protocol-core";
    const result = runWithFakeCommands(
      ["--confirm-live", "--resume"],
      "normal",
      "YES",
      [alreadyPublished],
    );
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /RESUME: verified existing artifact/);
    assert.match(result.output, /Skipping npm ci, verify:all, and publish:npm:dry/);
    assert.equal(result.calls.some((call) => call === "npm ci"), false);
    assert.equal(
      result.calls.some((call) => call === "npm run verify:all"),
      false,
    );
    assert.equal(
      result.calls.some((call) => call === "npm run publish:npm:dry"),
      false,
    );
    const publishCalls = result.calls.filter((call) =>
      call.startsWith("npm publish "),
    );
    assert.equal(publishCalls.length, expectedOrder.length - 1);
    assert.equal(
      publishCalls.some((call) => call.endsWith(`-w ${alreadyPublished}`)),
      false,
    );
  });

  it("does not treat a cached preflight 404 as an unpublished version", () => {
    const result = runWithFakeCommands(["--confirm-live"], "cached-404");
    assert.equal(result.status, 0, result.output);
    const publishCalls = result.calls.filter((call) =>
      call.startsWith("npm publish "),
    );
    assert.equal(publishCalls.length, expectedOrder.length);
    assert.ok(
      result.calls.some((call) => call.includes(" --cache ")),
      result.calls.filter((call) => call.startsWith("npm view ")).join("\n"),
    );
  });

  it("continues a live release when npm view lags behind a successful publish", () => {
    const result = runWithFakeCommands(["--confirm-live"], "view-stale");
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /npm accepted .* but npm view has not shown it yet/);
    const publishCalls = result.calls.filter((call) =>
      call.startsWith("npm publish "),
    );
    assert.equal(publishCalls.length, expectedOrder.length);
  });

  it("refuses resume when an existing artifact differs", () => {
    const result = runWithFakeCommands(
      ["--confirm-live", "--resume"],
      "integrity-mismatch",
      "YES",
      ["@fides-anima/fpp-protocol-core"],
    );
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Published artifact differs/);
    assert.equal(
      result.calls.some((call) => call.startsWith("npm publish ")),
      false,
    );
  });

  it("refuses one-package recovery with unpublished internal dependencies", () => {
    const result = runWithFakeCommands([
      "--confirm-live",
      "--package",
      "@fides-anima/fpp-enforcement-core",
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Required dependency is not published/);
    assert.equal(result.calls.some((call) => call.startsWith("npm publish ")), false);
  });

  it("checks internal dependencies during package-scoped preflight", () => {
    const target = "@fides-anima/fpp-enforcement-core";
    const blocked = runWithFakeCommands([
      "--preflight-only",
      "--package",
      target,
    ]);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.output, /Required dependency is not published/);

    const passed = runWithFakeCommands(
      ["--preflight-only", "--package", target],
      "normal",
      "YES",
      [
        "@fides-anima/fpp-protocol-core",
        "@fides-anima/fpp-steward-auth-core",
      ],
    );
    assert.equal(passed.status, 0, passed.output);
    assert.equal(
      passed.calls.some((call) => call.startsWith("npm publish ")),
      false,
    );
  });

  it("pins package order and release safety mechanisms", () => {
    let previous = -1;
    for (const packageName of expectedOrder) {
      const position = source.indexOf(`"${packageName}"`);
      assert.ok(position > previous, `${packageName} is missing or out of order`);
      previous = position;
    }

    assert.match(source, /git diff --quiet/);
    assert.match(source, /git ls-files --others --exclude-standard/);
    assert.match(source, /npm whoami/);
    assert.match(source, /npm org ls fides-anima/);
    assert.match(source, /npm view/);
    assert.match(source, /npm ci/);
    assert.match(source, /npm run verify:all/);
    assert.match(source, /npm run publish:npm:dry/);
    assert.match(source, /authenticated_npm view/);
    assert.match(source, /--cache/);
    assert.match(
      source,
      /Skipping npm ci, verify:all, and publish:npm:dry for partial-run recovery/,
    );
    assert.match(
      source,
      /authenticated_npm publish --ignore-scripts --access public/,
    );
    assert.match(source, /verify_published_version/);
    assert.doesNotMatch(source, /clawhub .*publish/);
  });
});
