/**
 * Adapter-proven recovery for destructive staged actions (audit F05).
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createWorkspaceTrashRecovery, measureTreeBytes } from "./recovery.js";
import { requiresRecoveryProof, isReversibleClassification } from "./reversibility.js";
import { createTempWorkspace } from "./test-helpers.js";

describe("workspace trash recovery", () => {
  const ws = createTempWorkspace("fpp-recovery-");
  after(() => ws.cleanup());
  const root = join(ws.path, "repo");
  mkdirSync(join(root, "dir"), { recursive: true });
  writeFileSync(join(root, "dir", "a.txt"), "hello", "utf8");
  writeFileSync(join(root, "dir", "b.txt"), "world!", "utf8");

  const provider = createWorkspaceTrashRecovery();
  const request = (over: Partial<Parameters<typeof provider>[0]>) => ({
    actionId: "call-1",
    toolName: "filesystem_delete",
    params: { path: "dir" },
    classification: "fs.delete.workspace" as const,
    workspaceRoot: root,
    maxBytes: 1024 * 1024,
    ...over,
  });

  it("destructive delete classes require recovery proof; writes do not", () => {
    assert.equal(requiresRecoveryProof("fs.delete.workspace"), true);
    assert.equal(isReversibleClassification("fs.delete.workspace"), true);
    assert.equal(requiresRecoveryProof("fs.write.workspace"), false);
    assert.equal(requiresRecoveryProof("fs.delete.external"), false);
    assert.equal(isReversibleClassification("fs.delete.external"), false);
  });

  it("copies the target into the trash and reports bounded size", async () => {
    const proof = await provider(request({}));
    assert.ok(proof);
    assert.equal(proof.kind, "trash");
    assert.equal(proof.sizeBytes, 11);
    assert.ok(existsSync(join(proof.ref, "a.txt")));
    assert.equal(readFileSync(join(proof.ref, "b.txt"), "utf8"), "world!");
  });

  it("refuses when the target exceeds the byte ceiling", async () => {
    assert.equal(await provider(request({ maxBytes: 5 })), null);
    assert.equal(measureTreeBytes(join(root, "dir"), 5), null);
  });

  it("refuses out-of-workspace and shell targets", async () => {
    assert.equal(
      await provider(request({ params: { path: "../outside.txt" } })),
      null,
    );
    assert.equal(
      await provider(
        request({ toolName: "shell_exec", params: { command: "rm -rf dir" } }),
      ),
      null,
    );
    assert.equal(
      await provider(request({ classification: "fs.write.workspace" })),
      null,
    );
  });

  it("absent targets are trivially recoverable", async () => {
    const proof = await provider(request({ params: { path: "dir/missing" } }));
    assert.ok(proof);
    assert.equal(proof.sizeBytes, 0);
    assert.equal(proof.ref, "absent-target");
  });
});
