/**
 * Runtime wiring for audit findings F05 (recovery-backed staging), F06
 * (containment-aware classification) and F09 (durable action ids for
 * emergency accounting).
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  canonicalizeV2,
  emergencyOverrideSigningFields,
  signMessage,
  type SignedEmergencyOverrideV1,
} from "@fides-anima/fpp-protocol-core";
import { createEnforcementRuntime, type FppRuntimeAdapter } from "./runtime-adapter.js";
import { createWorkspaceTrashRecovery } from "./recovery.js";
import { createTempWorkspace } from "./test-helpers.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function adapterFor(root: string, extra: Partial<FppRuntimeAdapter> = {}): FppRuntimeAdapter {
  return {
    harnessId: "test",
    getWorkspacePaths: () => ({ workspaceRoot: root }),
    ...extra,
  };
}

function configFor(dir: string) {
  return {
    auditLogPath: join(dir, "audit.jsonl"),
    receiptLogPath: join(dir, "receipts.jsonl"),
    identityKeyPath: join(dir, "agent.key"),
    mandateStorePath: join(dir, "mandates.json"),
    strictModeStatePath: join(dir, "strict.json"),
    dispositionMode: "unattended" as const,
  };
}

function readJsonl(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("F05: destructive staging requires adapter-proven recovery", () => {
  const ws = createTempWorkspace("fpp-rt-recovery-");
  after(() => ws.cleanup());

  it("without a recovery provider a workspace delete is not staged", async () => {
    const dir = join(ws.path, "no-provider");
    const root = join(dir, "repo");
    mkdirSync(join(root, "scratch"), { recursive: true });
    writeFileSync(join(root, "scratch", "a.txt"), "x", "utf8");

    const runtime = createEnforcementRuntime(configFor(dir), adapterFor(root));
    const result = await runtime.onBeforeToolCall(
      { toolName: "filesystem_delete", params: { path: "scratch/a.txt" }, toolCallId: "d1" },
      { toolCallId: "d1" },
    );
    assert.equal(result.action, "block");
    if (result.action === "block") assert.match(result.blockReason, /abstain/);
    assert.equal(existsSync(join(dir, "fpp-staged-actions.jsonl")), false);
  });

  it("with trash recovery the delete is staged and the artifact is recorded", async () => {
    const dir = join(ws.path, "with-provider");
    const root = join(dir, "repo");
    mkdirSync(join(root, "scratch"), { recursive: true });
    writeFileSync(join(root, "scratch", "a.txt"), "keep me", "utf8");

    const runtime = createEnforcementRuntime(
      configFor(dir),
      adapterFor(root, { recoveryProvider: createWorkspaceTrashRecovery() }),
    );
    const result = await runtime.onBeforeToolCall(
      { toolName: "filesystem_delete", params: { path: "scratch/a.txt" }, toolCallId: "d2" },
      { toolCallId: "d2" },
    );
    assert.equal(result.action, "allow");
    if (result.action === "allow") {
      assert.equal(result.disposition.disposition, "allow_staged");
    }
    const staged = readJsonl(join(dir, "fpp-staged-actions.jsonl"));
    assert.equal(staged.length, 1);
    const rec = staged[0]!.recovery as { kind: string; ref: string; sizeBytes: number };
    assert.equal(rec.kind, "trash");
    assert.equal(rec.sizeBytes, 7);
    assert.equal(readFileSync(rec.ref, "utf8"), "keep me");
  });

  it("recovery over the byte ceiling falls back to abstain", async () => {
    const dir = join(ws.path, "too-big");
    const root = join(dir, "repo");
    mkdirSync(join(root, "scratch"), { recursive: true });
    writeFileSync(join(root, "scratch", "big.bin"), "x".repeat(64), "utf8");

    const runtime = createEnforcementRuntime(
      { ...configFor(dir), stagedRecoveryMaxBytes: 16 },
      adapterFor(root, { recoveryProvider: createWorkspaceTrashRecovery() }),
    );
    const result = await runtime.onBeforeToolCall(
      { toolName: "filesystem_delete", params: { path: "scratch/big.bin" }, toolCallId: "d3" },
      { toolCallId: "d3" },
    );
    assert.equal(result.action, "block");
  });

  it("F06: deletes outside the workspace are external and never staged", async () => {
    const dir = join(ws.path, "external");
    const root = join(dir, "repo");
    mkdirSync(root, { recursive: true });
    const outside = join(dir, "elsewhere.txt");
    writeFileSync(outside, "x", "utf8");

    const runtime = createEnforcementRuntime(
      configFor(dir),
      adapterFor(root, { recoveryProvider: createWorkspaceTrashRecovery() }),
    );
    const result = await runtime.onBeforeToolCall(
      { toolName: "filesystem_delete", params: { path: outside }, toolCallId: "d4" },
      { toolCallId: "d4" },
    );
    assert.equal(result.action, "block");
    const audit = readJsonl(join(dir, "audit.jsonl"));
    assert.ok(audit.some((e) => JSON.stringify(e).includes("fs.delete.external")));
    assert.equal(existsSync(join(dir, "fpp-staged-actions.jsonl")), false);
  });
});

describe("F09: emergency accounting without a host toolCallId", () => {
  const ws = createTempWorkspace("fpp-rt-actionid-");
  after(() => ws.cleanup());

  it("debits the override and records review under an internal action id", async () => {
    const dir = join(ws.path, "emg");
    mkdirSync(dir, { recursive: true });
    const stewardSeed = ed.utils.randomPrivateKey();
    const agentSeed = ed.utils.randomPrivateKey();
    const cfg = configFor(dir);
    mkdirSync(dirname(cfg.identityKeyPath), { recursive: true });
    writeFileSync(cfg.identityKeyPath, Buffer.from(agentSeed), { mode: 0o600 });

    const base = {
      schemaVersion: 1 as const,
      overrideId: "e-noid",
      issuerId: "steward:alice",
      scope: { classifications: ["exec.system-modify"] },
      budgets: { maxActions: 2, remainingActions: 2 },
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2099-01-01T00:00:00.000Z",
      evidenceRef: "evidence:noid",
    };
    const publicKey = Buffer.from(ed.getPublicKey(stewardSeed)).toString("hex");
    const withKey = { ...base, publicKey } as SignedEmergencyOverrideV1;
    const signature = Buffer.from(
      signMessage(
        Buffer.from(canonicalizeV2(emergencyOverrideSigningFields(withKey)), "utf8"),
        stewardSeed,
      ),
    ).toString("hex");
    const override = { ...withKey, signature };
    writeFileSync(
      join(dir, "fpp-emergency-overrides.json"),
      JSON.stringify({
        schemaVersion: 1,
        overrides: [override],
        ledgers: { "e-noid": { remainingActions: 2 } },
      }),
      "utf8",
    );

    const runtime = createEnforcementRuntime(cfg, adapterFor(join(dir, "repo")));
    const result = await runtime.onBeforeToolCall(
      { toolName: "exec", params: { command: "sudo systemctl restart nginx" } },
      {},
    );
    assert.equal(result.action, "allow");
    if (result.action === "allow") {
      assert.equal(result.disposition.disposition, "allow_minimal");
    }

    const onDisk = JSON.parse(readFileSync(join(dir, "fpp-emergency-overrides.json"), "utf8"));
    assert.equal(onDisk.ledgers["e-noid"].remainingActions, 1, "budget must be debited");

    const review = readJsonl(join(dir, "fpp-emergency-review.jsonl"));
    assert.equal(review.length, 1);
    assert.match(String(review[0]!.toolCallId), /^fpp-action:[0-9a-f]+$/);

    const audit = readJsonl(join(dir, "audit.jsonl"));
    const allowed = audit.find((e) => JSON.stringify(e).includes("allow"));
    assert.ok(allowed);
    assert.match(JSON.stringify(allowed), /fpp-action:/);
  });
});
