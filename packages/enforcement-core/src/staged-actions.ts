/**
 * File-backed ledger for staged-allow undo/review obligations.
 *
 * For destructive classes the record carries the adapter-proven recovery
 * artifact (`recovery`) that makes the action actually undoable; the runtime
 * refuses to stage destructive actions without one.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { RecoveryProof } from "./recovery.js";
import { withFileLock } from "./file-lock.js";

export type StagedActionStatus = "open" | "undone" | "expired_without_undo";

export type StagedActionRecord = {
  schemaVersion: 1;
  toolCallId: string;
  classification: string;
  actionDigest: string;
  registeredAt: string;
  undoExpiresAt: string;
  status: StagedActionStatus;
  /** Present when a concrete recovery artifact backs this staged action. */
  recovery?: RecoveryProof | undefined;
};

export type RegisterStagedInput = {
  toolCallId: string;
  classification: string;
  actionDigest: string;
  undoWindowMs: number;
  nowMs: number;
  recovery?: RecoveryProof | undefined;
};

export class StagedActionLedger {
  readonly path: string;

  constructor(ledgerPath: string, basePath?: string) {
    this.path = resolve(basePath ?? process.cwd(), ledgerPath);
  }

  private append(record: StagedActionRecord): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }

  private readAll(): StagedActionRecord[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as StagedActionRecord);
  }

  private readLatest(): StagedActionRecord[] {
    const latest = new Map<string, StagedActionRecord>();
    for (const record of this.readAll()) {
      latest.set(record.toolCallId, record);
    }
    return [...latest.values()];
  }

  register(input: RegisterStagedInput): StagedActionRecord {
    const record: StagedActionRecord = {
      schemaVersion: 1,
      toolCallId: input.toolCallId,
      classification: input.classification,
      actionDigest: input.actionDigest,
      registeredAt: new Date(input.nowMs).toISOString(),
      undoExpiresAt: new Date(input.nowMs + input.undoWindowMs).toISOString(),
      status: "open",
      ...(input.recovery ? { recovery: input.recovery } : {}),
    };
    withFileLock(this.path, () => this.append(record));
    return record;
  }

  /** Mark open windows past undoExpiresAt as expired_without_undo (auditable). */
  sweepExpired(nowMs: number): StagedActionRecord[] {
    return withFileLock(this.path, () => {
      const current = this.readLatest();
      const expired: StagedActionRecord[] = [];
      for (const record of current) {
        if (
          record.status === "open" &&
          Date.parse(record.undoExpiresAt) < nowMs
        ) {
          const next: StagedActionRecord = {
            ...record,
            status: "expired_without_undo",
          };
          expired.push(next);
          this.append(next);
        }
      }
      return expired;
    });
  }
}
