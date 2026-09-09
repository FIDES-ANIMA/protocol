/**
 * Bounded pending-receipt store for correlating before/after tool-call hooks.
 *
 * Correlation is host-authoritative via `toolCallId`. When that id is missing,
 * the store records an explicit reduced-confidence fallback key and never
 * silently joins ambiguous calls. Raw tool parameters are never retained —
 * only digests.
 *
 * When `persistPath` is set the pending/finalized state is reloaded from disk
 * before, and flushed after, every mutation under a cross-process lock. This
 * is what lets one-shot hook processes (Cursor pre/post hooks) correlate a
 * before-event with the after-event that runs in a different process.
 */

import { existsSync, readFileSync } from "node:fs";
import { DIGEST_DOMAINS, digest } from "@fides-anima/fpp-protocol-core";
import type { GovernanceMode } from "@fides-anima/fpp-protocol-core";
import { withFileLock, writeFileAtomic } from "./file-lock.js";

export type CorrelationConfidence = "full" | "reduced";

export type ReceiptLifecycleStatus =
  | "pending_execution"
  | "pending_authorization"
  | "finalized"
  | "orphan"
  | "timed_out";

export type ReceiptDisposition =
  | "allow"
  | "deny"
  | "require_approval"
  | "abstain"
  | "allow_staged"
  | "allow_minimal";

/** Allowlisted terminal outcomes for bulk orphan reconciliation. */
export const ALLOWED_ORPHAN_OUTCOMES = [
  "audit_gap_orphan",
  "governance_transition_aborted",
] as const;

export type AllowedOrphanOutcome = (typeof ALLOWED_ORPHAN_OUTCOMES)[number];

export type PendingReceiptRecord = {
  receiptId: string;
  toolCallId: string | null;
  fallbackCorrelationKey?: string | undefined;
  correlationConfidence: CorrelationConfidence;
  actionDigest: string;
  classification: string;
  disposition: ReceiptDisposition;
  decision: "block" | "approval" | "allow";
  agentId?: string | undefined;
  runId?: string | undefined;
  sessionKey?: string | undefined;
  proposedAt: string;
  authorization?: string | undefined;
  outcome?: string | undefined;
  status: ReceiptLifecycleStatus;
  finalizedAt?: string | undefined;
  /** Captured gateway governance epoch when the call was admitted. */
  governanceEpoch?: number | undefined;
  /** Captured gateway governance mode when the call was admitted. */
  governanceMode?: GovernanceMode | undefined;
};

export type ProposeInput = {
  toolCallId?: string | undefined;
  toolName: string;
  paramsDigest: string;
  classification: string;
  decision: "block" | "approval" | "allow";
  /** Override disposition when richer than legacy decision mapping. */
  disposition?: ReceiptDisposition | undefined;
  /** Authorization class from the disposition engine. */
  authorization?: string | undefined;
  agentId?: string | undefined;
  runId?: string | undefined;
  sessionKey?: string | undefined;
  nowIso: string;
  governanceEpoch?: number | undefined;
  governanceMode?: GovernanceMode | undefined;
};

export type ProposeResult = {
  record: PendingReceiptRecord;
  finalized: boolean;
  idempotent?: boolean | undefined;
};

export type FinalizeResult = PendingReceiptRecord & {
  idempotent?: boolean | undefined;
};

export type ReceiptStoreOptions = {
  maxPending?: number;
  pendingTtlMs?: number;
  /**
   * Durable pending-state file. Required for adapters whose before/after hooks
   * run in separate short-lived processes.
   */
  persistPath?: string | undefined;
};

type PersistedReceiptState = {
  schemaVersion: 1;
  seq: number;
  pending: Array<[string, PendingReceiptRecord]>;
  finalized: Array<[string, PendingReceiptRecord]>;
};

const DEFAULT_MAX_PENDING = 256;
const DEFAULT_PENDING_TTL_MS = 15 * 60_000;
/** Finalized records retained on disk for idempotent re-finalization. */
const MAX_PERSISTED_FINALIZED = 1024;

export function digestActionParams(params: Record<string, unknown>): string {
  return digest({
    version: 2,
    domain: DIGEST_DOMAINS.receipt,
    value: { kind: "params", params },
  });
}

export function computeActionDigest(input: {
  toolName: string;
  paramsDigest: string;
  classification: string;
}): string {
  return digest({
    version: 2,
    domain: DIGEST_DOMAINS.receipt,
    value: {
      kind: "action",
      toolName: input.toolName,
      paramsDigest: input.paramsDigest,
      classification: input.classification,
    },
  });
}

function dispositionFor(
  decision: "block" | "approval" | "allow",
  override?: ReceiptDisposition | undefined,
): ReceiptDisposition {
  if (override) return override;
  if (decision === "block") return "deny";
  if (decision === "approval") return "require_approval";
  return "allow";
}

function fallbackKey(input: ProposeInput): string {
  return digest({
    version: 2,
    domain: DIGEST_DOMAINS.receipt,
    value: {
      kind: "fallback-correlation",
      toolName: input.toolName,
      paramsDigest: input.paramsDigest,
      classification: input.classification,
      agentId: input.agentId ?? null,
      runId: input.runId ?? null,
      sessionKey: input.sessionKey ?? null,
      proposedAt: input.nowIso,
    },
  });
}

export class ReceiptStore {
  private readonly maxPending: number;
  private readonly pendingTtlMs: number;
  private readonly pending = new Map<string, PendingReceiptRecord>();
  private readonly finalizedByKey = new Map<string, PendingReceiptRecord>();
  private readonly orphans: PendingReceiptRecord[] = [];
  private readonly persistPath: string | undefined;
  private seq = 0;

  constructor(options: ReceiptStoreOptions = {}) {
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
    this.pendingTtlMs = options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
    this.persistPath = options.persistPath;
    if (this.persistPath) this.loadFromDisk();
  }

  /** True when pending state survives process exit. */
  isDurable(): boolean {
    return this.persistPath !== undefined;
  }

  pendingCount(): number {
    this.refresh();
    return this.pending.size;
  }

  finalizedCount(): number {
    this.refresh();
    return this.finalizedByKey.size;
  }

  getPending(toolCallId: string): PendingReceiptRecord | undefined {
    this.refresh();
    return this.pending.get(toolCallId);
  }

  getFinalized(toolCallId: string): PendingReceiptRecord | undefined {
    this.refresh();
    return this.finalizedByKey.get(toolCallId);
  }

  drainOrphans(): PendingReceiptRecord[] {
    return this.orphans.splice(0, this.orphans.length);
  }

  propose(input: ProposeInput): ProposeResult {
    return this.mutate(() => this.proposeLocked(input));
  }

  recordAuthorization(
    toolCallId: string,
    authorization: string,
    nowIso: string,
  ): PendingReceiptRecord | undefined {
    return this.mutate(() =>
      this.recordAuthorizationLocked(toolCallId, authorization, nowIso),
    );
  }

  finalizeExecution(
    toolCallId: string,
    outcome: string,
    nowIso: string,
  ): FinalizeResult | undefined {
    return this.mutate(() =>
      this.finalizeExecutionLocked(toolCallId, outcome, nowIso),
    );
  }

  sweepExpired(nowIso: string): PendingReceiptRecord[] {
    return this.mutate(() => this.sweepExpiredLocked(nowIso));
  }

  /** Mark all remaining pending entries as orphans (shutdown/restart). */
  orphanAllPending(
    nowIso: string,
    reason: AllowedOrphanOutcome = "audit_gap_orphan",
  ): PendingReceiptRecord[] {
    return this.mutate(() => this.orphanAllPendingLocked(nowIso, reason));
  }

  /**
   * Transition-abort leftovers at a governance drain deadline.
   * Distinct from generic shutdown orphans (`audit_gap_orphan`).
   */
  abortPendingForGovernanceTransition(
    nowIso: string,
    governanceEpoch: number,
    eligibleToolCallIds: ReadonlySet<string>,
    persist?: ((candidate: PendingReceiptRecord) => void) | undefined,
  ): PendingReceiptRecord[] {
    return this.mutate(() =>
      this.abortPendingForGovernanceTransitionLocked(
        nowIso,
        governanceEpoch,
        eligibleToolCallIds,
        persist,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  /** Run a mutation with reload-before / flush-after under the file lock. */
  private mutate<T>(fn: () => T): T {
    if (!this.persistPath) return fn();
    return withFileLock(this.persistPath, () => {
      this.loadFromDisk();
      const out = fn();
      this.flushToDisk();
      return out;
    });
  }

  /** Read-side refresh so a sibling process's writes are visible. */
  private refresh(): void {
    if (!this.persistPath) return;
    withFileLock(this.persistPath, () => this.loadFromDisk());
  }

  private loadFromDisk(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    let parsed: PersistedReceiptState;
    try {
      parsed = JSON.parse(
        readFileSync(this.persistPath, "utf8"),
      ) as PersistedReceiptState;
    } catch {
      // Corrupt state is a fail-closed condition for correlation: keep the
      // in-memory view (possibly empty) rather than trusting partial data.
      return;
    }
    if (parsed.schemaVersion !== 1) return;
    this.pending.clear();
    this.finalizedByKey.clear();
    for (const [k, v] of parsed.pending ?? []) this.pending.set(k, v);
    for (const [k, v] of parsed.finalized ?? []) this.finalizedByKey.set(k, v);
    this.seq = Math.max(this.seq, Number(parsed.seq) || 0);
  }

  private flushToDisk(): void {
    if (!this.persistPath) return;
    const finalized = [...this.finalizedByKey.entries()];
    const trimmed =
      finalized.length > MAX_PERSISTED_FINALIZED
        ? finalized.slice(finalized.length - MAX_PERSISTED_FINALIZED)
        : finalized;
    const state: PersistedReceiptState = {
      schemaVersion: 1,
      seq: this.seq,
      pending: [...this.pending.entries()],
      finalized: trimmed,
    };
    writeFileAtomic(this.persistPath, `${JSON.stringify(state)}\n`);
  }

  // ---------------------------------------------------------------------------
  // Core (lock-free) implementations
  // ---------------------------------------------------------------------------

  private proposeLocked(input: ProposeInput): ProposeResult {
    if (
      (input.governanceEpoch === undefined) !==
      (input.governanceMode === undefined)
    ) {
      throw new Error(
        "governanceEpoch and governanceMode must be supplied together",
      );
    }
    const key = this.correlationKey(input);
    const existingFinal = this.finalizedByKey.get(key);
    if (existingFinal) {
      return { record: existingFinal, finalized: true, idempotent: true };
    }
    const existingPending = this.pending.get(key);
    if (existingPending) {
      return {
        record: existingPending,
        finalized: false,
        idempotent: true,
      };
    }

    const correlationConfidence: CorrelationConfidence =
      input.toolCallId && input.toolCallId.length > 0 ? "full" : "reduced";
    const disposition = dispositionFor(input.decision, input.disposition);
    const record: PendingReceiptRecord = {
      receiptId: `rcpt-${++this.seq}`,
      toolCallId: input.toolCallId && input.toolCallId.length > 0 ? input.toolCallId : null,
      correlationConfidence,
      actionDigest: computeActionDigest(input),
      classification: input.classification,
      disposition,
      decision: input.decision,
      agentId: input.agentId,
      runId: input.runId,
      sessionKey: input.sessionKey,
      proposedAt: input.nowIso,
      status:
        input.decision === "block"
          ? "finalized"
          : input.decision === "approval"
            ? "pending_authorization"
            : "pending_execution",
      ...(input.governanceEpoch !== undefined
        ? { governanceEpoch: input.governanceEpoch }
        : {}),
      ...(input.governanceMode !== undefined
        ? { governanceMode: input.governanceMode }
        : {}),
    };
    if (correlationConfidence === "reduced") {
      record.fallbackCorrelationKey = `fallback:${fallbackKey(input)}`;
    }

    if (input.decision === "block") {
      record.authorization =
        input.authorization ??
        (disposition === "abstain" ? "abstain" : "policy-block");
      record.outcome = disposition === "abstain" ? "abstained" : "blocked";
      record.finalizedAt = input.nowIso;
      this.finalizedByKey.set(key, record);
      return { record, finalized: true };
    }

    if (input.authorization) {
      record.authorization = input.authorization;
    }

    this.evictOldestIfNeeded();
    this.pending.set(key, record);
    return { record, finalized: false };
  }

  private recordAuthorizationLocked(
    toolCallId: string,
    authorization: string,
    nowIso: string,
  ): PendingReceiptRecord | undefined {
    const record = this.pending.get(toolCallId);
    if (!record) {
      const done = this.finalizedByKey.get(toolCallId);
      return done;
    }
    record.authorization = authorization;
    if (authorization === "approved" || authorization === "allow-once" || authorization === "allow-always") {
      record.status = "pending_execution";
    } else {
      // deny / timeout / cancelled are terminal authorization outcomes
      record.outcome = authorization;
      record.status = "finalized";
      record.finalizedAt = nowIso;
      this.pending.delete(toolCallId);
      this.finalizedByKey.set(toolCallId, record);
    }
    return record;
  }

  private finalizeExecutionLocked(
    toolCallId: string,
    outcome: string,
    nowIso: string,
  ): FinalizeResult | undefined {
    const done = this.finalizedByKey.get(toolCallId);
    if (done) {
      return { ...done, idempotent: true };
    }
    const record = this.pending.get(toolCallId);
    if (!record) return undefined;
    record.outcome = outcome;
    if (!record.authorization) {
      record.authorization =
        record.disposition === "allow" ? "policy-match" : "unresolved";
    }
    record.status = "finalized";
    record.finalizedAt = nowIso;
    this.pending.delete(toolCallId);
    this.finalizedByKey.set(toolCallId, record);
    return record;
  }

  private sweepExpiredLocked(nowIso: string): PendingReceiptRecord[] {
    const now = Date.parse(nowIso);
    const expired: PendingReceiptRecord[] = [];
    for (const [key, record] of this.pending) {
      const proposed = Date.parse(record.proposedAt);
      if (Number.isNaN(now) || Number.isNaN(proposed)) continue;
      if (now - proposed < this.pendingTtlMs) continue;
      record.status = "timed_out";
      record.outcome = "audit_gap_timeout";
      record.finalizedAt = nowIso;
      this.pending.delete(key);
      this.orphans.push(record);
      expired.push(record);
    }
    return expired;
  }

  private orphanAllPendingLocked(
    nowIso: string,
    reason: AllowedOrphanOutcome,
  ): PendingReceiptRecord[] {
    if (
      !(ALLOWED_ORPHAN_OUTCOMES as readonly string[]).includes(reason)
    ) {
      throw new Error(
        `invalid orphan outcome "${String(reason)}"; allowlist: ${ALLOWED_ORPHAN_OUTCOMES.join(", ")}`,
      );
    }
    const out: PendingReceiptRecord[] = [];
    for (const [key, record] of this.pending) {
      record.status = "orphan";
      record.outcome = reason;
      record.finalizedAt = nowIso;
      this.pending.delete(key);
      this.finalizedByKey.set(key, record);
      this.orphans.push(record);
      out.push(record);
    }
    return out;
  }

  private abortPendingForGovernanceTransitionLocked(
    nowIso: string,
    governanceEpoch: number,
    eligibleToolCallIds: ReadonlySet<string>,
    persist?: ((candidate: PendingReceiptRecord) => void) | undefined,
  ): PendingReceiptRecord[] {
    const selected: Array<
      [string, PendingReceiptRecord, PendingReceiptRecord]
    > = [];
    for (const toolCallId of eligibleToolCallIds) {
      const record = this.pending.get(toolCallId);
      if (!record) continue;
      if (record.governanceEpoch !== governanceEpoch) {
        throw new Error(
          `cannot transition-abort ${toolCallId}: expected governance epoch ${governanceEpoch}, got ${String(record.governanceEpoch)}`,
        );
      }
      selected.push([
        toolCallId,
        record,
        {
          ...record,
          status: "orphan",
          outcome: "governance_transition_aborted",
          finalizedAt: nowIso,
        },
      ]);
    }

    const out: PendingReceiptRecord[] = [];
    for (const [key, record, candidate] of selected) {
      // Persistence occurs before in-memory publication. If it throws, this
      // record remains pending and can be retried without a duplicate terminal.
      persist?.(candidate);
      Object.assign(record, candidate);
      this.pending.delete(key);
      this.finalizedByKey.set(key, record);
      this.orphans.push(record);
      out.push(record);
    }
    return out;
  }

  private correlationKey(input: ProposeInput): string {
    if (input.toolCallId && input.toolCallId.length > 0) return input.toolCallId;
    return `fallback:${fallbackKey(input)}`;
  }

  private evictOldestIfNeeded(): void {
    if (this.pending.size < this.maxPending) return;
    let oldestKey: string | undefined;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [key, record] of this.pending) {
      const ts = Date.parse(record.proposedAt);
      if (ts < oldestTs) {
        oldestTs = ts;
        oldestKey = key;
      }
    }
    if (!oldestKey) return;
    const victim = this.pending.get(oldestKey);
    if (!victim) return;
    this.pending.delete(oldestKey);
    victim.status = "orphan";
    victim.outcome = "audit_gap_overflow";
    victim.finalizedAt = new Date().toISOString();
    this.orphans.push(victim);
  }
}
