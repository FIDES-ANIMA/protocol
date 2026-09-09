/**
 * File-backed emergency override store — parallel to MandateStore.
 *
 * Stewards only for v1: agent-to-agent (peer) escalation without steward
 * involvement is a materially larger trust decision; not an oversight.
 *
 * Local-agent key rejection is intentional defense-in-depth even when the
 * allowlist should already exclude it — it is the last line between
 * "emergency override" and "agent self-escalation" under allowlist
 * misconfiguration.
 *
 * Security invariants (audit F01 / F03 / F04 / F08):
 *   - The signing key must be bound to the claimed `issuerId` through an
 *     independent trusted binding (`stewardKeyBindings`) or, for
 *     self-certifying `fpp:ed25519:<fingerprint>` IDs, the fingerprint itself.
 *     Allowlisting an ID never implicitly trusts an arbitrary key.
 *   - Budget accounting is initialized from the *signed* `maxActions`;
 *     the unsigned `remainingActions` can only lower it. Overrides without a
 *     finite signed ceiling are rejected (fail closed).
 *   - Re-admitting an existing `overrideId` is idempotent: it never reseeds
 *     the ledger or clears a revocation tombstone. Different content under an
 *     existing ID is rejected.
 *   - All mutations run under a cross-process file lock with atomic writes.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canonicalizeV2,
  emergencyOverrideSigningFields,
  parseSignedEmergencyOverride,
  publicKeyMatchesAgentId,
  parseAgentId,
  validateEmergencyOverrideValidity,
  verifyEmergencyOverrideSignature,
  type EmergencyOverrideLedgerEntry,
  type EmergencyOverrideStoreFile,
  type SignedEmergencyOverrideV1,
} from "@fides-anima/fpp-protocol-core";
import { withFileLock, writeFileAtomic } from "./file-lock.js";

export type { EmergencyOverrideLedgerEntry, EmergencyOverrideStoreFile };

/**
 * Options for the emergency override store.
 * Stewards only: `stewardEligibleIds` is the sole issuer allowlist for v1;
 * peer escalation is intentionally out of scope.
 */
export type EmergencyOverrideStoreOptions = {
  basePath?: string | undefined;
};

export type EmergencyOverrideRejectReason =
  | "none"
  | "expired"
  | "not-yet-valid"
  | "mis-scoped"
  | "signature-invalid"
  | "budget-exhausted"
  | "budget-invalid"
  | "revoked"
  | "issuer-not-steward"
  | "issuer-key-unbound"
  | "id-conflict"
  | "agent-self-key";

export type EmergencyCoverageResult =
  | { ok: true; overrideId: string }
  | { ok: false; reason: EmergencyOverrideRejectReason };

export type AdmitResult =
  | { ok: true; overrideId: string; idempotent: boolean }
  | { ok: false; reason: EmergencyOverrideRejectReason; error?: string };

/**
 * Trusted issuer → Ed25519 public key(s) (hex) binding. A function form lets
 * adapters resolve from a trust graph / key-lifecycle ledger. Returning an
 * empty list means "known issuer, no currently valid key" (revoked).
 */
export type StewardKeyBindings =
  | Readonly<Record<string, readonly string[] | string>>
  | ((issuerId: string) => readonly string[] | string | undefined);

export type FindEmergencyCoverageOptions = {
  nowMs: number;
  localPublicKeyHex: string;
  /** Optional re-check of steward allowlist (trust submit always passes). */
  stewardEligibleIds?: string[] | undefined;
  /** Optional re-check of issuer→key binding at consumption time. */
  stewardKeyBindings?: StewardKeyBindings | undefined;
};

export type AdmitOptions = {
  stewardEligibleIds: string[];
  localPublicKeyHex: string;
  /**
   * Independent issuer→key binding. Required: an allowlisted `issuerId`
   * signed by an unrelated key is rejected with `issuer-key-unbound`.
   */
  stewardKeyBindings: StewardKeyBindings;
};

function normalizeHex(hex: string): string {
  return hex.trim().toLowerCase();
}

function boundKeysFor(
  bindings: StewardKeyBindings,
  issuerId: string,
): readonly string[] | undefined {
  const raw =
    typeof bindings === "function" ? bindings(issuerId) : bindings[issuerId];
  if (raw === undefined) return undefined;
  const list = typeof raw === "string" ? [raw] : raw;
  return list.map(normalizeHex);
}

/**
 * Resolve whether `publicKeyHex` is a trusted key for `issuerId`.
 *
 * - Self-certifying v2 IDs must match their own fingerprint; an explicit
 *   binding (if present) must additionally list the key so operators can
 *   revoke by publishing an empty list.
 * - Opaque IDs require an explicit binding containing the key.
 * - Legacy truncated aliases are never independent proof of identity.
 */
export function isIssuerKeyBound(
  issuerId: string,
  publicKeyHex: string,
  bindings: StewardKeyBindings | undefined,
): boolean {
  const key = normalizeHex(publicKeyHex);
  const explicit = bindings ? boundKeysFor(bindings, issuerId) : undefined;
  const parsed = parseAgentId(issuerId);
  if (parsed.kind === "v2") {
    let selfCertified: boolean;
    try {
      selfCertified = publicKeyMatchesAgentId(issuerId, key);
    } catch {
      selfCertified = false;
    }
    if (!selfCertified) return false;
    return explicit === undefined || explicit.includes(key);
  }
  if (explicit === undefined) return false;
  return explicit.includes(key);
}

/**
 * Initialize the unsigned ledger from the *signed* ceiling. The unsigned
 * `remainingActions` may only lower the starting balance. Returns null when
 * no finite signed ceiling exists (fail closed).
 */
function seedLedgerFromOverride(
  override: SignedEmergencyOverrideV1,
): EmergencyOverrideLedgerEntry | null {
  const max = override.budgets.maxActions;
  if (max === undefined || !Number.isInteger(max) || max < 0) {
    return null;
  }
  const incoming = override.budgets.remainingActions;
  const remaining =
    incoming !== undefined && Number.isInteger(incoming) && incoming >= 0
      ? Math.min(incoming, max)
      : max;
  const entry: EmergencyOverrideLedgerEntry = { remainingActions: remaining };
  if (override.revoked === true) {
    entry.revoked = true;
  }
  return entry;
}

/** Effective remaining budget, clamped to the signed ceiling. Null = invalid. */
function effectiveRemaining(
  override: SignedEmergencyOverrideV1,
  ledger: EmergencyOverrideLedgerEntry | undefined,
): number | null {
  const max = override.budgets.maxActions;
  if (max === undefined || !Number.isInteger(max) || max < 0) return null;
  const remaining = ledger?.remainingActions;
  if (remaining === undefined || !Number.isInteger(remaining) || remaining < 0) {
    return null;
  }
  return Math.min(remaining, max);
}

function signedContentKey(override: SignedEmergencyOverrideV1): string {
  return `${canonicalizeV2(emergencyOverrideSigningFields(override))}|${normalizeHex(override.signature)}`;
}

function validityRejectReason(
  reason: string,
): EmergencyOverrideRejectReason | null {
  if (/expired/i.test(reason)) return "expired";
  if (/not yet valid|validFrom/i.test(reason)) return "not-yet-valid";
  if (/revoked/i.test(reason)) return "revoked";
  return null;
}

export class EmergencyOverrideStore {
  readonly path: string;
  private overrides: SignedEmergencyOverrideV1[] = [];
  private ledgers: Record<string, EmergencyOverrideLedgerEntry> = {};

  constructor(storePath: string, options: EmergencyOverrideStoreOptions = {}) {
    this.path = resolve(options.basePath ?? process.cwd(), storePath);
    this.reload();
  }

  reload(): void {
    withFileLock(this.path, () => this.reloadLocked());
  }

  private reloadLocked(): void {
    if (!existsSync(this.path)) {
      this.overrides = [];
      this.ledgers = {};
      return;
    }
    const raw = JSON.parse(
      readFileSync(this.path, "utf8"),
    ) as EmergencyOverrideStoreFile;
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.overrides)) {
      throw new Error(`invalid emergency override store at ${this.path}`);
    }
    this.overrides = raw.overrides.map((o) => ({ ...o }));
    this.ledgers = { ...(raw.ledgers ?? {}) };
    let seeded = false;
    for (const override of this.overrides) {
      if (this.ledgers[override.overrideId] === undefined) {
        const seed = seedLedgerFromOverride(override);
        // No signed ceiling: record an exhausted ledger so the grant can never
        // be consumed, but keep the blob for audit visibility.
        this.ledgers[override.overrideId] = seed ?? { remainingActions: 0 };
        seeded = true;
      }
    }
    if (seeded) {
      this.persist();
    }
  }

  private persist(): void {
    const file: EmergencyOverrideStoreFile = {
      schemaVersion: 1,
      overrides: this.overrides,
      ledgers: this.ledgers,
    };
    writeFileAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`);
  }

  /**
   * Admit a steward-signed override after schema, signature, eligibility,
   * key-binding, budget, and self-key checks. Never signs.
   */
  admit(
    override: SignedEmergencyOverrideV1,
    options: AdmitOptions,
  ): AdmitResult {
    const parsed = parseSignedEmergencyOverride(override);
    if (!parsed.ok) {
      return { ok: false, reason: "signature-invalid", error: parsed.error };
    }
    if (!verifyEmergencyOverrideSignature(parsed.override)) {
      return { ok: false, reason: "signature-invalid" };
    }
    // Defense-in-depth: reject local agent key even if allowlist is wrong.
    if (
      normalizeHex(parsed.override.publicKey) ===
      normalizeHex(options.localPublicKeyHex)
    ) {
      return { ok: false, reason: "agent-self-key" };
    }
    if (!options.stewardEligibleIds.includes(parsed.override.issuerId)) {
      return { ok: false, reason: "issuer-not-steward" };
    }
    if (
      !isIssuerKeyBound(
        parsed.override.issuerId,
        parsed.override.publicKey,
        options.stewardKeyBindings,
      )
    ) {
      return {
        ok: false,
        reason: "issuer-key-unbound",
        error: `signing key is not bound to steward identity ${parsed.override.issuerId}`,
      };
    }
    const seed = seedLedgerFromOverride(parsed.override);
    if (seed === null) {
      return {
        ok: false,
        reason: "budget-invalid",
        error: "emergency override requires a finite signed budgets.maxActions",
      };
    }

    return withFileLock(this.path, () => {
      this.reloadLocked();
      const idx = this.overrides.findIndex(
        (o) => o.overrideId === parsed.override.overrideId,
      );
      if (idx >= 0) {
        const existing = this.overrides[idx]!;
        if (signedContentKey(existing) !== signedContentKey(parsed.override)) {
          return {
            ok: false,
            reason: "id-conflict",
            error: `overrideId ${parsed.override.overrideId} already admitted with different signed content`,
          };
        }
        // Idempotent replay: preserve counters and tombstones untouched.
        if (this.ledgers[parsed.override.overrideId]?.revoked === true) {
          return { ok: false, reason: "revoked" };
        }
        return {
          ok: true,
          overrideId: parsed.override.overrideId,
          idempotent: true,
        };
      }
      this.overrides.push(parsed.override);
      this.ledgers[parsed.override.overrideId] = seed;
      this.persist();
      return {
        ok: true,
        overrideId: parsed.override.overrideId,
        idempotent: false,
      };
    });
  }

  getRemaining(overrideId: string): number | null {
    this.reload();
    const o = this.overrides.find((x) => x.overrideId === overrideId);
    if (!o) return null;
    return effectiveRemaining(o, this.ledgers[overrideId]);
  }

  /**
   * Atomically debit one action from an override's remaining budget under
   * the cross-process lock. Mutates the unsigned ledger only — never the
   * signed grant blob. Returns false when no budget remains (fail closed).
   */
  debit(overrideId: string): boolean {
    return withFileLock(this.path, () => {
      this.reloadLocked();
      const override = this.overrides.find((o) => o.overrideId === overrideId);
      if (!override) return false;
      const ledger = { ...(this.ledgers[overrideId] ?? {}) };
      if (ledger.revoked === true) return false;
      const remaining = effectiveRemaining(override, ledger);
      if (remaining === null || remaining <= 0) return false;
      ledger.remainingActions = remaining - 1;
      this.ledgers[overrideId] = ledger;
      this.persist();
      return true;
    });
  }

  revoke(overrideId: string): boolean {
    return withFileLock(this.path, () => {
      this.reloadLocked();
      const exists = this.overrides.some((o) => o.overrideId === overrideId);
      if (!exists) return false;
      const ledger = { ...(this.ledgers[overrideId] ?? {}) };
      ledger.revoked = true;
      this.ledgers[overrideId] = ledger;
      this.persist();
      return true;
    });
  }

  findCoverage(
    classification: string,
    options: FindEmergencyCoverageOptions,
  ): EmergencyCoverageResult {
    this.reload();

    if (this.overrides.length === 0) {
      return { ok: false, reason: "none" };
    }

    let lastReject: EmergencyOverrideRejectReason = "none";

    for (const override of this.overrides) {
      const parsed = parseSignedEmergencyOverride(override);
      if (!parsed.ok) {
        lastReject = "signature-invalid";
        continue;
      }

      // Defense-in-depth: reject local agent key even if allowlist is wrong.
      if (
        normalizeHex(parsed.override.publicKey) ===
        normalizeHex(options.localPublicKeyHex)
      ) {
        lastReject = "agent-self-key";
        continue;
      }

      if (
        options.stewardEligibleIds !== undefined &&
        !options.stewardEligibleIds.includes(parsed.override.issuerId)
      ) {
        lastReject = "issuer-not-steward";
        continue;
      }

      if (
        options.stewardKeyBindings !== undefined &&
        !isIssuerKeyBound(
          parsed.override.issuerId,
          parsed.override.publicKey,
          options.stewardKeyBindings,
        )
      ) {
        lastReject = "issuer-key-unbound";
        continue;
      }

      if (!verifyEmergencyOverrideSignature(parsed.override)) {
        lastReject = "signature-invalid";
        continue;
      }

      const ledger = this.ledgers[parsed.override.overrideId];
      if (ledger?.revoked === true || parsed.override.revoked === true) {
        lastReject = "revoked";
        continue;
      }

      const validity = validateEmergencyOverrideValidity(parsed.override, {
        nowMs: options.nowMs,
      });
      if (!validity.valid) {
        lastReject = validityRejectReason(validity.reason) ?? "expired";
        continue;
      }

      const remaining = effectiveRemaining(parsed.override, ledger);
      if (remaining === null) {
        lastReject = "budget-invalid";
        continue;
      }
      if (remaining <= 0) {
        lastReject = "budget-exhausted";
        continue;
      }

      const classes = parsed.override.scope.classifications ?? [];
      if (!classes.includes(classification)) {
        lastReject = "mis-scoped";
        continue;
      }

      return { ok: true, overrideId: parsed.override.overrideId };
    }

    return { ok: false, reason: lastReject };
  }
}
