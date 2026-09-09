/**
 * Durable pending receipts (audit F10): a before-hook in one process must be
 * finalizable by an after-hook running in a fresh process.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ReceiptStore } from "./receipt-store.js";
import { createTempWorkspace } from "./test-helpers.js";

describe("ReceiptStore persistence", () => {
  const ws = createTempWorkspace("fpp-receipt-persist-");
  after(() => ws.cleanup());

  const base = {
    toolName: "filesystem_write",
    paramsDigest: "sha256:abc",
    classification: "fs.write.workspace",
    decision: "allow" as const,
    nowIso: "2026-07-15T12:00:00.000Z",
  };

  it("finalizes a receipt proposed by a different store instance", () => {
    const persistPath = join(ws.path, "pending.json");
    const pre = new ReceiptStore({ persistPath });
    assert.equal(pre.isDurable(), true);
    const proposed = pre.propose({ ...base, toolCallId: "call-1" });
    assert.equal(proposed.finalized, false);
    assert.ok(existsSync(persistPath));

    // Simulate the post-hook process: brand-new runtime, same file.
    const post = new ReceiptStore({ persistPath });
    assert.equal(post.pendingCount(), 1);
    const finalized = post.finalizeExecution(
      "call-1",
      "executed:deadbeef",
      "2026-07-15T12:00:01.000Z",
    );
    assert.ok(finalized);
    assert.equal(finalized.status, "finalized");
    assert.equal(finalized.receiptId, proposed.record.receiptId);

    // A third process sees the terminal state and stays idempotent.
    const again = new ReceiptStore({ persistPath });
    assert.equal(again.pendingCount(), 0);
    const dup = again.finalizeExecution("call-1", "executed:x", base.nowIso);
    assert.equal(dup?.idempotent, true);
  });

  it("receipt ids stay unique across processes", () => {
    const persistPath = join(ws.path, "seq.json");
    const a = new ReceiptStore({ persistPath }).propose({
      ...base,
      toolCallId: "c-a",
    });
    const b = new ReceiptStore({ persistPath }).propose({
      ...base,
      toolCallId: "c-b",
    });
    assert.notEqual(a.record.receiptId, b.record.receiptId);
  });

  it("expiry sweeps apply to persisted pending entries", () => {
    const persistPath = join(ws.path, "expiry.json");
    new ReceiptStore({ persistPath, pendingTtlMs: 1_000 }).propose({
      ...base,
      toolCallId: "c-old",
    });
    const later = new ReceiptStore({ persistPath, pendingTtlMs: 1_000 });
    const expired = later.sweepExpired("2026-07-15T12:01:00.000Z");
    assert.equal(expired.length, 1);
    assert.equal(expired[0]!.outcome, "audit_gap_timeout");
    assert.equal(new ReceiptStore({ persistPath }).pendingCount(), 0);
  });

  it("non-durable stores behave as before", () => {
    const mem = new ReceiptStore();
    assert.equal(mem.isDurable(), false);
    mem.propose({ ...base, toolCallId: "m-1" });
    assert.equal(new ReceiptStore().pendingCount(), 0);
  });
});
