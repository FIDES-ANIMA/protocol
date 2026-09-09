/**
 * Heuristic reversibility table for staged-allow decisions.
 * Irreversible / high-impact classes must not take the staged path.
 *
 * Destructive classes listed in `REQUIRES_RECOVERY_PROOF` are only reversible
 * when the harness adapter has produced a concrete recovery artifact
 * (snapshot / trash transaction) for the specific action — see
 * `FppRuntimeAdapter.recoveryProvider`. Without such proof the runtime treats
 * them as irreversible and they cannot receive unattended staged authorization.
 */

import type { ClassificationId } from "./risk-classifier.js";

const REVERSIBLE: ReadonlySet<ClassificationId> = new Set([
  "fs.write.workspace",
  "fs.delete.workspace",
  "fs.read.benign",
  "http.read",
  "http.public-read",
  "fpp.governance",
  "internal.heartbeat",
  "internal.read",
  "gateway.inspect",
]);

const REQUIRES_RECOVERY_PROOF: ReadonlySet<ClassificationId> = new Set([
  "fs.delete.workspace",
]);

export function isReversibleClassification(id: ClassificationId): boolean {
  return REVERSIBLE.has(id);
}

/**
 * True when a classification is only reversible given adapter-proven recovery
 * (e.g. a pre-delete snapshot). Callers must not stage such actions without it.
 */
export function requiresRecoveryProof(id: ClassificationId): boolean {
  return REQUIRES_RECOVERY_PROOF.has(id);
}
