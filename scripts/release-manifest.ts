/**
 * Signed release manifest generation + verification (Plan 6 Task 10).
 *
 * Signing domain: release — must not reuse constitution-root or agent-identity keys.
 *
 * Verification is anchored two ways (audit F11):
 *   1. The signer must be one of the *independently pinned* release keys
 *      (`assurance-artifacts/release-signing-keys.json`). The `publicKeyPem`
 *      embedded in the manifest is a hint only; the signature is checked
 *      against the pinned key, so a manifest cannot vouch for itself.
 *   2. Every provenance field (commit, package, lockfile, corpus, runtime,
 *      dependencies) is compared against values *computed from the checkout*,
 *      not merely for internal consistency.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIGEST_DOMAINS, canonicalizeV2, digest } from "@fides-anima/fpp-protocol-core";

export const RELEASE_SIGNING_DOMAIN = "fpp:v2:release-manifest" as const;

/** Default location of the pinned release-signing keys. */
export const DEFAULT_TRUSTED_KEYS_PATH =
  "assurance-artifacts/release-signing-keys.json" as const;

/** Classifier corpus fixtures covered by `testCorpusHash`. */
export const RELEASE_CORPUS_FILES = [
  "test/fixtures/classifier-adversarial.json",
  "test/fixtures/classifier-benign.json",
] as const;

export type TrustedReleaseKey = {
  /** Operator-chosen label, e.g. "release-2026-q3". */
  keyId: string;
  publicKeyPem: string;
  /** ISO timestamps bounding when manifests signed by this key are accepted. */
  validFrom?: string | undefined;
  validTo?: string | undefined;
  revoked?: boolean | undefined;
};

export type TrustedReleaseKeysFile = {
  schemaVersion: 1;
  keys: TrustedReleaseKey[];
};

export type ReleaseManifestV1 = {
  schemaVersion: 1;
  signingDomain: typeof RELEASE_SIGNING_DOMAIN;
  sourceCommit: string;
  constitutionHash: string;
  packageName: string;
  packageVersion: string;
  packageHash: string;
  lockfileHash: string;
  testCorpusHash: string;
  supportedRuntime: string;
  dependenciesHash: string;
  policyVersion?: string | undefined;
  issuedAt: string;
  publicKeyPem?: string | undefined;
  signature?: string | undefined;
};

export function sha256File(path: string): string {
  const buf = readFileSync(path);
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function buildReleaseManifest(input: {
  sourceCommit: string;
  constitutionHash: string;
  packageName: string;
  packageVersion: string;
  packageHash: string;
  lockfileHash: string;
  testCorpusHash: string;
  supportedRuntime: string;
  dependenciesHash: string;
  policyVersion?: string | undefined;
  issuedAt?: string | undefined;
}): ReleaseManifestV1 {
  return {
    schemaVersion: 1,
    signingDomain: RELEASE_SIGNING_DOMAIN,
    sourceCommit: input.sourceCommit,
    constitutionHash: input.constitutionHash,
    packageName: input.packageName,
    packageVersion: input.packageVersion,
    packageHash: input.packageHash,
    lockfileHash: input.lockfileHash,
    testCorpusHash: input.testCorpusHash,
    supportedRuntime: input.supportedRuntime,
    dependenciesHash: input.dependenciesHash,
    policyVersion: input.policyVersion,
    issuedAt: input.issuedAt ?? new Date().toISOString(),
  };
}

function unsignedFields(m: ReleaseManifestV1): Record<string, unknown> {
  const { signature: _s, publicKeyPem: _p, ...rest } = m;
  void _s;
  void _p;
  return rest;
}

export function signReleaseManifest(
  manifest: ReleaseManifestV1,
  privateKeyPem: string,
): ReleaseManifestV1 {
  if (manifest.signingDomain !== RELEASE_SIGNING_DOMAIN) {
    throw new Error("wrong signing domain for release manifest");
  }
  const key = createPrivateKey(privateKeyPem);
  const pub = createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
  const payload = canonicalizeV2(unsignedFields(manifest));
  const signature = sign(null, Buffer.from(payload), key).toString("base64");
  return { ...manifest, publicKeyPem: pub, signature };
}

export type ReleaseVerifyResult = {
  ok: boolean;
  errors: string[];
  /** Pinned key that authenticated the manifest, when anchored. */
  signerKeyId?: string | undefined;
  /** Domain-separated digest of the signed body for external anchoring. */
  manifestDigest: string;
};

export type ReleaseExpectations = Partial<{
  sourceCommit: string;
  packageName: string;
  packageVersion: string;
  packageHash: string;
  lockfileHash: string;
  testCorpusHash: string;
  supportedRuntime: string;
  dependenciesHash: string;
  constitutionHash: string;
  minNodeMajor: number;
}>;

/** Fields a strict (publish-gate) verification must have expectations for. */
export const REQUIRED_RELEASE_EXPECTATIONS = [
  "sourceCommit",
  "packageName",
  "packageVersion",
  "packageHash",
  "lockfileHash",
  "testCorpusHash",
  "supportedRuntime",
  "dependenciesHash",
] as const satisfies readonly (keyof ReleaseExpectations)[];

export type VerifyReleaseOptions = {
  /**
   * Independently pinned release keys. When supplied, the signature is
   * verified against the matching pinned key and the embedded key is only
   * used to select it. Required when `requirePinnedKey` is true.
   */
  trustedKeys?: readonly TrustedReleaseKey[] | undefined;
  /** Fail unless the signer is one of `trustedKeys`. Default false (legacy). */
  requirePinnedKey?: boolean | undefined;
  /** Fail unless every `REQUIRED_RELEASE_EXPECTATIONS` field was supplied. */
  requireExpectations?: boolean | undefined;
  /** Evaluate key validity windows at this instant (default: manifest.issuedAt). */
  nowIso?: string | undefined;
};

/** SHA-256 over the SPKI DER encoding — stable identity for a public key. */
export function publicKeyFingerprint(pem: string | KeyObject): string {
  const key = typeof pem === "string" ? createPublicKey(pem) : pem;
  const der = key.export({ type: "spki", format: "der" }) as Buffer;
  return createHash("sha256").update(der).digest("hex");
}

function selectTrustedKey(
  manifest: ReleaseManifestV1,
  trustedKeys: readonly TrustedReleaseKey[],
  nowMs: number,
  errors: string[],
): TrustedReleaseKey | undefined {
  if (!manifest.publicKeyPem) return undefined;
  let embedded: string;
  try {
    embedded = publicKeyFingerprint(manifest.publicKeyPem);
  } catch (err) {
    errors.push(`embedded public key unparseable: ${(err as Error).message}`);
    return undefined;
  }
  for (const candidate of trustedKeys) {
    let fp: string;
    try {
      fp = publicKeyFingerprint(candidate.publicKeyPem);
    } catch {
      continue;
    }
    if (fp !== embedded) continue;
    if (candidate.revoked === true) {
      errors.push(`signer key ${candidate.keyId} is revoked`);
      return undefined;
    }
    const from = candidate.validFrom ? Date.parse(candidate.validFrom) : NaN;
    const to = candidate.validTo ? Date.parse(candidate.validTo) : NaN;
    if (!Number.isNaN(from) && nowMs < from) {
      errors.push(`signer key ${candidate.keyId} not yet valid`);
      return undefined;
    }
    if (!Number.isNaN(to) && nowMs > to) {
      errors.push(`signer key ${candidate.keyId} expired`);
      return undefined;
    }
    return candidate;
  }
  errors.push("signer key is not a pinned release key");
  return undefined;
}

export function verifyReleaseManifest(
  manifest: ReleaseManifestV1,
  expectations?: ReleaseExpectations,
  options: VerifyReleaseOptions = {},
): ReleaseVerifyResult {
  const errors: string[] = [];
  const manifestDigest = digest({
    version: 2,
    domain: DIGEST_DOMAINS.evidence,
    value: { kind: RELEASE_SIGNING_DOMAIN, body: unsignedFields(manifest) },
  });
  let signerKeyId: string | undefined;

  if (manifest.signingDomain !== RELEASE_SIGNING_DOMAIN) {
    errors.push("wrong signing domain");
  }

  if (!manifest.signature || !manifest.publicKeyPem) {
    errors.push("missing signature or public key");
  } else {
    // Anchor: which key are we allowed to trust?
    let verifyWithPem: string | undefined = manifest.publicKeyPem;
    if (options.trustedKeys !== undefined || options.requirePinnedKey) {
      const trusted = options.trustedKeys ?? [];
      if (trusted.length === 0) {
        errors.push("no pinned release keys available; refusing self-attested manifest");
        verifyWithPem = undefined;
      } else {
        const nowMs = Date.parse(options.nowIso ?? manifest.issuedAt);
        const selected = selectTrustedKey(
          manifest,
          trusted,
          Number.isNaN(nowMs) ? Date.now() : nowMs,
          errors,
        );
        verifyWithPem = selected?.publicKeyPem;
        signerKeyId = selected?.keyId;
      }
    }
    if (verifyWithPem) {
      try {
        const key = createPublicKey(verifyWithPem);
        const payload = canonicalizeV2(unsignedFields(manifest));
        const ok = verify(
          null,
          Buffer.from(payload),
          key,
          Buffer.from(manifest.signature, "base64"),
        );
        if (!ok) errors.push("signature invalid");
      } catch (err) {
        errors.push(`signature check failed: ${(err as Error).message}`);
      }
    }
  }

  if (options.requireExpectations) {
    for (const field of REQUIRED_RELEASE_EXPECTATIONS) {
      if (expectations?.[field] === undefined || expectations[field] === "") {
        errors.push(`missing computed expectation: ${field}`);
      }
    }
  }

  const compare = (
    field: keyof ReleaseManifestV1 & keyof ReleaseExpectations,
    message: string,
  ) => {
    const expected = expectations?.[field];
    if (expected !== undefined && expected !== manifest[field]) {
      errors.push(message);
    }
  };
  compare("sourceCommit", "sourceCommit mismatch");
  compare("packageName", "packageName mismatch");
  compare("packageVersion", "packageVersion mismatch");
  compare("packageHash", "packageHash mismatch (tamper)");
  compare("lockfileHash", "lockfileHash stale/mismatch");
  compare("testCorpusHash", "testCorpusHash mismatch");
  compare("supportedRuntime", "unsupported runtime");
  compare("dependenciesHash", "dependenciesHash mismatch");
  compare("constitutionHash", "constitutionHash mismatch");

  if (expectations?.minNodeMajor !== undefined) {
    const m = /node\s*>=?\s*(\d+)/i.exec(manifest.supportedRuntime);
    const major = m ? Number(m[1]) : NaN;
    if (!Number.isFinite(major) || major < expectations.minNodeMajor) {
      errors.push("unsupported runtime major");
    }
  }

  return { ok: errors.length === 0, errors, signerKeyId, manifestDigest };
}

// ---------------------------------------------------------------------------
// Pinned keys
// ---------------------------------------------------------------------------

export function parseTrustedReleaseKeys(raw: unknown): TrustedReleaseKey[] {
  if (!raw || typeof raw !== "object") {
    throw new Error("trusted release keys: root must be an object");
  }
  const file = raw as Partial<TrustedReleaseKeysFile>;
  if (file.schemaVersion !== 1 || !Array.isArray(file.keys)) {
    throw new Error("trusted release keys: expected { schemaVersion: 1, keys: [] }");
  }
  const out: TrustedReleaseKey[] = [];
  for (const [i, k] of file.keys.entries()) {
    if (!k || typeof k !== "object") {
      throw new Error(`trusted release keys: keys[${i}] is not an object`);
    }
    const key = k as Record<string, unknown>;
    if (typeof key.keyId !== "string" || key.keyId.trim() === "") {
      throw new Error(`trusted release keys: keys[${i}].keyId missing`);
    }
    if (typeof key.publicKeyPem !== "string") {
      throw new Error(`trusted release keys: keys[${i}].publicKeyPem missing`);
    }
    // Fail loudly on malformed PEM rather than silently never matching.
    publicKeyFingerprint(key.publicKeyPem);
    out.push({
      keyId: key.keyId,
      publicKeyPem: key.publicKeyPem,
      validFrom: typeof key.validFrom === "string" ? key.validFrom : undefined,
      validTo: typeof key.validTo === "string" ? key.validTo : undefined,
      revoked: key.revoked === true,
    });
  }
  return out;
}

export function readTrustedReleaseKeys(path: string): TrustedReleaseKey[] {
  if (!existsSync(path)) {
    throw new Error(`pinned release keys not found: ${path}`);
  }
  return parseTrustedReleaseKeys(JSON.parse(readFileSync(path, "utf8")));
}

// ---------------------------------------------------------------------------
// Expectations computed from the checkout
// ---------------------------------------------------------------------------

export type ComputeExpectationsInput = {
  repoRoot: string;
  /** Package directory whose contents/metadata the manifest attests. */
  packageDir: string;
  /** Override `git rev-parse HEAD` (tests / detached builds). */
  sourceCommit?: string | undefined;
  /** Override the tracked-file list (tests without git). */
  trackedFiles?: readonly string[] | undefined;
};

export type ComputedReleaseExpectations = Required<
  Pick<
    ReleaseExpectations,
    | "sourceCommit"
    | "packageName"
    | "packageVersion"
    | "packageHash"
    | "lockfileHash"
    | "testCorpusHash"
    | "supportedRuntime"
    | "dependenciesHash"
  >
>;

function gitTrackedFiles(repoRoot: string, dir: string): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", dir], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return out.split("\0").filter((p) => p.length > 0);
}

function gitHead(repoRoot: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

/** Deterministic content hash over a sorted list of (path, bytes) pairs. */
export function hashFileSet(repoRoot: string, relPaths: readonly string[]): string {
  const h = createHash("sha256");
  const sorted = [...relPaths].map((p) => p.replace(/\\/g, "/")).sort();
  for (const rel of sorted) {
    const abs = resolve(repoRoot, rel);
    if (!existsSync(abs)) continue;
    const body = readFileSync(abs);
    h.update(`${rel}\0${body.length}\0`);
    h.update(body);
    h.update("\n");
  }
  return h.digest("hex");
}

export function dependenciesHashFor(pkg: Record<string, unknown>): string {
  const pick = (k: string) =>
    pkg[k] && typeof pkg[k] === "object" ? (pkg[k] as Record<string, unknown>) : {};
  return sha256Text(
    canonicalizeV2({
      dependencies: pick("dependencies"),
      peerDependencies: pick("peerDependencies"),
      optionalDependencies: pick("optionalDependencies"),
      bundleDependencies: pkg.bundleDependencies ?? pkg.bundledDependencies ?? [],
    }),
  );
}

export function supportedRuntimeFor(pkg: Record<string, unknown>): string {
  const engines = pkg.engines as Record<string, unknown> | undefined;
  const node = typeof engines?.node === "string" ? engines.node.trim() : "";
  if (!node) throw new Error("package.json engines.node is required for release manifests");
  return `node${node}`;
}

/**
 * Compute what a manifest for `packageDir` at the current checkout *must* say.
 * The package hash covers every git-tracked file under the package (source,
 * manifest, README), independent of any npm pack step.
 */
export function computeReleaseExpectations(
  input: ComputeExpectationsInput,
): ComputedReleaseExpectations {
  const repoRoot = resolve(input.repoRoot);
  const packageDir = resolve(repoRoot, input.packageDir);
  const relPackageDir = relative(repoRoot, packageDir).replace(/\\/g, "/");
  const pkgPath = join(packageDir, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found under ${packageDir}`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  if (typeof pkg.name !== "string" || typeof pkg.version !== "string") {
    throw new Error(`package.json under ${packageDir} lacks name/version`);
  }
  const tracked =
    input.trackedFiles ?? gitTrackedFiles(repoRoot, relPackageDir || ".");
  const lockfile = join(repoRoot, "package-lock.json");
  return {
    sourceCommit: input.sourceCommit ?? gitHead(repoRoot),
    packageName: pkg.name,
    packageVersion: pkg.version,
    packageHash: hashFileSet(repoRoot, tracked),
    lockfileHash: existsSync(lockfile) ? sha256File(lockfile) : sha256Text(""),
    testCorpusHash: hashFileSet(repoRoot, RELEASE_CORPUS_FILES),
    supportedRuntime: supportedRuntimeFor(pkg),
    dependenciesHash: dependenciesHashFor(pkg),
  };
}

export function writeReleaseManifest(path: string, manifest: ReleaseManifestV1): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), JSON.stringify(manifest, null, 2) + "\n");
}

export function readReleaseManifest(path: string): ReleaseManifestV1 {
  if (!existsSync(path)) throw new Error(`release manifest not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as ReleaseManifestV1;
}

// ---------------------------------------------------------------------------
// CLI: npm run release:manifest -- --package <dir> --key <pkcs8.pem> [--out <path>]
// ---------------------------------------------------------------------------

function usage(): never {
  console.log(
    [
      "Usage: npm run release:manifest -- --package <dir> --key <private-key.pem>",
      "         [--out assurance-artifacts/release-manifest.json]",
      "         [--constitution-hash <hex>] [--policy-version <v>] [--source-commit <sha>]",
      "",
      "Computes commit / package / lockfile / corpus / runtime / dependency",
      "expectations from the checkout and signs them with the release key.",
      "The signing key must be a dedicated release key (never the constitution",
      "root or an agent identity key) and its public half must be pinned in",
      `${DEFAULT_TRUSTED_KEYS_PATH} for release:verify to accept the manifest.`,
    ].join("\n"),
  );
  process.exit(0);
}

function main(): void {
  const args = process.argv.slice(2);
  let packageDir: string | undefined;
  let keyPath: string | undefined;
  let out = "assurance-artifacts/release-manifest.json";
  let constitutionHash: string | undefined;
  let policyVersion: string | undefined;
  let sourceCommit: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--package") packageDir = args[++i];
    else if (a === "--key") keyPath = args[++i];
    else if (a === "--out") out = args[++i] ?? out;
    else if (a === "--constitution-hash") constitutionHash = args[++i];
    else if (a === "--policy-version") policyVersion = args[++i];
    else if (a === "--source-commit") sourceCommit = args[++i];
    else if (a === "--help" || a === "-h") usage();
  }
  if (!packageDir || !keyPath) usage();
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const expectations = computeReleaseExpectations({
    repoRoot,
    packageDir: packageDir!,
    sourceCommit,
  });
  const privateKeyPem = readFileSync(resolve(keyPath!), "utf8");
  const manifest = signReleaseManifest(
    buildReleaseManifest({
      ...expectations,
      constitutionHash: constitutionHash ?? "",
      policyVersion,
    }),
    privateKeyPem,
  );
  writeReleaseManifest(resolve(repoRoot, out), manifest);
  console.log(`Release manifest written: ${out}`);
  console.log(`Signer fingerprint (pin this): ${publicKeyFingerprint(manifest.publicKeyPem!)}`);
}

const isDirect =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirect) main();
