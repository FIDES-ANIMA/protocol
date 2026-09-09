/**
 * File-backed standing mandate store with budget debit and standing-allowlist
 * materialization. Signed mandates are verified; standing-allowlist coverage
 * is explicitly unsigned and never claims peer/quorum authorization.
 *
 * Mutable budget / revoke state lives in an unsigned `ledgers` map so debit
 * and revoke never invalidate Ed25519 signatures on the grant blob.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AUTHZ,
  canonicalizeV2,
  mandateSigningFields,
  parseStandingMandate,
  validateMandateValidity,
  verifyMandateSignature,
  type AuthorizationClass,
  type MandateIssuerClass,
  type MandateLedgerEntry,
  type MandateStoreFile,
  type StandingMandateV1,
} from "@fides-anima/fpp-protocol-core";
import type { ClassificationId } from "./risk-classifier.js";
import type { LiveMandateCoverage } from "./disposition-engine.js";
import { withFileLock, writeFileAtomic } from "./file-lock.js";

export type { MandateLedgerEntry, MandateStoreFile };

export type MandateDiagnostic = {
  mandateId: string;
  reason: string;
  kind: "integrity" | "migration";
};

export type MandateStoreOptions = {
  standingAllowOn?: ClassificationId[] | undefined;
  mandateDefaultMaxActions?: number | undefined;
  basePath?: string | undefined;
  onDiagnostic?: ((diag: MandateDiagnostic) => void) | undefined;
};

export type FindCoverageOptions = {
  nowMs: number;
};

function authorizationForIssuer(
  issuerClass: MandateIssuerClass,
): AuthorizationClass {
  switch (issuerClass) {
    case "standing-allowlist":
      return AUTHZ.standingAllowlist;
    case "peer-quorum":
    case "steward-quorum":
      return AUTHZ.quorumMandate;
    case "operator":
    default:
      return AUTHZ.mandate;
  }
}

function assertMandateSignature(mandate: StandingMandateV1): void {
  if (mandate.issuerClass === "standing-allowlist") {
    return;
  }
  if (!mandate.publicKey || !mandate.signature) {
    throw new Error("signed mandate requires publicKey and signature");
  }
  if (!verifyMandateSignature(mandate)) {
    throw new Error("mandate signature verification failed");
  }
}

/**
 * Signed ceiling for a mandate. Signed mandates without `maxActions` fall back
 * to the operator's `mandateDefaultMaxActions` so accounting is always finite.
 * Standing-allowlist entries are unsigned config and carry no per-grant budget.
 */
function signedCeiling(
  mandate: StandingMandateV1,
  defaultMaxActions: number,
): number | null {
  const max = mandate.budgets.maxActions;
  if (max !== undefined) {
    return Number.isInteger(max) && max >= 0 ? max : null;
  }
  if (mandate.issuerClass === "standing-allowlist") return null;
  return Number.isInteger(defaultMaxActions) && defaultMaxActions >= 0
    ? defaultMaxActions
    : null;
}

/**
 * Initialize the unsigned ledger from the *signed* ceiling. The unsigned
 * `remainingActions` may only lower the starting balance — never raise it.
 */
function seedLedgerFromMandate(
  mandate: StandingMandateV1,
  defaultMaxActions: number,
): MandateLedgerEntry {
  const entry: MandateLedgerEntry = {};
  const ceiling = signedCeiling(mandate, defaultMaxActions);
  const incoming = mandate.budgets.remainingActions;
  if (ceiling !== null) {
    entry.remainingActions =
      incoming !== undefined && Number.isInteger(incoming) && incoming >= 0
        ? Math.min(incoming, ceiling)
        : ceiling;
  } else if (incoming !== undefined) {
    entry.remainingActions = incoming;
  }
  if (mandate.revoked === true) {
    entry.revoked = true;
  }
  return entry;
}

/**
 * Effective remaining budget clamped to the signed ceiling.
 * `null` means unlimited (standing-allowlist only); otherwise a finite count.
 */
function effectiveRemaining(
  mandate: StandingMandateV1,
  ledger: MandateLedgerEntry | undefined,
  defaultMaxActions: number,
): number | null {
  const ceiling = signedCeiling(mandate, defaultMaxActions);
  const remaining = ledger?.remainingActions;
  if (ceiling === null) {
    return remaining === undefined ? null : remaining;
  }
  if (remaining === undefined || !Number.isInteger(remaining) || remaining < 0) {
    // Ledger missing/invalid for a signed grant: fail closed to zero.
    return 0;
  }
  return Math.min(remaining, ceiling);
}

function hasBudget(remaining: number | null): boolean {
  return remaining === null || remaining > 0;
}

function signedContentKey(mandate: StandingMandateV1): string {
  return `${canonicalizeV2(mandateSigningFields(mandate))}|${(mandate.signature ?? "").toLowerCase()}`;
}

export class MandateStore {
  readonly path: string;
  private mandates: StandingMandateV1[] = [];
  private ledgers: Record<string, MandateLedgerEntry> = {};
  private readonly standingAllowOn: ClassificationId[];
  private readonly mandateDefaultMaxActions: number;
  private readonly onDiagnostic:
    | ((diag: MandateDiagnostic) => void)
    | undefined;

  constructor(storePath: string, options: MandateStoreOptions = {}) {
    this.path = resolve(options.basePath ?? process.cwd(), storePath);
    this.standingAllowOn = options.standingAllowOn ?? [];
    this.mandateDefaultMaxActions = options.mandateDefaultMaxActions ?? 10;
    this.onDiagnostic = options.onDiagnostic;
    this.reload();
  }

  private emitDiagnostic(diag: MandateDiagnostic): void {
    try {
      this.onDiagnostic?.(diag);
    } catch {
      // Diagnostics must never break coverage / reload.
    }
  }

  reload(): void {
    withFileLock(this.path, () => this.reloadLocked());
  }

  private reloadLocked(): void {
    if (!existsSync(this.path)) {
      this.mandates = [];
      this.ledgers = {};
      return;
    }
    const raw = JSON.parse(readFileSync(this.path, "utf8")) as MandateStoreFile;
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.mandates)) {
      throw new Error(`invalid mandate store at ${this.path}`);
    }
    this.mandates = raw.mandates.map((m) => ({ ...m }));
    this.ledgers = { ...(raw.ledgers ?? {}) };
    let migrated = false;
    for (let i = 0; i < this.mandates.length; i++) {
      const mandate = this.mandates[i]!;
      if (this.tryMigrateBrokenMandate(mandate, i)) {
        migrated = true;
      } else if (this.ledgers[mandate.mandateId] === undefined) {
        // Legacy file without ledgers: seed from signed ceiling so budget still works.
        this.ledgers[mandate.mandateId] = seedLedgerFromMandate(
          mandate,
          this.mandateDefaultMaxActions,
        );
        migrated = true;
      }
    }
    if (migrated) {
      this.persist();
    }
  }

  /**
   * Q4-A: if verify fails and maxActions is set, try restoring remainingActions
   * to maxActions. On success, freeze the signed field and seed the ledger from
   * the prior on-disk remaining value.
   */
  private tryMigrateBrokenMandate(
    mandate: StandingMandateV1,
    index: number,
  ): boolean {
    if (mandate.issuerClass === "standing-allowlist") {
      return false;
    }
    if (verifyMandateSignature(mandate)) {
      return false;
    }
    const maxActions = mandate.budgets.maxActions;
    if (maxActions === undefined) {
      this.emitDiagnostic({
        mandateId: mandate.mandateId,
        reason: "signature verification failed; cannot auto-migrate without maxActions",
        kind: "integrity",
      });
      return false;
    }
    const priorRemaining = mandate.budgets.remainingActions;
    const restored: StandingMandateV1 = {
      ...mandate,
      budgets: {
        ...mandate.budgets,
        remainingActions: maxActions,
      },
    };
    if (!verifyMandateSignature(restored)) {
      this.emitDiagnostic({
        mandateId: mandate.mandateId,
        reason: "signature verification failed; restore-to-maxActions did not verify",
        kind: "integrity",
      });
      return false;
    }
    this.mandates[index] = restored;
    const ledger: MandateLedgerEntry = {
      ...(this.ledgers[mandate.mandateId] ?? {}),
    };
    if (priorRemaining !== undefined) {
      // Prior unsigned balance may only lower the signed ceiling.
      ledger.remainingActions = Math.min(priorRemaining, maxActions);
    } else if (ledger.remainingActions === undefined) {
      ledger.remainingActions = maxActions;
    }
    if (mandate.revoked === true) {
      ledger.revoked = true;
    }
    this.ledgers[mandate.mandateId] = ledger;
    this.emitDiagnostic({
      mandateId: mandate.mandateId,
      reason: "auto-migrated broken mandate: restored remainingActions to maxActions and seeded ledger",
      kind: "migration",
    });
    return true;
  }

  private persist(): void {
    const file: MandateStoreFile = {
      schemaVersion: 1,
      mandates: this.mandates,
      ledgers: this.ledgers,
    };
    writeFileAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`);
  }

  /**
   * Insert a mandate after schema + signature checks.
   *
   * Replay-safe: re-putting an existing `mandateId` with identical signed
   * content is an idempotent no-op that preserves the ledger (counters and
   * revocation tombstone). Different content under an existing ID throws.
   */
  put(mandate: StandingMandateV1): { idempotent: boolean } {
    const parsed = parseStandingMandate(mandate);
    if (!parsed.ok) {
      throw new Error(`invalid mandate: ${parsed.error}`);
    }
    assertMandateSignature(parsed.mandate);
    return withFileLock(this.path, () => {
      this.reloadLocked();
      const idx = this.mandates.findIndex(
        (m) => m.mandateId === parsed.mandate.mandateId,
      );
      if (idx >= 0) {
        const existing = this.mandates[idx]!;
        if (signedContentKey(existing) !== signedContentKey(parsed.mandate)) {
          throw new Error(
            `mandate ${parsed.mandate.mandateId} already exists with different signed content`,
          );
        }
        return { idempotent: true };
      }
      this.mandates.push(parsed.mandate);
      this.ledgers[parsed.mandate.mandateId] = seedLedgerFromMandate(
        parsed.mandate,
        this.mandateDefaultMaxActions,
      );
      this.persist();
      return { idempotent: false };
    });
  }

  getRemaining(mandateId: string): number | null {
    this.reload();
    const m = this.mandates.find((x) => x.mandateId === mandateId);
    if (!m) return null;
    return effectiveRemaining(
      m,
      this.ledgers[mandateId],
      this.mandateDefaultMaxActions,
    );
  }

  /**
   * Atomically debit one action from a mandate's remaining budget under the
   * cross-process lock. Mutates the unsigned ledger only — never the signed
   * grant blob. Returns false when no budget remains (callers fail closed).
   */
  debit(mandateId: string): boolean {
    return withFileLock(this.path, () => {
      this.reloadLocked();
      const mandate = this.mandates.find((m) => m.mandateId === mandateId);
      if (!mandate) return false;
      const ledger = { ...(this.ledgers[mandateId] ?? {}) };
      if (ledger.revoked === true) return false;
      const remaining = effectiveRemaining(
        mandate,
        ledger,
        this.mandateDefaultMaxActions,
      );
      if (remaining === null) return true; // unlimited standing-allowlist entry
      if (remaining <= 0) return false;
      ledger.remainingActions = remaining - 1;
      this.ledgers[mandateId] = ledger;
      this.persist();
      return true;
    });
  }

  /**
   * Revoke a mandate via the unsigned ledger. Signed blob is left unchanged.
   */
  revoke(mandateId: string): boolean {
    return withFileLock(this.path, () => {
      this.reloadLocked();
      const exists = this.mandates.some((m) => m.mandateId === mandateId);
      if (!exists) return false;
      const ledger = { ...(this.ledgers[mandateId] ?? {}) };
      ledger.revoked = true;
      this.ledgers[mandateId] = ledger;
      this.persist();
      return true;
    });
  }

  findCoverage(
    classification: string,
    options: FindCoverageOptions,
  ): LiveMandateCoverage | null {
    this.reload();

    for (const mandate of this.mandates) {
      const parsed = parseStandingMandate(mandate);
      if (!parsed.ok) continue;
      if (!verifyMandateSignature(parsed.mandate)) {
        this.emitDiagnostic({
          mandateId: parsed.mandate.mandateId,
          reason: "signature verification failed",
          kind: "integrity",
        });
        continue;
      }
      const ledger = this.ledgers[parsed.mandate.mandateId];
      if (ledger?.revoked === true) continue;
      // Legacy signed revoked still fails closed if present on the blob.
      const validity = validateMandateValidity(parsed.mandate, {
        nowMs: options.nowMs,
      });
      if (!validity.valid) continue;
      if (
        !hasBudget(
          effectiveRemaining(
            parsed.mandate,
            ledger,
            this.mandateDefaultMaxActions,
          ),
        )
      ) {
        continue;
      }
      const classes = parsed.mandate.scope.classifications ?? [];
      if (!classes.includes(classification)) continue;
      return {
        mandateId: parsed.mandate.mandateId,
        issuerClass: parsed.mandate.issuerClass,
        authorization: authorizationForIssuer(parsed.mandate.issuerClass),
      };
    }

    if (this.standingAllowOn.includes(classification as ClassificationId)) {
      const authorization = AUTHZ.standingAllowlist;
      return {
        mandateId: `standing:${classification}`,
        issuerClass: "standing-allowlist",
        authorization,
      };
    }

    return null;
  }
}
