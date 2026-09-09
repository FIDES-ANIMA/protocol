#!/usr/bin/env tsx
/**
 * Verify a signed release manifest before publish (audit F11).
 *
 * Strict by default:
 *   - the signer MUST be one of the independently pinned release keys in
 *     `assurance-artifacts/release-signing-keys.json` (or `--trusted-keys`);
 *   - every provenance field MUST match values computed from this checkout
 *     (`--package <dir>` selects the package the manifest attests).
 *
 * `--self-attested` and `--no-expectations` exist for local inspection only and
 * print a loud warning; the publish gate never passes them.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_TRUSTED_KEYS_PATH,
  computeReleaseExpectations,
  readReleaseManifest,
  readTrustedReleaseKeys,
  verifyReleaseManifest,
  type ReleaseExpectations,
  type ReleaseVerifyResult,
  type TrustedReleaseKey,
} from "./release-manifest.ts";

export {
  verifyReleaseManifest,
  readReleaseManifest,
  readTrustedReleaseKeys,
  computeReleaseExpectations,
  type ReleaseVerifyResult,
};

export type VerifyCliOptions = {
  manifestPath: string;
  repoRoot: string;
  packageDir?: string | undefined;
  trustedKeysPath?: string | undefined;
  selfAttested?: boolean | undefined;
  noExpectations?: boolean | undefined;
  constitutionHash?: string | undefined;
};

/** Full anchored verification as run by the publish gate. */
export function verifyReleaseFromCheckout(opts: VerifyCliOptions): ReleaseVerifyResult {
  const manifest = readReleaseManifest(resolve(opts.manifestPath));

  let trustedKeys: readonly TrustedReleaseKey[] | undefined;
  if (!opts.selfAttested) {
    trustedKeys = readTrustedReleaseKeys(
      resolve(opts.repoRoot, opts.trustedKeysPath ?? DEFAULT_TRUSTED_KEYS_PATH),
    );
  }

  let expectations: ReleaseExpectations | undefined;
  if (!opts.noExpectations) {
    const packageDir =
      opts.packageDir ?? inferPackageDir(opts.repoRoot, manifest.packageName);
    expectations = {
      ...computeReleaseExpectations({ repoRoot: opts.repoRoot, packageDir }),
      constitutionHash: opts.constitutionHash,
    };
  }

  return verifyReleaseManifest(manifest, expectations, {
    trustedKeys,
    requirePinnedKey: !opts.selfAttested,
    requireExpectations: !opts.noExpectations,
  });
}

/**
 * Map a published package name to its workspace directory via root package.json.
 * Supports literal workspace paths and a single trailing `/*` segment.
 */
export function inferPackageDir(repoRoot: string, packageName: string): string {
  const root = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
    workspaces?: string[];
  };
  const candidates: string[] = [];
  for (const pattern of root.workspaces ?? []) {
    if (pattern.endsWith("/*")) {
      const parent = resolve(repoRoot, pattern.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(join(pattern.slice(0, -2), entry.name));
      }
    } else {
      candidates.push(pattern);
    }
  }
  for (const dir of candidates) {
    const pkgPath = resolve(repoRoot, dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
    if (pkg.name === packageName) return dir;
  }
  throw new Error(
    `cannot locate workspace for ${packageName}; pass --package <dir> explicitly`,
  );
}

function main() {
  const args = process.argv.slice(2);
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const opts: VerifyCliOptions = {
    manifestPath: "assurance-artifacts/release-manifest.json",
    repoRoot,
  };
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--manifest") opts.manifestPath = args[++i]!;
    else if (a === "--package") opts.packageDir = args[++i];
    else if (a === "--trusted-keys") opts.trustedKeysPath = args[++i];
    else if (a === "--constitution-hash") opts.constitutionHash = args[++i];
    else if (a === "--self-attested") opts.selfAttested = true;
    else if (a === "--no-expectations") opts.noExpectations = true;
    else if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: npm run release:verify -- [--manifest <path>] [--package <dir>]",
          "         [--trusted-keys <path>] [--constitution-hash <hex>] [--json]",
          "         [--self-attested] [--no-expectations]   (inspection only; never for publish)",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  if (opts.selfAttested || opts.noExpectations) {
    console.error(
      "WARNING: verification is NOT anchored (self-attested key and/or no checkout expectations). Do not publish on this result.",
    );
  }

  let report: ReleaseVerifyResult;
  try {
    report = verifyReleaseFromCheckout(opts);
  } catch (err) {
    report = { ok: false, errors: [(err as Error).message], manifestDigest: "" };
  }
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Release manifest: ${opts.manifestPath}`);
    if (report.signerKeyId) console.log(`Pinned signer:    ${report.signerKeyId}`);
    if (report.manifestDigest) console.log(`Manifest digest:  ${report.manifestDigest}`);
    console.log(report.ok ? "OK" : "FAILED");
    for (const e of report.errors) console.error(`  - ${e}`);
  }
  process.exit(report.ok ? 0 : 1);
}

const isDirect =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirect) main();
