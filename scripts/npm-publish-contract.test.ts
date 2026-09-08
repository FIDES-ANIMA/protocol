import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { before, describe, it } from "node:test";
import { resolveNpmSpawn } from "./package-reproducibility.js";

const root = join(import.meta.dirname, "..");

const publishable = [
  ["packages/protocol-core", "@fides-anima/fpp-protocol-core"],
  ["packages/steward-auth-core", "@fides-anima/fpp-steward-auth-core"],
  ["packages/enforcement-core", "@fides-anima/fpp-enforcement-core"],
  ["packages/trust-core", "@fides-anima/fpp-trust-core"],
  ["packages/tool-proxy", "@fides-anima/fpp-tool-proxy"],
  ["harness/cursor/adapter", "@fides-anima/fpp-adapter-cursor"],
  ["harness/claude-code/adapter", "@fides-anima/fpp-adapter-claude-code"],
  ["harness/codex/adapter", "@fides-anima/fpp-adapter-codex"],
  ["harness/openclaw/plugin", "@fides-anima/openclaw-fpp-plugin"],
  ["harness/openclaw/plugin-trust", "@fides-anima/openclaw-fpp-trust"],
] as const;

const requiredLicenseAssets = {
  "constitution.json": join(root, "constitution.json"),
  "constitution.yaml": join(root, "constitution.yaml"),
  "SKILL.md": join(root, "harness", "shared", "prompt", "SKILL.md"),
} as const;

const adapterBins = new Map<string, string>([
  ["harness/cursor/adapter", "fpp-cursor-hook"],
  ["harness/claude-code/adapter", "fpp-claude-code-hook"],
  ["harness/codex/adapter", "fpp-codex-hook"],
]);

function buildPackage(packageName: string): void {
  const { command, prefixArgs } = resolveNpmSpawn();
  const result = spawnSync(
    command,
    [...prefixArgs, "run", "build", "--if-present", "-w", packageName],
    { cwd: root, encoding: "utf8", shell: false },
  );
  assert.equal(
    result.status,
    0,
    `${packageName} build failed:\n${result.stderr ?? result.stdout}`,
  );
}

function packedFilePaths(packageName: string): string[] {
  const { command, prefixArgs } = resolveNpmSpawn();
  const result = spawnSync(
    command,
    [
      ...prefixArgs,
      "pack",
      "--dry-run",
      "--json",
      "--ignore-scripts",
      "-w",
      packageName,
    ],
    { cwd: root, encoding: "utf8", shell: false },
  );
  assert.equal(
    result.status,
    0,
    `${packageName} pack failed:\n${result.stderr ?? result.stdout}`,
  );
  const packs = JSON.parse(result.stdout) as Array<{
    files?: Array<{ path?: string }>;
  }>;
  assert.equal(packs.length, 1, `${packageName} must produce one tarball`);
  return (packs[0]?.files ?? [])
    .map((file) => file.path)
    .filter((path): path is string => typeof path === "string");
}

describe("public npm package contract", () => {
  before(() => {
    for (const [, packageName] of publishable) {
      buildPackage(packageName);
    }
  });

  for (const [directory, expectedName] of publishable) {
    it(`${expectedName} is public and pack-safe`, () => {
      const packageRoot = join(root, directory);
      const manifest = JSON.parse(
        readFileSync(join(packageRoot, "package.json"), "utf8"),
      ) as {
        name?: string;
        private?: boolean;
        license?: string;
        files?: string[];
        bin?: Record<string, string>;
        bundledDependencies?: string[];
        publishConfig?: { access?: string };
        repository?: { directory?: string };
      };

      assert.equal(manifest.name, expectedName);
      assert.notEqual(manifest.private, true);
      assert.equal(manifest.publishConfig?.access, "public");
      assert.equal(manifest.license, "SEE LICENSE IN LICENSE");
      assert.equal(manifest.repository?.directory, directory);
      assert.ok(manifest.files?.includes("LICENSE"));
      assert.ok(existsSync(join(packageRoot, "LICENSE")));
      for (const [asset, canonicalPath] of Object.entries(requiredLicenseAssets)) {
        assert.ok(manifest.files?.includes(asset), `${expectedName} must ship ${asset}`);
        assert.equal(
          readFileSync(join(packageRoot, asset), "utf8"),
          readFileSync(canonicalPath, "utf8"),
          `${expectedName} ${asset} must match the canonical framework`,
        );
      }
      if (expectedName === "@fides-anima/fpp-tool-proxy") {
        assert.ok(
          manifest.bundledDependencies?.includes(
            "@fides-anima/fpp-steward-auth-core",
          ),
          "tool-proxy must bundle enforcement-core's steward-auth dependency",
        );
      }
      const adapterBin = adapterBins.get(directory);
      if (adapterBin) {
        assert.equal(manifest.bin?.[adapterBin], "./dist/hook-cli.js");
      }

      const npmIgnore = readFileSync(join(packageRoot, ".npmignore"), "utf8");
      assert.match(npmIgnore, /\*\*\/\*\.test\.ts/);
      assert.match(npmIgnore, /\*\*\/test-helpers\.\*/);

      const sourceNpmIgnore = readFileSync(
        join(packageRoot, "src", ".npmignore"),
        "utf8",
      );
      assert.match(sourceNpmIgnore, /\*\*\/\*\.test\.ts/);
      assert.match(sourceNpmIgnore, /\*\*\/test-helpers\.\*/);

      const packedFiles = packedFilePaths(expectedName);
      assert.ok(packedFiles.includes("dist/index.js"));
      assert.ok(packedFiles.includes("dist/index.d.ts"));
      assert.ok(packedFiles.includes("README.md"));
      assert.ok(packedFiles.includes("LICENSE"));
      for (const asset of Object.keys(requiredLicenseAssets)) {
        assert.ok(packedFiles.includes(asset), `${expectedName} pack missing ${asset}`);
      }
      if (adapterBin) {
        assert.ok(packedFiles.includes("dist/hook-cli.js"));
      }
      const packageOwnedFiles = packedFiles.filter(
        (path) => !path.startsWith("node_modules/"),
      );
      assert.equal(
        packageOwnedFiles.some(
          (path) =>
            path.endsWith(".test.ts") ||
            /(?:^|\/)test-helpers\.[^/]+$/.test(path),
        ),
        false,
        `${expectedName} tarball contains test-only files`,
      );
    });
  }

  it("keeps non-distributable workspaces private", () => {
    for (const manifestPath of [
      "package.json",
      "harness/openclaw/skill/package.json",
      "packages/gateway-reference/package.json",
    ]) {
      const manifest = JSON.parse(
        readFileSync(join(root, manifestPath), "utf8"),
      ) as { private?: boolean };
      assert.equal(manifest.private, true, manifestPath);
    }
  });
});
