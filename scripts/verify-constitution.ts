import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { sha256 } from "@noble/hashes/sha256";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "..");

/** SHA-256 of the signed CRLF bytes of constitution.json. The seed hash does not move. */
export const SEED_CONSTITUTION_HASH =
  "71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993";

export type VerifyConstitutionResult = {
  hash: string;
  publicKey: string;
  hashMatchesSeed: boolean;
  signatureValid: boolean;
  lineEndingHint: boolean;
};

function toCrlf(bytes: Uint8Array): Uint8Array {
  const lf = Buffer.from(bytes).toString("binary").replace(/\r\n/g, "\n");
  return Buffer.from(lf.replace(/\n/g, "\r\n"), "binary");
}

export function verifyConstitution(rootDir = DEFAULT_ROOT): VerifyConstitutionResult {
  const constitutionBytes = readFileSync(resolve(rootDir, "constitution.json"));
  const hash = sha256(constitutionBytes);
  const hashHex = bytesToHex(hash);

  const signatureHex = readFileSync(resolve(rootDir, "signature.ed25519.txt"), "utf-8").trim();
  const publicKey = readFileSync(resolve(rootDir, "pubkey.ed25519.txt"), "utf-8").trim();

  const signatureValid = ed.verify(hexToBytes(signatureHex), hash, hexToBytes(publicKey));
  const hashMatchesSeed = hashHex === SEED_CONSTITUTION_HASH;
  const lineEndingHint =
    !hashMatchesSeed && bytesToHex(sha256(toCrlf(constitutionBytes))) === SEED_CONSTITUTION_HASH;

  return { hash: hashHex, publicKey, hashMatchesSeed, signatureValid, lineEndingHint };
}

function reportAndExit(result: VerifyConstitutionResult): void {
  console.log(`Constitution SHA-256: ${result.hash}`);
  console.log(`Public key:           ${result.publicKey}`);
  console.log(`Signature valid:      ${result.signatureValid ? "YES" : "NO"}`);

  if (!result.hashMatchesSeed || !result.signatureValid) {
    console.error("\nWARNING: Signature verification FAILED.");
    if (!result.hashMatchesSeed) {
      console.error(`Expected seed hash:   ${SEED_CONSTITUTION_HASH}`);
      console.error(`Got:                  ${result.hash}`);
    }
    if (result.lineEndingHint) {
      console.error(
        "Hint: line endings differ from the signed seed (CRLF). " +
          "constitution.json must be checked out with CRLF (see .gitattributes).",
      );
    }
    console.error("The constitution.json may have been tampered with.");
    console.error("Do NOT adopt this constitution.");
    process.exit(1);
  }

  console.log("\nConstitution integrity verified. Safe to adopt.");
}

function isDirectInvocation(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectInvocation()) {
  try {
    reportAndExit(verifyConstitution());
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      const path = "path" in err && typeof err.path === "string" ? err.path : undefined;
      console.error(`Missing file: ${path}`);
      console.error('Run "npm run sign" first to generate signature and public key.');
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Verification failed:", message);
    }
    process.exit(1);
  }
}
