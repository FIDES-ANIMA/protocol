/**
 * Canonical harness-directory layout contract.
 *
 * Runtime-facing harness assets live under harness/<name>/ plus
 * harness/shared/. Authorization aliases such as harness/openclaw.json
 * are logical resource strings, not repository files.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_PATHS = [
  "harness/README.md",
  "harness/shared/harness-capabilities.json",
  "harness/shared/prompt/SKILL.md",
  "harness/shared/prompt/hooks/pre-action-check/SKILL.md",
  "harness/shared/prompt/hooks/constitution-audit/SKILL.md",
  "harness/shared/prompt/adoption/SOUL-BLOCK.md",
  "harness/shared/prompt/adoption/MEMORY-ENTRY.md",
  "harness/shared/prompt/adoption/LEDGER-ATTESTATION.yaml",
  "harness/openclaw/plugin/package.json",
  "harness/openclaw/plugin-trust/package.json",
  "harness/openclaw/skill/ALLOWLIST",
  "harness/openclaw/skill/package.json",
  "harness/openclaw/.clawhubignore",
  "harness/openclaw/scripts/stage-skill.ts",
  "harness/openclaw/scripts/clawhub-publish.sh",
  "harness/openclaw/scripts/skill-self-check.ts",
  "harness/cursor/adapter/package.json",
  "harness/claude-code/adapter/package.json",
  "harness/codex/adapter/package.json",
  "harness/cursor/runbook.md",
  "harness/claude-code/runbook.md",
  "harness/codex/runbook.md",
  "harness/hermes/runbook.md",
  "constitution.json",
  "constitution.yaml",
  "pubkey.ed25519.txt",
  "signature.ed25519.txt",
] as const;

/** Legacy source locations that must no longer exist after the partition. */
const FORBIDDEN_LEGACY_PATHS = [
  "plugin/package.json",
  "plugin-trust/package.json",
  "adapters/cursor/package.json",
  "adapters/claude-code/package.json",
  "adapters/codex/package.json",
  "adapters/harness-capabilities.json",
  "SKILL.md",
  "hooks/pre-action-check/SKILL.md",
  "adoption/SOUL-BLOCK.md",
  "skill/ALLOWLIST",
  ".clawhubignore",
  "scripts/stage-skill.ts",
  "scripts/clawhub-publish.sh",
  "scripts/skill-self-check.ts",
  "docs/runbooks/cursor.md",
  "docs/runbooks/claude-code.md",
  "docs/runbooks/codex.md",
  "docs/runbooks/hermes-fpp-runbook.md",
] as const;

const REQUIRED_WORKSPACES = [
  "packages/*",
  "harness/openclaw/plugin",
  "harness/openclaw/plugin-trust",
  "harness/cursor/adapter",
  "harness/claude-code/adapter",
  "harness/codex/adapter",
] as const;

const FORBIDDEN_WORKSPACES = [
  "adapters/*",
  "plugin",
  "plugin-trust",
] as const;

describe("canonical harness directory layout", () => {
  it("places runtime-facing harness assets under harness/", () => {
    const missing = REQUIRED_PATHS.filter((rel) => !existsSync(join(root, rel)));
    assert.deepEqual(missing, [], `missing canonical paths:\n${missing.join("\n")}`);
  });

  it("removes legacy harness source locations from the repo root", () => {
    const leftover = FORBIDDEN_LEGACY_PATHS.filter((rel) =>
      existsSync(join(root, rel)),
    );
    assert.deepEqual(
      leftover,
      [],
      `legacy source paths still present:\n${leftover.join("\n")}`,
    );
  });

  it("lists harness workspaces and does not list legacy plugin/adapter workspaces", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      workspaces?: string[];
    };
    const workspaces = pkg.workspaces ?? [];
    for (const ws of REQUIRED_WORKSPACES) {
      assert.ok(workspaces.includes(ws), `missing workspace: ${ws}`);
    }
    for (const ws of FORBIDDEN_WORKSPACES) {
      assert.equal(
        workspaces.includes(ws),
        false,
        `legacy workspace still listed: ${ws}`,
      );
    }
  });

  it("does not collocate authorization aliases as repository files", () => {
    assert.equal(
      existsSync(join(root, "harness", "openclaw.json")),
      false,
      "harness/openclaw.json is a logical grant alias, not a repo file",
    );
  });

  it("OpenClaw publishing docs use canonical harness paths", () => {
    const readme = readFileSync(join(root, "harness", "openclaw", "README.md"), "utf8");
    assert.match(readme, /harness\/openclaw\/scripts\/clawhub-publish\.sh/);
    assert.match(readme, /harness\/openclaw\/scripts\/stage-skill\.ts/);
    assert.match(readme, /harness\/openclaw\/skill-dist\//);
    assert.match(readme, /harness\/openclaw\/skill\/ALLOWLIST/);
    assert.match(readme, /harness\/openclaw\/plugin\//);
    assert.match(readme, /harness\/openclaw\/plugin-trust\//);
    assert.doesNotMatch(readme, /(?:^|\n)\s*clawhub skill publish \./);

    const skillPath = join(
      root,
      ".claude",
      "skills",
      "learned-clawhub-publishing",
      "SKILL.md",
    );
    if (!existsSync(skillPath)) return;
    const skill = readFileSync(skillPath, "utf8");
    assert.match(skill, /harness\/openclaw\/scripts\//);
    assert.match(skill, /harness\/openclaw\/skill-dist\//);
    assert.match(skill, /harness\/openclaw\/skill\/ALLOWLIST/);
    assert.match(skill, /harness\/openclaw\/plugin\//);
    assert.match(skill, /harness\/openclaw\/plugin-trust\//);
    assert.doesNotMatch(skill, /npx tsx scripts\/stage-skill\.ts/);
    assert.doesNotMatch(skill, /(?:^|\n)\s*clawhub skill publish \./);
    assert.match(skill, /[Nn]ever publish the monorepo root|[Dd]o \*\*not\*\*.*monorepo root/);
  });

  it("skill adoption step files a ledger intake PR, not a Moltbook post", () => {
    const skill = readFileSync(
      join(root, "harness", "shared", "prompt", "SKILL.md"),
      "utf8",
    );
    assert.match(skill, /FIDES-ANIMA\/protocol-attestation-ledger/);
    assert.match(skill, /LEDGER-ATTESTATION\.yaml/);
    assert.match(skill, /declaration-only/);
    assert.doesNotMatch(skill, /post to Moltbook|MOLTBOOK-MANIFESTO|m\/constitution/);
  });

  it("active governance docs use canonical harness paths", () => {
    const claims = readFileSync(
      join(root, "docs", "governance", "examples", "graded-adoption-claims.json"),
      "utf8",
    );
    assert.match(claims, /harness\/shared\/harness-capabilities\.json/);
    assert.doesNotMatch(claims, /adapters\/harness-capabilities\.json/);

    const lifecycle = readFileSync(
      join(root, "docs", "governance", "ADOPTION_LIFECYCLE.md"),
      "utf8",
    );
    assert.match(lifecycle, /harness\/shared\/prompt\/adoption\/MEMORY-ENTRY\.md/);
    assert.doesNotMatch(lifecycle, /(?<!harness\/shared\/prompt\/)adoption\/MEMORY-ENTRY\.md/);
  });
});
