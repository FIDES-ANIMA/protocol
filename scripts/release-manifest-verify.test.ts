import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildReleaseManifest,
  computeReleaseExpectations,
  signReleaseManifest,
  writeReleaseManifest,
} from "./release-manifest.ts";
import {
  inferPackageDir,
  readReleaseManifest,
  verifyReleaseFromCheckout,
  verifyReleaseManifest,
} from "./release-manifest-verify.ts";

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

const placeholder = () =>
  buildReleaseManifest({
    sourceCommit: "deadbeef",
    constitutionHash: "a".repeat(64),
    packageName: "pkg",
    packageVersion: "1.0.0",
    packageHash: "p".repeat(64),
    lockfileHash: "l".repeat(64),
    testCorpusHash: "t".repeat(64),
    supportedRuntime: "node>=22.19",
    dependenciesHash: "d".repeat(64),
  });

describe("release-manifest-verify", () => {
  const dir = mkdtempSync(join(tmpdir(), "fpp-rmv-"));
  after(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("reads and verifies a signed manifest file (unanchored library mode)", () => {
    const { privatePem } = keyPair();
    const signed = signReleaseManifest(placeholder(), privatePem);
    const path = join(dir, "manifest.json");
    writeReleaseManifest(path, signed);
    const loaded = readReleaseManifest(path);
    assert.equal(verifyReleaseManifest(loaded).ok, true);
  });

  it("fails on unsigned file", () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, JSON.stringify(placeholder()));
    assert.equal(verifyReleaseManifest(readReleaseManifest(path)).ok, false);
  });
});

describe("release-manifest-verify — anchored checkout gate (F11)", () => {
  const root = mkdtempSync(join(tmpdir(), "fpp-rmv-root-"));
  after(() => rmSync(root, { recursive: true, force: true }));

  // Minimal fake checkout: root package.json with workspaces, one package,
  // lockfile, corpus fixtures, and a git repo so `git ls-files`/HEAD work.
  const git = (...a: string[]) =>
    execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

  function scaffold() {
    mkdirSync(join(root, "packages", "thing", "src"), { recursive: true });
    mkdirSync(join(root, "test", "fixtures"), { recursive: true });
    mkdirSync(join(root, "assurance-artifacts"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["packages/*", "harness/x"] }),
    );
    writeFileSync(
      join(root, "packages", "thing", "package.json"),
      JSON.stringify({
        name: "@x/thing",
        version: "0.1.0",
        engines: { node: ">=22.19" },
        dependencies: { dep: "^1.0.0" },
      }),
    );
    writeFileSync(join(root, "packages", "thing", "src", "index.ts"), "export const v = 1;");
    writeFileSync(join(root, "package-lock.json"), "{}");
    writeFileSync(join(root, "test", "fixtures", "classifier-adversarial.json"), "[]");
    writeFileSync(join(root, "test", "fixtures", "classifier-benign.json"), "[]");
    git("init", "-q");
    git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
  }
  scaffold();

  const keysPath = join(root, "assurance-artifacts", "release-signing-keys.json");
  const manifestPath = join(root, "assurance-artifacts", "release-manifest.json");

  it("infers the workspace directory from the package name", () => {
    assert.equal(inferPackageDir(root, "@x/thing").replace(/\\/g, "/"), "packages/thing");
    assert.throws(() => inferPackageDir(root, "@x/nope"), /cannot locate workspace/);
  });

  it("passes when signed by a pinned key and the checkout matches", () => {
    const k = keyPair();
    const exp = computeReleaseExpectations({ repoRoot: root, packageDir: "packages/thing" });
    writeReleaseManifest(
      manifestPath,
      signReleaseManifest(buildReleaseManifest({ ...exp, constitutionHash: "" }), k.privatePem),
    );
    writeFileSync(
      keysPath,
      JSON.stringify({ schemaVersion: 1, keys: [{ keyId: "rel", publicKeyPem: k.publicPem }] }),
    );
    const r = verifyReleaseFromCheckout({ manifestPath, repoRoot: root });
    assert.deepEqual(r.errors, []);
    assert.equal(r.signerKeyId, "rel");
  });

  it("fails closed with an empty pinned key set even if the signature is valid", () => {
    writeFileSync(keysPath, JSON.stringify({ schemaVersion: 1, keys: [] }));
    const r = verifyReleaseFromCheckout({ manifestPath, repoRoot: root });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /no pinned release keys/.test(e)));
  });

  it("rejects a manifest signed by an unpinned key", () => {
    const other = keyPair();
    writeFileSync(
      keysPath,
      JSON.stringify({ schemaVersion: 1, keys: [{ keyId: "other", publicKeyPem: other.publicPem }] }),
    );
    const r = verifyReleaseFromCheckout({ manifestPath, repoRoot: root });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /not a pinned release key/.test(e)));
  });

  it("rejects when the checkout has drifted from the signed provenance", () => {
    const k = keyPair();
    const exp = computeReleaseExpectations({ repoRoot: root, packageDir: "packages/thing" });
    writeReleaseManifest(
      manifestPath,
      signReleaseManifest(buildReleaseManifest({ ...exp, constitutionHash: "" }), k.privatePem),
    );
    writeFileSync(
      keysPath,
      JSON.stringify({ schemaVersion: 1, keys: [{ keyId: "rel", publicKeyPem: k.publicPem }] }),
    );
    writeFileSync(join(root, "packages", "thing", "src", "index.ts"), "export const v = 'evil';");
    const r = verifyReleaseFromCheckout({ manifestPath, repoRoot: root });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /packageHash mismatch/.test(e)));
    // restore
    writeFileSync(join(root, "packages", "thing", "src", "index.ts"), "export const v = 1;");
  });

  it("throws when the pinned key file is missing (no silent fallback)", () => {
    rmSync(keysPath);
    assert.throws(
      () => verifyReleaseFromCheckout({ manifestPath, repoRoot: root }),
      /pinned release keys not found/,
    );
  });
});
