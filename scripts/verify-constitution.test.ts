/**
 * Seed-hash and signature pin for constitution.json.
 *
 * The published seed is SHA-256 of the CRLF serialization. A Linux checkout
 * without .gitattributes `eol=crlf` hashes as LF and must not be treated as
 * the seed.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

import {
  SEED_CONSTITUTION_HASH,
  verifyConstitution,
} from "./verify-constitution.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

describe("verify-constitution seed pin", () => {
  const temps: string[] = [];

  after(() => {
    for (const dir of temps) {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("pins constitution.json to CRLF in .gitattributes", () => {
    const attrs = readFileSync(join(ROOT, ".gitattributes"), "utf-8");
    assert.match(attrs, /^constitution\.json\s+text\s+eol=crlf\s*$/m);
  });

  it("working-tree constitution.json is CRLF and matches the published seed hash", () => {
    const bytes = readFileSync(join(ROOT, "constitution.json"));
    assert.ok(
      bytes.includes(0x0d),
      "constitution.json must be checked out as CRLF (see .gitattributes)",
    );
    assert.equal(bytesToHex(sha256(bytes)), SEED_CONSTITUTION_HASH);
  });

  it("LF-normalized bytes are not the seed", () => {
    const crlf = readFileSync(join(ROOT, "constitution.json"));
    const lf = Buffer.from(crlf.toString("binary").replace(/\r\n/g, "\n"), "binary");
    assert.notEqual(bytesToHex(sha256(lf)), SEED_CONSTITUTION_HASH);
    assert.equal(
      bytesToHex(sha256(lf)),
      "bc764d3c58405a9ad3825574fc34edafce673d968c35b6442bf0ce2d904aae83",
    );
  });

  it("verifies the committed signature over the seed hash", () => {
    const result = verifyConstitution(ROOT);
    assert.equal(result.hash, SEED_CONSTITUTION_HASH);
    assert.equal(result.hashMatchesSeed, true);
    assert.equal(result.signatureValid, true);
    assert.equal(result.lineEndingHint, false);
    assert.match(result.publicKey, /^[0-9a-f]{64}$/);
  });

  it("fails closed when the working-tree hash is LF instead of the seed", () => {
    const dir = mkdtempSync(join(tmpdir(), "fpp-verify-lf-"));
    temps.push(dir);
    const crlf = readFileSync(join(ROOT, "constitution.json"));
    const lf = Buffer.from(crlf.toString("binary").replace(/\r\n/g, "\n"), "binary");
    writeFileSync(join(dir, "constitution.json"), lf);
    copyFileSync(join(ROOT, "signature.ed25519.txt"), join(dir, "signature.ed25519.txt"));
    copyFileSync(join(ROOT, "pubkey.ed25519.txt"), join(dir, "pubkey.ed25519.txt"));

    const result = verifyConstitution(dir);
    assert.equal(result.hashMatchesSeed, false);
    assert.equal(result.signatureValid, false);
    assert.equal(result.lineEndingHint, true);
    assert.equal(result.hash, "bc764d3c58405a9ad3825574fc34edafce673d968c35b6442bf0ce2d904aae83");
  });
});
