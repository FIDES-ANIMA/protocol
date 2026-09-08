/**
 * Isolated pack embeds workspace bundledDependencies that `npm pack`
 * inside a workspace silently drops (npm 10: bundled files: 0).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  packWorkspaceConsumer,
  packedTarballName,
} from "./pack-workspace-consumer.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function tarList(tgzPath: string): string {
  const force = spawnSync("tar", ["--force-local", "-tzf", tgzPath], {
    encoding: "utf8",
  });
  if (force.status === 0) return force.stdout ?? "";
  return spawnSync("tar", ["-tzf", tgzPath], { encoding: "utf8" }).stdout ?? "";
}

describe("pack-workspace-consumer", { concurrency: false }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "fpp-isol-pack-test-"));

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("packedTarballName matches npm pack scoped filenames", () => {
    assert.equal(
      packedTarballName({
        name: "@fides-anima/openclaw-fpp-trust",
        version: "1.2.12",
      }),
      "fides-anima-openclaw-fpp-trust-1.2.12.tgz",
    );
    assert.equal(
      packedTarballName({ name: "plain-pkg", version: "0.1.0" }),
      "plain-pkg-0.1.0.tgz",
    );
  });

  it("CLI refuses a missing package path", () => {
    const script = join(root, "scripts", "pack-workspace-consumer.ts");
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", script, "--package", "does-not-exist", "--destination", tmp],
      { cwd: root, encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    assert.match(out, /not found|missing|package/i);
  });

  it("trust plugin tarball embeds staged protocol-core and trust-core", async () => {
    const dest = join(tmp, "trust");
    const tgz = await packWorkspaceConsumer({
      repoRoot: root,
      packageDir: join(root, "harness", "openclaw", "plugin-trust"),
      destination: dest,
    });
    assert.ok(existsSync(tgz), `expected tarball at ${tgz}`);
    const listing = tarList(tgz);
    assert.match(listing, /node_modules\/@fides-anima\/fpp-protocol-core\//);
    assert.match(listing, /node_modules\/@fides-anima\/fpp-trust-core\//);
    assert.match(listing, /node_modules\/@fides-anima\/fpp-enforcement-core\//);
    assert.match(listing, /node_modules\/@fides-anima\/fpp-steward-auth-core\//);
    assert.match(listing, /dist\/index\.js/);
    assert.doesNotMatch(listing, /(?:^|\/)test-helpers\.[^/\r\n]+/m);
  });

  it("tool-proxy tarball embeds enforcement-core's steward-auth dependency", async () => {
    const dest = join(tmp, "tool-proxy");
    const tgz = await packWorkspaceConsumer({
      repoRoot: root,
      packageDir: join(root, "packages", "tool-proxy"),
      destination: dest,
    });
    assert.ok(existsSync(tgz), `expected tarball at ${tgz}`);
    const listing = tarList(tgz);
    assert.match(listing, /node_modules\/@fides-anima\/fpp-protocol-core\//);
    assert.match(listing, /node_modules\/@fides-anima\/fpp-enforcement-core\//);
    assert.match(listing, /node_modules\/@fides-anima\/fpp-steward-auth-core\//);
    assert.doesNotMatch(listing, /(?:^|\/)test-helpers\.[^/\r\n]+/m);
  });
});
