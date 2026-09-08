/**
 * Shared pack-contract for harness adapters: tarball embeds unpublished
 * @fides-anima cores + tool-proxy and installs alone under OpenClaw-style flags.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveNpmSpawn } from "../../scripts/package-reproducibility.js";
import { packWorkspaceConsumer } from "../../scripts/pack-workspace-consumer.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const ADAPTERS = [
  {
    rel: "harness/cursor/adapter",
    pkgPrefix: "fides-anima-fpp-adapter-cursor",
    bin: "fpp-cursor-hook",
    hook: "hooks/hooks.json",
  },
  {
    rel: "harness/claude-code/adapter",
    pkgPrefix: "fides-anima-fpp-adapter-claude-code",
    bin: "fpp-claude-code-hook",
    hook: "hooks/settings.fragment.json",
  },
  {
    rel: "harness/codex/adapter",
    pkgPrefix: "fides-anima-fpp-adapter-codex",
    bin: "fpp-codex-hook",
    hook: "hooks/hooks.json",
  },
] as const;

function run(
  cmd: string,
  args: string[],
  cwd: string,
): { status: number | null; stdout: string; stderr: string } {
  const npm = cmd === "npm" ? resolveNpmSpawn() : null;
  const r = spawnSync(npm ? npm.command : cmd, npm ? [...npm.prefixArgs, ...args] : args, {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function tarList(tgzPath: string, cwd: string): string {
  const force = run("tar", ["--force-local", "-tzf", tgzPath], cwd);
  if (force.status === 0) return force.stdout;
  return run("tar", ["-tzf", tgzPath], cwd).stdout;
}

describe("adapter pack-bundle", { concurrency: false }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "fpp-adapter-pack-"));

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  for (const adapter of ADAPTERS) {
    it(`${adapter.rel} packs bundled deps and installs in isolation`, async () => {
      const dir = join(root, adapter.rel);
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name: string;
        bin?: Record<string, string>;
        bundledDependencies?: string[];
      };
      assert.equal(pkg.bin?.[adapter.bin], "./dist/hook-cli.js");
      assert.match(
        readFileSync(join(dir, adapter.hook), "utf8"),
        new RegExp(`npx --no-install ${adapter.bin}`),
      );
      assert.ok(
        pkg.bundledDependencies?.includes("@fides-anima/fpp-tool-proxy"),
        `${adapter.rel} must list tool-proxy in bundledDependencies`,
      );
      assert.ok(
        pkg.bundledDependencies?.includes("@fides-anima/fpp-steward-auth-core"),
        `${adapter.rel} must list steward-auth-core in bundledDependencies (enforcement-core import)`,
      );

      const build = run("npm", ["run", "build"], dir);
      assert.equal(build.status, 0, build.stderr || build.stdout);

      const tgz = await packWorkspaceConsumer({
        repoRoot: root,
        packageDir: dir,
        destination: tmp,
      });
      assert.ok(existsSync(tgz), `expected ${adapter.pkgPrefix}-*.tgz`);

      const listing = tarList(tgz, tmp);
      assert.match(listing, /node_modules\/@fides-anima\/fpp-protocol-core\//);
      assert.match(listing, /node_modules\/@fides-anima\/fpp-enforcement-core\//);
      assert.match(listing, /node_modules\/@fides-anima\/fpp-steward-auth-core\//);
      assert.match(listing, /node_modules\/@fides-anima\/fpp-tool-proxy\//);
      assert.match(listing, /dist\/index\.js/);
      assert.match(listing, /dist\/hook-cli\.js/);

      const isol = join(tmp, `isol-${adapter.pkgPrefix}`);
      mkdirSync(isol, { recursive: true });
      writeFileSync(
        join(isol, "package.json"),
        JSON.stringify({ name: "isol-adapter", private: true, version: "0.0.0" }),
      );

      const install = run(
        "npm",
        [
          "install",
          "--omit=dev",
          "--omit=peer",
          "--legacy-peer-deps",
          "--ignore-scripts",
          tgz,
        ],
        isol,
      );
      assert.equal(install.status, 0, install.stderr || install.stdout);

      const scope = join(isol, "node_modules", "@fides-anima");
      const installedName = readdirSync(scope).find((e) =>
        e.startsWith("fpp-adapter-"),
      );
      assert.ok(installedName);
      const adapterInstall = join(scope, installedName!);
      const binShim = join(
        isol,
        "node_modules",
        ".bin",
        process.platform === "win32" ? `${adapter.bin}.cmd` : adapter.bin,
      );
      assert.ok(existsSync(binShim), `${adapter.bin} install shim must exist`);
      assert.ok(
        existsSync(
          join(adapterInstall, "node_modules/@fides-anima/fpp-enforcement-core/package.json"),
        ),
      );
      assert.ok(
        existsSync(
          join(adapterInstall, "node_modules/@fides-anima/fpp-steward-auth-core/package.json"),
        ),
        "bundled steward-auth-core must land under the installed adapter",
      );

      const importScript = join(adapterInstall, "check-import.mjs");
      writeFileSync(
        importScript,
        "import('@fides-anima/fpp-enforcement-core').then((m) => {\n" +
          "  if (!m || typeof m !== 'object') process.exit(1);\n" +
          "}).catch((e) => { console.error(e); process.exit(1); });\n",
      );
      const importCheck = spawnSync(process.execPath, [importScript], {
        cwd: adapterInstall,
        encoding: "utf8",
      });
      assert.equal(
        importCheck.status,
        0,
        (importCheck.stderr || "") + (importCheck.stdout || ""),
      );

      const hookCheck = spawnSync(
        binShim,
        [],
        {
          cwd: isol,
          input: "",
          encoding: "utf8",
          shell: process.platform === "win32",
        },
      );
      assert.equal(
        hookCheck.status,
        0,
        (hookCheck.stderr || "") + (hookCheck.stdout || ""),
      );
      assert.match(hookCheck.stdout ?? "", /permissionDecision/);
    });
  }
});
