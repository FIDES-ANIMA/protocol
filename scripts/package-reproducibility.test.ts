/**
 * RED/GREEN tests for deterministic package inventory + checksums.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("package-reproducibility", () => {
  const outDir = mkdtempSync(join(tmpdir(), "fpp-repro-"));

  after(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("exports inventoryAndChecksums and compareInventories", async () => {
    const mod = await import("./package-reproducibility.js");
    assert.equal(typeof mod.inventoryAndChecksums, "function");
    assert.equal(typeof mod.compareInventories, "function");
    assert.equal(typeof mod.generateSbom, "function");
  });

  it("produces deterministic file inventory for a dry-run pack", async () => {
    const { inventoryFromPackDryRun, compareInventories } = await import(
      "./package-reproducibility.js"
    );
    const a = await inventoryFromPackDryRun(join(root, "harness", "openclaw", "plugin"), outDir);
    const b = await inventoryFromPackDryRun(join(root, "harness", "openclaw", "plugin"), outDir);
    assert.ok(a.files.length > 0);
    assert.ok(a.files.some((f: { path: string }) => f.path.includes("dist/index.js")));
    const diff = compareInventories(a, b);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.changed, []);
  });

  it("writes CycloneDX SBOM JSON for a package", async () => {
    const { generateSbom } = await import("./package-reproducibility.js");
    const sbomPath = join(outDir, "plugin.cdx.json");
    await generateSbom(join(root, "harness", "openclaw", "plugin"), sbomPath);
    assert.ok(existsSync(sbomPath));
    const sbom = JSON.parse(readFileSync(sbomPath, "utf8"));
    assert.equal(sbom.bomFormat, "CycloneDX");
    assert.ok(sbom.components?.length >= 1);
  });

  it("skill inventory is the flattened staged skill, not the monorepo", async () => {
    const mod = await import("./package-reproducibility.js");
    assert.equal(typeof mod.resolveSkillAssuranceDir, "function");
    const skillDir = await mod.resolveSkillAssuranceDir(root);
    assert.match(skillDir.replace(/\\/g, "/"), /harness\/openclaw\/skill-dist$/);
    assert.ok(existsSync(join(skillDir, "SKILL.md")));
    assert.ok(existsSync(join(skillDir, "package.json")));

    const inv = mod.inventoryStagedSkill(skillDir);
    const paths = inv.files.map((f: { path: string }) => f.path.replace(/\\/g, "/"));
    assert.ok(
      paths.includes("SKILL.md"),
      `staged skill inventory must include SKILL.md; got: ${paths.slice(0, 15).join(", ")}`,
    );
    assert.equal(
      paths.some(
        (p: string) =>
          p.startsWith("adapters/") ||
          p.startsWith("packages/") ||
          p.startsWith("harness/") ||
          p.startsWith("plugin/"),
      ),
      false,
      `staged skill inventory must not include monorepo paths: ${paths.filter((p: string) => p.startsWith("adapters/") || p.startsWith("packages/") || p.startsWith("harness/") || p.startsWith("plugin/")).join(", ")}`,
    );
    const pkg = JSON.parse(readFileSync(join(skillDir, "package.json"), "utf8")) as {
      workspaces?: unknown;
    };
    assert.equal(pkg.workspaces, undefined);
    const sbomPath = join(outDir, "skill.cdx.json");
    await mod.generateSbom(skillDir, sbomPath);
    const sbom = JSON.parse(readFileSync(sbomPath, "utf8"));
    assert.equal(sbom.metadata.component.name, "freedom-preserving-protocol");
  });
});
