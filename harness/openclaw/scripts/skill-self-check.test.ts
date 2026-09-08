/**
 * Staged skill must not import plugin/ or adapters/; skill-self-check is prompt-layer only.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function walkTs(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(base, full).replace(/\\/g, "/");
    if (statSync(full).isDirectory()) out.push(...walkTs(full, base));
    else if (rel.endsWith(".ts")) out.push(rel);
  }
  return out;
}

describe("skill self-check and staged imports", () => {
  const tmp = mkdtempSync(join(tmpdir(), "fpp-skill-self-"));

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("detects missing @noble runtime deps with actionable npm install message", async () => {
    const { checkSkillRuntimeDeps, runSkillSelfCheck } = await import(
      "./skill-self-check.js"
    );
    assert.equal(typeof checkSkillRuntimeDeps, "function");

    const bare = join(tmp, "bare-skill");
    mkdirSync(bare, { recursive: true });
    writeFileSync(
      join(bare, "package.json"),
      JSON.stringify({
        name: "bare-skill",
        type: "module",
        dependencies: {
          "@noble/ed25519": "^2.1.0",
          "@noble/hashes": "^1.4.0",
        },
      }),
    );
    // Minimal required files so other checks are not the failure mode
    for (const rel of [
      "SKILL.md",
      "constitution.json",
      "pubkey.ed25519.txt",
      "signature.ed25519.txt",
      "scripts/verify-constitution.ts",
      "scripts/safe-append.ts",
      "scripts/revoke.ts",
      "scripts/skill-lib/index.ts",
    ]) {
      const p = join(bare, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, rel === "SKILL.md" ? "---\nname: bare\n---\n" : "x");
    }

    const deps = checkSkillRuntimeDeps(bare);
    assert.equal(deps.ok, false);
    assert.match(deps.detail, /npm install/i);
    assert.match(deps.detail, /@noble/);

    const report = runSkillSelfCheck({ rootDir: bare });
    assert.equal(report.ok, false);
    const depCheck = report.checks.find((c) => c.id === "deps.noble");
    assert.ok(depCheck);
    assert.equal(depCheck!.ok, false);
    assert.match(depCheck!.detail, /npm install/i);
  });

  it("skill-self-check documents no dispatcher classifier exercise", async () => {
    const mod = await import("./skill-self-check.js");
    assert.equal(typeof mod.runSkillSelfCheck, "function");
    const report = mod.runSkillSelfCheck({ rootDir: root });
    assert.match(report.notes.join("\n"), /does not exercise|dispatcher classifier/i);
  });

  it("staged scripts never import plugin/ or adapters/", async () => {
    const { stageSkill } = await import("./stage-skill.js");
    const outDir = join(tmp, "stage");
    stageSkill({ repoRoot: root, outDir });

    assert.ok(existsSync(join(outDir, "scripts", "skill-self-check.ts")));
    assert.ok(existsSync(join(outDir, "scripts", "verify-install.ts")));

    const scriptsRoot = join(outDir, "scripts");
    for (const rel of walkTs(scriptsRoot)) {
      const src = readFileSync(join(scriptsRoot, rel), "utf8");
      assert.doesNotMatch(
        src,
        /from\s+["'].*plugin\//,
        `${rel} must not import plugin/`,
      );
      assert.doesNotMatch(
        src,
        /from\s+["'].*adapters\//,
        `${rel} must not import adapters/`,
      );
      assert.doesNotMatch(
        src,
        /from\s+["'].*packages\//,
        `${rel} must not import packages/`,
      );
    }
  });

  it("skill-self-check CLI exits 0 on staged tree after installDeps", async () => {
    const { stageSkill } = await import("./stage-skill.js");
    const outDir = join(tmp, "stage-cli");
    const staged = stageSkill({ repoRoot: root, outDir, installDeps: true });
    assert.equal(staged.depsInstalled, true);
    const result = spawnSync(
      "npx",
      ["tsx", "scripts/skill-self-check.ts"],
      { cwd: outDir, encoding: "utf8", shell: true },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /does not exercise|dispatcher classifier/i);
    assert.match(result.stdout, /deps\.noble/);
  });

  it("monorepo root without a staged skill cannot report ok", async () => {
    const { runSkillSelfCheck } = await import("./skill-self-check.js");
    const mono = join(tmp, "mono-missing-stage");
    mkdirSync(mono, { recursive: true });
    writeFileSync(
      join(mono, "package.json"),
      JSON.stringify({
        name: "freedom-preserving-protocol",
        private: true,
        workspaces: ["packages/*"],
      }),
    );
    // Trap: root SKILL.md must not be enough to pass without skill-dist.
    writeFileSync(join(mono, "SKILL.md"), "---\nname: trap\n---\n");

    const report = runSkillSelfCheck({ rootDir: mono });
    assert.equal(report.ok, false);
    const stage = report.checks.find((c) => c.id === "stage.skill-dist");
    assert.ok(stage, "monorepo check must inspect skill-dist");
    assert.equal(stage!.ok, false);
    assert.match(stage!.detail, /harness\/openclaw\/skill-dist/);
    assert.equal(
      report.checks.some((c) => c.id.startsWith("file.") && c.ok),
      false,
      "must not treat the monorepo root as a flattened skill",
    );
  });

  it("monorepo root with an incomplete staged skill fails required files", async () => {
    const { runSkillSelfCheck } = await import("./skill-self-check.js");
    const mono = join(tmp, "mono-incomplete-stage");
    const stageDir = join(mono, "harness", "openclaw", "skill-dist");
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(
      join(mono, "package.json"),
      JSON.stringify({
        name: "freedom-preserving-protocol",
        private: true,
        workspaces: ["packages/*"],
      }),
    );
    writeFileSync(
      join(stageDir, "package.json"),
      JSON.stringify({ name: "incomplete-skill", type: "module" }),
    );

    const report = runSkillSelfCheck({ rootDir: mono });
    assert.equal(report.ok, false);
    const stage = report.checks.find((c) => c.id === "stage.skill-dist");
    assert.ok(stage);
    assert.equal(stage!.ok, true);
    const skillMd = report.checks.find((c) => c.id === "file.SKILL.md");
    assert.ok(skillMd);
    assert.equal(skillMd!.ok, false);
  });

  it("monorepo root with a complete staged skill checks every required file", async () => {
    const { runSkillSelfCheck } = await import("./skill-self-check.js");
    const mono = join(tmp, "mono-complete-stage");
    const stageDir = join(mono, "harness", "openclaw", "skill-dist");
    writeMonorepoRoot(mono);
    writeCompleteSkillRoot(stageDir);

    const report = runSkillSelfCheck({ rootDir: mono });
    assert.equal(report.ok, true, JSON.stringify(report.checks, null, 2));
    for (const rel of REQUIRED_SKILL_FILES) {
      const check = report.checks.find((c) => c.id === `file.${rel}`);
      assert.ok(check, `missing check for ${rel}`);
      assert.equal(check!.ok, true, `${rel}: ${check!.detail}`);
    }
    const deps = report.checks.find((c) => c.id === "deps.noble");
    assert.ok(deps);
    assert.equal(deps!.ok, true);
  });
});

const REQUIRED_SKILL_FILES = [
  "SKILL.md",
  "constitution.json",
  "pubkey.ed25519.txt",
  "signature.ed25519.txt",
  "package.json",
  "scripts/verify-constitution.ts",
  "scripts/safe-append.ts",
  "scripts/revoke.ts",
  "scripts/skill-lib/index.ts",
] as const;

function writeMonorepoRoot(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "freedom-preserving-protocol",
      private: true,
      workspaces: ["packages/*"],
    }),
  );
}

function writeCompleteSkillRoot(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "freedom-preserving-protocol",
      type: "module",
      dependencies: {
        "@noble/ed25519": "^2.1.0",
        "@noble/hashes": "^1.4.0",
      },
    }),
  );
  for (const rel of REQUIRED_SKILL_FILES) {
    if (rel === "package.json") continue;
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, rel === "SKILL.md" ? "---\nname: fpp\n---\n" : "x");
  }
  for (const spec of ["@noble/ed25519", "@noble/hashes"]) {
    const pkgDir = join(dir, "node_modules", spec);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: spec,
        version: "1.0.0",
        type: "module",
        main: "index.js",
      }),
    );
    writeFileSync(join(pkgDir, "index.js"), "export {}\n");
  }
}
