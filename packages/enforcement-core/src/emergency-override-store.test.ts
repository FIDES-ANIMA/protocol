import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  canonicalizeV2,
  deriveAgentIdV2,
  emergencyOverrideSigningFields,
  signMessage,
  verifyEmergencyOverrideSignature,
  type SignedEmergencyOverrideV1,
} from "@fides-anima/fpp-protocol-core";
import { EmergencyOverrideStore } from "./emergency-override-store.js";
import { createTempWorkspace } from "./test-helpers.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function signOverride(
  override: Omit<SignedEmergencyOverrideV1, "signature" | "publicKey">,
  seed: Uint8Array,
): SignedEmergencyOverrideV1 {
  const publicKey = Buffer.from(ed.getPublicKey(seed)).toString("hex");
  const withKey = { ...override, publicKey } as SignedEmergencyOverrideV1;
  const message = Buffer.from(
    canonicalizeV2(emergencyOverrideSigningFields(withKey)),
    "utf8",
  );
  const signature = Buffer.from(signMessage(message, seed)).toString("hex");
  return { ...withKey, signature };
}

describe("EmergencyOverrideStore", () => {
  const ws = createTempWorkspace("fpp-emergency-");
  after(() => ws.cleanup());

  const stewardSeed = ed.utils.randomPrivateKey();
  const agentSeed = ed.utils.randomPrivateKey();
  const stewardPublicKey = Buffer.from(ed.getPublicKey(stewardSeed)).toString(
    "hex",
  );
  const agentPublicKey = Buffer.from(ed.getPublicKey(agentSeed)).toString(
    "hex",
  );
  const nowMs = Date.parse("2026-07-15T12:00:00.000Z");
  const stewardEligibleIds = ["steward:alice"];
  // Opaque steward IDs need an independent issuer→key binding (audit F01).
  const stewardKeyBindings = { "steward:alice": stewardPublicKey };
  const admitOpts = {
    stewardEligibleIds,
    localPublicKeyHex: agentPublicKey,
    stewardKeyBindings,
  };

  const baseOverride = {
    schemaVersion: 1 as const,
    overrideId: "e-valid",
    issuerId: "steward:alice",
    scope: { classifications: ["pkg.install"] },
    budgets: { maxActions: 3, remainingActions: 3 },
    validFrom: "2026-07-01T00:00:00.000Z",
    validTo: "2026-08-01T00:00:00.000Z",
    evidenceRef: "evidence:emergency-1",
  };

  it("finds coverage for a valid signed override", () => {
    const storePath = join(ws.path, "emergency-valid.json");
    const store = new EmergencyOverrideStore(storePath);
    const override = signOverride(baseOverride, stewardSeed);
    const admitted = store.admit(override, admitOpts);
    assert.equal(admitted.ok, true);
    const coverage = store.findCoverage("pkg.install", {
      nowMs,
      localPublicKeyHex: agentPublicKey,
      stewardEligibleIds,
    });
    assert.equal(coverage.ok, true);
    if (coverage.ok) {
      assert.equal(coverage.overrideId, "e-valid");
    }
  });

  it("rejects expired override with typed reason", () => {
    const storePath = join(ws.path, "emergency-expired.json");
    const store = new EmergencyOverrideStore(storePath);
    const override = signOverride(baseOverride, stewardSeed);
    assert.equal(
      store.admit(override, admitOpts).ok,
      true,
    );
    const coverage = store.findCoverage("pkg.install", {
      nowMs: Date.parse("2026-09-01T00:00:00.000Z"),
      localPublicKeyHex: agentPublicKey,
    });
    assert.equal(coverage.ok, false);
    if (!coverage.ok) {
      assert.equal(coverage.reason, "expired");
    }
  });

  it("rejects mis-scoped override with typed reason", () => {
    const storePath = join(ws.path, "emergency-scope.json");
    const store = new EmergencyOverrideStore(storePath);
    const override = signOverride(baseOverride, stewardSeed);
    assert.equal(
      store.admit(override, admitOpts).ok,
      true,
    );
    const coverage = store.findCoverage("net.fetch", {
      nowMs,
      localPublicKeyHex: agentPublicKey,
    });
    assert.equal(coverage.ok, false);
    if (!coverage.ok) {
      assert.equal(coverage.reason, "mis-scoped");
    }
  });

  it("rejects bad signature with typed reason", () => {
    const storePath = join(ws.path, "emergency-badsig.json");
    const store = new EmergencyOverrideStore(storePath);
    const override = signOverride(baseOverride, stewardSeed);
    override.signature = "00".repeat(64);
    const admitted = store.admit(override, admitOpts);
    assert.equal(admitted.ok, false);
    if (!admitted.ok) {
      assert.equal(admitted.reason, "signature-invalid");
    }
  });

  it("rejects budget-exhausted override with typed reason", () => {
    const storePath = join(ws.path, "emergency-budget.json");
    const store = new EmergencyOverrideStore(storePath);
    const override = signOverride(
      {
        ...baseOverride,
        overrideId: "e-budget",
        budgets: { maxActions: 2, remainingActions: 0 },
      },
      stewardSeed,
    );
    assert.equal(
      store.admit(override, admitOpts).ok,
      true,
    );
    const coverage = store.findCoverage("pkg.install", {
      nowMs,
      localPublicKeyHex: agentPublicKey,
    });
    assert.equal(coverage.ok, false);
    if (!coverage.ok) {
      assert.equal(coverage.reason, "budget-exhausted");
    }
  });

  it("rejects override signed with local agent key (defense-in-depth)", () => {
    // Local-agent rejection is intentional defense-in-depth even when the
    // allowlist should already exclude it — last line between "emergency
    // override" and "agent self-escalation" under allowlist misconfiguration.
    const storePath = join(ws.path, "emergency-selfkey.json");
    const store = new EmergencyOverrideStore(storePath);
    const override = signOverride(
      {
        ...baseOverride,
        overrideId: "e-self",
        issuerId: "steward:alice",
      },
      agentSeed,
    );
    // Even with agent key mistakenly on the steward allowlist AND bound:
    const admitted = store.admit(override, {
      stewardEligibleIds: ["steward:alice", "agent:local"],
      localPublicKeyHex: agentPublicKey,
      stewardKeyBindings: { "steward:alice": [stewardPublicKey, agentPublicKey] },
    });
    assert.equal(admitted.ok, false);
    if (!admitted.ok) {
      assert.equal(admitted.reason, "agent-self-key");
    }
    assert.equal(agentPublicKey, override.publicKey);
  });

  it("debit decrements unsigned ledger without breaking signature", () => {
    const storePath = join(ws.path, "emergency-debit.json");
    const store = new EmergencyOverrideStore(storePath);
    const override = signOverride(
      {
        ...baseOverride,
        overrideId: "e-debit",
        budgets: { maxActions: 3, remainingActions: 3 },
      },
      stewardSeed,
    );
    assert.equal(
      store.admit(override, admitOpts).ok,
      true,
    );
    assert.equal(store.debit("e-debit"), true);
    const onDisk = JSON.parse(readFileSync(storePath, "utf8"));
    const frozen = onDisk.overrides.find(
      (o: SignedEmergencyOverrideV1) => o.overrideId === "e-debit",
    );
    assert.equal(frozen.budgets.remainingActions, 3);
    assert.equal(verifyEmergencyOverrideSignature(frozen), true);
    assert.equal(onDisk.ledgers["e-debit"].remainingActions, 2);
    assert.equal(store.getRemaining("e-debit"), 2);
    assert.ok(
      store.findCoverage("pkg.install", {
        nowMs,
        localPublicKeyHex: agentPublicKey,
      }).ok,
    );
  });

  it("admit rejects issuer not in stewardEligibleIds", () => {
    const storePath = join(ws.path, "emergency-not-steward.json");
    const store = new EmergencyOverrideStore(storePath);
    const override = signOverride(
      { ...baseOverride, overrideId: "e-peer", issuerId: "peer:bob" },
      stewardSeed,
    );
    const admitted = store.admit(override, admitOpts);
    assert.equal(admitted.ok, false);
    if (!admitted.ok) {
      assert.equal(admitted.reason, "issuer-not-steward");
    }
  });

  it("findCoverage returns none when store is empty", () => {
    const storePath = join(ws.path, "emergency-empty.json");
    const store = new EmergencyOverrideStore(storePath);
    const coverage = store.findCoverage("pkg.install", {
      nowMs,
      localPublicKeyHex: agentPublicKey,
    });
    assert.equal(coverage.ok, false);
    if (!coverage.ok) {
      assert.equal(coverage.reason, "none");
    }
  });

  it("rejects revoked override with typed reason", () => {
    const storePath = join(ws.path, "emergency-revoked.json");
    const store = new EmergencyOverrideStore(storePath);
    const override = signOverride(
      { ...baseOverride, overrideId: "e-revoked" },
      stewardSeed,
    );
    assert.equal(
      store.admit(override, admitOpts).ok,
      true,
    );
    assert.equal(store.revoke("e-revoked"), true);
    const coverage = store.findCoverage("pkg.install", {
      nowMs,
      localPublicKeyHex: agentPublicKey,
    });
    assert.equal(coverage.ok, false);
    if (!coverage.ok) {
      assert.equal(coverage.reason, "revoked");
    }
  });

  // F01: allowlisting an ID never implicitly trusts an arbitrary key.
  it("rejects allowlisted issuer signed by an unbound key", () => {
    const storePath = join(ws.path, "emergency-unbound.json");
    const store = new EmergencyOverrideStore(storePath);
    const rogueSeed = ed.utils.randomPrivateKey();
    const override = signOverride(
      { ...baseOverride, overrideId: "e-unbound" },
      rogueSeed,
    );
    const admitted = store.admit(override, admitOpts);
    assert.equal(admitted.ok, false);
    if (!admitted.ok) assert.equal(admitted.reason, "issuer-key-unbound");

    // No bindings at all → opaque IDs can never be admitted.
    const noBindings = store.admit(signOverride(baseOverride, stewardSeed), {
      stewardEligibleIds,
      localPublicKeyHex: agentPublicKey,
      stewardKeyBindings: {},
    });
    assert.equal(noBindings.ok, false);
    if (!noBindings.ok) assert.equal(noBindings.reason, "issuer-key-unbound");
  });

  it("accepts self-certifying steward IDs and re-checks binding at coverage", () => {
    const storePath = join(ws.path, "emergency-selfcert.json");
    const store = new EmergencyOverrideStore(storePath);
    const selfId = deriveAgentIdV2(stewardPublicKey);
    const override = signOverride(
      { ...baseOverride, overrideId: "e-selfcert", issuerId: selfId },
      stewardSeed,
    );
    const admitted = store.admit(override, {
      stewardEligibleIds: [selfId],
      localPublicKeyHex: agentPublicKey,
      stewardKeyBindings: {},
    });
    assert.equal(admitted.ok, true, JSON.stringify(admitted));

    // Steward key later revoked via an explicit empty binding: consumption stops.
    const revokedKey = store.findCoverage("pkg.install", {
      nowMs,
      localPublicKeyHex: agentPublicKey,
      stewardKeyBindings: { [selfId]: [] },
    });
    assert.equal(revokedKey.ok, false);
    if (!revokedKey.ok) assert.equal(revokedKey.reason, "issuer-key-unbound");
  });

  // F03: budgets derive from the signed ceiling, never the unsigned remainder.
  it("clamps imported remainingActions to signed maxActions", () => {
    const storePath = join(ws.path, "emergency-clamp.json");
    const store = new EmergencyOverrideStore(storePath);
    const override = signOverride(
      {
        ...baseOverride,
        overrideId: "e-clamp",
        budgets: { maxActions: 2, remainingActions: 999 },
      },
      stewardSeed,
    );
    assert.equal(store.admit(override, admitOpts).ok, true);
    assert.equal(store.getRemaining("e-clamp"), 2);
    assert.equal(store.debit("e-clamp"), true);
    assert.equal(store.debit("e-clamp"), true);
    assert.equal(store.debit("e-clamp"), false);
  });

  it("rejects overrides without a finite signed maxActions", () => {
    const storePath = join(ws.path, "emergency-nomax.json");
    const store = new EmergencyOverrideStore(storePath);
    const override = signOverride(
      {
        ...baseOverride,
        overrideId: "e-nomax",
        budgets: { remainingActions: 5 } as never,
      },
      stewardSeed,
    );
    const admitted = store.admit(override, admitOpts);
    assert.equal(admitted.ok, false);
    if (!admitted.ok) assert.equal(admitted.reason, "budget-invalid");
  });

  // F04: re-admission is idempotent and never resets counters or tombstones.
  it("re-admitting an override neither reseeds budget nor clears revocation", () => {
    const storePath = join(ws.path, "emergency-replay.json");
    const store = new EmergencyOverrideStore(storePath);
    const override = signOverride(
      { ...baseOverride, overrideId: "e-replay" },
      stewardSeed,
    );
    const first = store.admit(override, admitOpts);
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.idempotent, false);
    assert.equal(store.debit("e-replay"), true);
    assert.equal(store.getRemaining("e-replay"), 2);

    const replay = store.admit(override, admitOpts);
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.idempotent, true);
    assert.equal(store.getRemaining("e-replay"), 2, "budget must not reseed");

    assert.equal(store.revoke("e-replay"), true);
    const afterRevoke = store.admit(override, admitOpts);
    assert.equal(afterRevoke.ok, false);
    if (!afterRevoke.ok) assert.equal(afterRevoke.reason, "revoked");
    const coverage = store.findCoverage("pkg.install", {
      nowMs,
      localPublicKeyHex: agentPublicKey,
    });
    assert.equal(coverage.ok, false);

    // Same ID, different signed content → conflict, not silent replacement.
    const conflicting = signOverride(
      {
        ...baseOverride,
        overrideId: "e-replay",
        budgets: { maxActions: 50, remainingActions: 50 },
      },
      stewardSeed,
    );
    const conflict = store.admit(conflicting, admitOpts);
    assert.equal(conflict.ok, false);
    if (!conflict.ok) assert.equal(conflict.reason, "id-conflict");
  });

  // Stewards-only: peer escalation without steward involvement is a larger
  // separate trust decision — documented on EmergencyOverrideStoreOptions.
  it("documents stewards-only via admit eligibility", () => {
    assert.ok(stewardEligibleIds.includes("steward:alice"));
    assert.equal(stewardPublicKey.length, 64);
  });
});
