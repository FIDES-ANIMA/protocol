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
const script = join(import.meta.dirname, "npm-publish-dry-run.sh");

function runDryRun(
  scenario = "normal",
  initiallyPublished: string[] = [],
): { status: number | null; output: string; calls: string[] } {
  const temp = mkdtempSync(join(tmpdir(), "fpp-npm-dry-run-test-"));
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
    join(bin, "npm"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s\\n' "$*" >> "$CALL_LOG"
if [[ "$1" == "view" ]]; then
  if [[ "$SCENARIO" == "network-error" ]]; then
    echo "npm error code ECONNRESET" >&2
    exit 1
  fi
  spec="$2"
  name="\${spec%@*}"
  version="\${spec##*@}"
  if grep -Fqx "$name" "$PUBLISHED_STATE"; then
    echo "$version"
    exit 0
  fi
  echo "npm error code E404" >&2
  exit 1
fi
if [[ "$1" == "pack" ]]; then
  name=""
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "-w" ]]; then name="$2"; break; fi
    shift
  done
  printf 'pack-ok %s\\n' "$name"
  exit 0
fi
if [[ "$1" == "publish" ]]; then
  name=""
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "-w" ]]; then name="$2"; break; fi
    shift
  done
  [[ -n "$name" ]] || exit 98
  if grep -Fqx "$name" "$PUBLISHED_STATE"; then
    echo "npm error You cannot publish over the previously published versions" >&2
    exit 1
  fi
  exit 0
fi
exit 97
`,
  );
  chmodSync(join(bin, "npm"), 0o755);

  try {
    const result = spawnSync("bash", [script], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        Path: `${bin}${delimiter}${process.env.Path ?? process.env.PATH ?? ""}`,
        CALL_LOG: log,
        PUBLISHED_STATE: published,
        SCENARIO: scenario,
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

describe("public npm dry-run", () => {
  it("uses publish --dry-run when the exact version is unpublished", () => {
    const result = runDryRun();
    assert.equal(result.status, 0, result.output);
    const publishCalls = result.calls.filter((call) =>
      call.startsWith("npm publish --dry-run "),
    );
    const packCalls = result.calls.filter((call) =>
      call.startsWith("npm pack --dry-run "),
    );
    assert.equal(publishCalls.length, 10);
    assert.equal(packCalls.length, 0);
    assert.match(result.output, /nothing was published/);
  });

  it("packs already-published exact versions instead of failing the overwrite check", () => {
    const alreadyPublished = "@fides-anima/fpp-protocol-core";
    const result = runDryRun("normal", [alreadyPublished]);
    assert.equal(result.status, 0, result.output);
    assert.match(
      result.output,
      /already published\): @fides-anima\/fpp-protocol-core@/,
    );
    assert.equal(
      result.calls.some((call) =>
        call.startsWith("npm publish --dry-run ") &&
        call.endsWith(`-w ${alreadyPublished}`),
      ),
      false,
    );
    assert.equal(
      result.calls.some((call) =>
        call.startsWith("npm pack --dry-run ") &&
        call.endsWith(`-w ${alreadyPublished}`),
      ),
      true,
    );
    assert.equal(
      result.calls.filter((call) => call.startsWith("npm publish --dry-run "))
        .length,
      9,
    );
  });

  it("fails closed on non-404 registry errors", () => {
    const result = runDryRun("network-error");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Registry query failed/);
    assert.equal(
      result.calls.some((call) => call.startsWith("npm publish ")),
      false,
    );
  });
});
