import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildReleaseManifest,
  computeReleaseExpectations,
  parseTrustedReleaseKeys,
  publicKeyFingerprint,
  signReleaseManifest,
  verifyReleaseManifest,
  RELEASE_SIGNING_DOMAIN,
  type TrustedReleaseKey,
} from "./release-manifest.ts";

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

describe("release manifest", () => {
  const base = () =>
    buildReleaseManifest({
      sourceCommit: "abc123",
      constitutionHash: "a".repeat(64),
      packageName: "@fides-anima/openclaw-fpp-plugin",
      packageVersion: "1.1.4",
      packageHash: "p".repeat(64),
      lockfileHash: "l".repeat(64),
      testCorpusHash: "t".repeat(64),
      supportedRuntime: "node>=22.19",
      dependenciesHash: "d".repeat(64),
    });

  it("signs and verifies with the release domain", () => {
    const { privatePem } = keyPair();
    const signed = signReleaseManifest(base(), privatePem);
    assert.equal(signed.signingDomain, RELEASE_SIGNING_DOMAIN);
    const report = verifyReleaseManifest(signed, {
      sourceCommit: "abc123",
      packageHash: "p".repeat(64),
      minNodeMajor: 22,
    });
    assert.equal(report.ok, true);
    assert.match(report.manifestDigest, /^[0-9a-f]{64}$/);
  });

  it("detects tampered package hash and wrong source commit", () => {
    const { privatePem } = keyPair();
    const signed = signReleaseManifest(base(), privatePem);
    assert.equal(
      verifyReleaseManifest(signed, { packageHash: "x".repeat(64) }).ok,
      false,
    );
    assert.equal(
      verifyReleaseManifest(signed, { sourceCommit: "other" }).ok,
      false,
    );
  });

  it("detects stale lock hash, wrong corpus, unsupported runtime, wrong domain", () => {
    const { privatePem } = keyPair();
    const signed = signReleaseManifest(base(), privatePem);
    assert.ok(
      verifyReleaseManifest(signed, { lockfileHash: "z".repeat(64) }).errors.some((e) =>
        /lockfile/i.test(e),
      ),
    );
    assert.ok(
      verifyReleaseManifest(signed, { testCorpusHash: "z".repeat(64) }).errors.some((e) =>
        /testCorpus/i.test(e),
      ),
    );
    assert.ok(
      verifyReleaseManifest(signed, { minNodeMajor: 24 }).errors.some((e) =>
        /runtime/i.test(e),
      ),
    );
    const wrongDomain = { ...signed, signingDomain: "fpp:v2:agent-identity" as typeof RELEASE_SIGNING_DOMAIN };
    assert.ok(verifyReleaseManifest(wrongDomain).errors.some((e) => /domain/i.test(e)));
  });

  it("compares packageName/version and dependenciesHash when expected", () => {
    const { privatePem } = keyPair();
    const signed = signReleaseManifest(base(), privatePem);
    const r = verifyReleaseManifest(signed, {
      packageName: "@evil/other",
      packageVersion: "9.9.9",
      dependenciesHash: "e".repeat(64),
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /packageName/.test(e)));
    assert.ok(r.errors.some((e) => /packageVersion/.test(e)));
    assert.ok(r.errors.some((e) => /dependenciesHash/.test(e)));
  });
});

describe("release manifest — anchored to pinned keys (F11)", () => {
  const base = () =>
    buildReleaseManifest({
      sourceCommit: "abc123",
      constitutionHash: "a".repeat(64),
      packageName: "pkg",
      packageVersion: "1.0.0",
      packageHash: "p".repeat(64),
      lockfileHash: "l".repeat(64),
      testCorpusHash: "t".repeat(64),
      supportedRuntime: "node>=22.19",
      dependenciesHash: "d".repeat(64),
      issuedAt: "2026-09-01T00:00:00.000Z",
    });

  it("accepts a manifest signed by a pinned key and reports the keyId", () => {
    const k = keyPair();
    const signed = signReleaseManifest(base(), k.privatePem);
    const trusted: TrustedReleaseKey[] = [{ keyId: "release-2026", publicKeyPem: k.publicPem }];
    const r = verifyReleaseManifest(signed, undefined, {
      trustedKeys: trusted,
      requirePinnedKey: true,
    });
    assert.deepEqual(r.errors, []);
    assert.equal(r.ok, true);
    assert.equal(r.signerKeyId, "release-2026");
  });

  it("rejects a validly self-signed manifest whose key is not pinned", () => {
    const attacker = keyPair();
    const legit = keyPair();
    const signed = signReleaseManifest(base(), attacker.privatePem);
    // Without anchoring the manifest vouches for itself…
    assert.equal(verifyReleaseManifest(signed).ok, true);
    // …with anchoring it does not.
    const r = verifyReleaseManifest(signed, undefined, {
      trustedKeys: [{ keyId: "legit", publicKeyPem: legit.publicPem }],
      requirePinnedKey: true,
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /not a pinned release key/.test(e)));
    assert.equal(r.signerKeyId, undefined);
  });

  it("verifies the signature against the pinned key, not the embedded one", () => {
    const legit = keyPair();
    const attacker = keyPair();
    // Attacker signs with their key but swaps in the legit public key as a hint.
    const forged = {
      ...signReleaseManifest(base(), attacker.privatePem),
      publicKeyPem: legit.publicPem,
    };
    const r = verifyReleaseManifest(forged, undefined, {
      trustedKeys: [{ keyId: "legit", publicKeyPem: legit.publicPem }],
      requirePinnedKey: true,
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /signature invalid/.test(e)));
  });

  it("fails closed when the pinned key set is empty", () => {
    const k = keyPair();
    const signed = signReleaseManifest(base(), k.privatePem);
    const r = verifyReleaseManifest(signed, undefined, {
      trustedKeys: [],
      requirePinnedKey: true,
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /no pinned release keys/.test(e)));
  });

  it("honours revocation and validity windows on pinned keys", () => {
    const k = keyPair();
    const signed = signReleaseManifest(base(), k.privatePem);
    const revoked = verifyReleaseManifest(signed, undefined, {
      trustedKeys: [{ keyId: "r", publicKeyPem: k.publicPem, revoked: true }],
      requirePinnedKey: true,
    });
    assert.ok(revoked.errors.some((e) => /revoked/.test(e)));

    const expired = verifyReleaseManifest(signed, undefined, {
      trustedKeys: [
        { keyId: "e", publicKeyPem: k.publicPem, validTo: "2026-01-01T00:00:00.000Z" },
      ],
      requirePinnedKey: true,
    });
    assert.ok(expired.errors.some((e) => /expired/.test(e)));

    const notYet = verifyReleaseManifest(signed, undefined, {
      trustedKeys: [
        { keyId: "n", publicKeyPem: k.publicPem, validFrom: "2027-01-01T00:00:00.000Z" },
      ],
      requirePinnedKey: true,
    });
    assert.ok(notYet.errors.some((e) => /not yet valid/.test(e)));

    const inWindow = verifyReleaseManifest(signed, undefined, {
      trustedKeys: [
        {
          keyId: "w",
          publicKeyPem: k.publicPem,
          validFrom: "2026-01-01T00:00:00.000Z",
          validTo: "2027-01-01T00:00:00.000Z",
        },
      ],
      requirePinnedKey: true,
    });
    assert.equal(inWindow.ok, true);
  });

  it("requires every computed expectation in strict mode", () => {
    const k = keyPair();
    const signed = signReleaseManifest(base(), k.privatePem);
    const r = verifyReleaseManifest(
      signed,
      { sourceCommit: "abc123" },
      {
        trustedKeys: [{ keyId: "k", publicKeyPem: k.publicPem }],
        requirePinnedKey: true,
        requireExpectations: true,
      },
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /missing computed expectation: packageHash/.test(e)));
    assert.ok(r.errors.some((e) => /missing computed expectation: dependenciesHash/.test(e)));
    assert.ok(!r.errors.some((e) => /missing computed expectation: sourceCommit/.test(e)));
  });

  it("parses the pinned key file and rejects malformed entries", () => {
    const k = keyPair();
    const parsed = parseTrustedReleaseKeys({
      schemaVersion: 1,
      keys: [{ keyId: "a", publicKeyPem: k.publicPem, revoked: "yes" }],
    });
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.revoked, false);
    assert.throws(() => parseTrustedReleaseKeys({ schemaVersion: 2, keys: [] }), /schemaVersion/);
    assert.throws(
      () => parseTrustedReleaseKeys({ schemaVersion: 1, keys: [{ publicKeyPem: k.publicPem }] }),
      /keyId/,
    );
    assert.throws(
      () =>
        parseTrustedReleaseKeys({
          schemaVersion: 1,
          keys: [{ keyId: "bad", publicKeyPem: "-----BEGIN PUBLIC KEY-----\nnope\n-----END PUBLIC KEY-----" }],
        }),
    );
    assert.match(publicKeyFingerprint(k.publicPem), /^[0-9a-f]{64}$/);
  });
});

describe("release manifest — expectations computed from checkout (F11)", () => {
  const root = mkdtempSync(join(tmpdir(), "fpp-rel-exp-"));
  after(() => rmSync(root, { recursive: true, force: true }));

  function scaffold(opts: { depVersion: string; src: string }) {
    mkdirSync(join(root, "pkg", "src"), { recursive: true });
    mkdirSync(join(root, "test", "fixtures"), { recursive: true });
    writeFileSync(
      join(root, "pkg", "package.json"),
      JSON.stringify({
        name: "@x/pkg",
        version: "1.2.3",
        engines: { node: ">=22.19" },
        dependencies: { left: opts.depVersion },
        devDependencies: { ignored: "0.0.0" },
      }),
    );
    writeFileSync(join(root, "pkg", "src", "index.ts"), opts.src);
    writeFileSync(join(root, "package-lock.json"), '{"lockfileVersion":3}');
    writeFileSync(join(root, "test", "fixtures", "classifier-adversarial.json"), "[]");
    writeFileSync(join(root, "test", "fixtures", "classifier-benign.json"), "[]");
  }
  const tracked = ["pkg/package.json", "pkg/src/index.ts"];

  it("derives deterministic expectations and reacts to content changes", () => {
    scaffold({ depVersion: "^1.0.0", src: "export const a = 1;" });
    const first = computeReleaseExpectations({
      repoRoot: root,
      packageDir: "pkg",
      sourceCommit: "feedface",
      trackedFiles: tracked,
    });
    assert.equal(first.packageName, "@x/pkg");
    assert.equal(first.packageVersion, "1.2.3");
    assert.equal(first.supportedRuntime, "node>=22.19");
    assert.equal(first.sourceCommit, "feedface");
    for (const h of [first.packageHash, first.lockfileHash, first.testCorpusHash, first.dependenciesHash]) {
      assert.match(h, /^[0-9a-f]{64}$/);
    }

    const again = computeReleaseExpectations({
      repoRoot: root,
      packageDir: "pkg",
      sourceCommit: "feedface",
      trackedFiles: [...tracked].reverse(),
    });
    assert.deepEqual(again, first);

    scaffold({ depVersion: "^1.0.0", src: "export const a = 2;" });
    const srcChanged = computeReleaseExpectations({
      repoRoot: root,
      packageDir: "pkg",
      sourceCommit: "feedface",
      trackedFiles: tracked,
    });
    assert.notEqual(srcChanged.packageHash, first.packageHash);
    assert.equal(srcChanged.dependenciesHash, first.dependenciesHash);

    scaffold({ depVersion: "^2.0.0", src: "export const a = 2;" });
    const depChanged = computeReleaseExpectations({
      repoRoot: root,
      packageDir: "pkg",
      sourceCommit: "feedface",
      trackedFiles: tracked,
    });
    assert.notEqual(depChanged.dependenciesHash, first.dependenciesHash);
  });

  it("end-to-end: manifest built from expectations verifies; a drifted checkout does not", () => {
    scaffold({ depVersion: "^1.0.0", src: "export const a = 1;" });
    const exp = computeReleaseExpectations({
      repoRoot: root,
      packageDir: "pkg",
      sourceCommit: "feedface",
      trackedFiles: tracked,
    });
    const k = keyPair();
    const signed = signReleaseManifest(
      buildReleaseManifest({ ...exp, constitutionHash: "c".repeat(64) }),
      k.privatePem,
    );
    const ok = verifyReleaseManifest(signed, exp, {
      trustedKeys: [{ keyId: "k", publicKeyPem: k.publicPem }],
      requirePinnedKey: true,
      requireExpectations: true,
    });
    assert.deepEqual(ok.errors, []);

    scaffold({ depVersion: "^1.0.0", src: "export const a = 'tampered';" });
    const drifted = computeReleaseExpectations({
      repoRoot: root,
      packageDir: "pkg",
      sourceCommit: "feedface",
      trackedFiles: tracked,
    });
    const bad = verifyReleaseManifest(signed, drifted, {
      trustedKeys: [{ keyId: "k", publicKeyPem: k.publicPem }],
      requirePinnedKey: true,
      requireExpectations: true,
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => /packageHash mismatch/.test(e)));
  });
});
