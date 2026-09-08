/**
 * skill-self-check.ts — prompt/install integrity check for the ClawHub skill.
 *
 * Does NOT import the enforcement plugin classifier and does NOT exercise
 * dispatcher-layer decisions. For classifier fixtures, clone the monorepo
 * and run `npm run self-test`, or install clawhub:ovrsr/openclaw-fpp-plugin.
 *
 * Usage:
 *   npx tsx scripts/skill-self-check.ts [--root <dir>] [--json]
 *   npx tsx harness/openclaw/scripts/skill-self-check.ts --root . [--json]
 *
 * A monorepo root (package.json workspaces) is not a ClawHub skill. Those
 * invocations validate harness/openclaw/skill-dist after `stage-skill`.
 * Flattened standalone skill roots (ClawHub install / skill-dist) are
 * checked in place.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "..");

export type SkillSelfCheckReport = {
  ok: boolean;
  checks: { id: string; ok: boolean; detail: string }[];
  notes: string[];
};

const REQUIRED_FILES = [
  "SKILL.md",
  "constitution.json",
  "pubkey.ed25519.txt",
  "signature.ed25519.txt",
  "package.json",
  "scripts/verify-constitution.ts",
  "scripts/safe-append.ts",
  "scripts/revoke.ts",
  "scripts/skill-lib/index.ts",
];

const RUNTIME_DEPS = ["@noble/ed25519", "@noble/hashes"] as const;

/** Staged ClawHub skill root relative to the git monorepo. */
export const MONOREPO_SKILL_STAGE_REL = "harness/openclaw/skill-dist";

const NOTES = [
  "This skill self-check does not exercise the dispatcher classifier.",
  "Install clawhub:ovrsr/openclaw-fpp-plugin for mechanical tool gating,",
  "or clone the GitHub monorepo to run npm run self-test (classifier fixtures).",
];

function readPackageJson(pkgPath: string): { workspaces?: unknown } | null {
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")) as { workspaces?: unknown };
  } catch {
    return null;
  }
}

function packageHasWorkspaces(
  pkg: { workspaces?: unknown } | null,
): boolean {
  return pkg !== null && pkg.workspaces !== undefined;
}

/**
 * Verify skill-root scripts can resolve @noble/* (needed by verify / verify-install).
 * ClawHub installs often omit node_modules — operators must `npm install` in the skill dir.
 */
export function checkSkillRuntimeDeps(rootDir: string): {
  ok: boolean;
  detail: string;
} {
  const pkgPath = join(resolve(rootDir), "package.json");
  if (!existsSync(pkgPath)) {
    return {
      ok: false,
      detail:
        "package.json missing — cannot resolve @noble/ed25519. Run `npm install` in the skill directory after install.",
    };
  }
  const require = createRequire(pkgPath);
  const missing: string[] = [];
  for (const spec of RUNTIME_DEPS) {
    try {
      require.resolve(spec);
    } catch {
      missing.push(spec);
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      detail: `Cannot resolve ${missing.join(", ")}. Run \`npm install\` in the skill directory before \`npm run verify\` / \`verify-install\`.`,
    };
  }
  return {
    ok: true,
    detail: `${RUNTIME_DEPS.join(" and ")} resolvable from skill root`,
  };
}

export function runSkillSelfCheck(opts: {
  rootDir?: string;
}): SkillSelfCheckReport {
  const requestedRoot = resolve(opts.rootDir ?? DEFAULT_ROOT);
  const checks: SkillSelfCheckReport["checks"] = [];

  const requestedPkg = readPackageJson(join(requestedRoot, "package.json"));
  const isMonorepo = packageHasWorkspaces(requestedPkg);
  let checkRoot = requestedRoot;

  if (isMonorepo) {
    checkRoot = join(requestedRoot, ...MONOREPO_SKILL_STAGE_REL.split("/"));
    const stageOk = existsSync(checkRoot);
    checks.push({
      id: "stage.skill-dist",
      ok: stageOk,
      detail: stageOk
        ? `validating ${MONOREPO_SKILL_STAGE_REL}`
        : `missing: ${MONOREPO_SKILL_STAGE_REL} — run \`npx tsx harness/openclaw/scripts/stage-skill.ts\``,
    });
    if (!stageOk) {
      return { ok: false, checks, notes: NOTES };
    }
  }

  for (const rel of REQUIRED_FILES) {
    const path = join(checkRoot, rel);
    const ok = existsSync(path);
    checks.push({
      id: `file.${rel}`,
      ok,
      detail: ok ? "present" : `missing: ${rel}`,
    });
  }

  const deps = checkSkillRuntimeDeps(checkRoot);
  checks.push({
    id: "deps.noble",
    ok: deps.ok,
    detail: deps.detail,
  });

  const skillPath = join(checkRoot, "SKILL.md");
  if (existsSync(skillPath)) {
    const skill = readFileSync(skillPath, "utf8");
    const hasFrontmatter = skill.startsWith("---");
    checks.push({
      id: "skill.frontmatter",
      ok: hasFrontmatter,
      detail: hasFrontmatter ? "YAML frontmatter present" : "missing frontmatter",
    });
  }

  const stagedPkg = readPackageJson(join(checkRoot, "package.json"));
  if (stagedPkg) {
    if (packageHasWorkspaces(stagedPkg)) {
      checks.push({
        id: "package.no-workspaces",
        ok: false,
        detail: "staged skill package.json must not declare npm workspaces",
      });
    } else {
      checks.push({
        id: "package.no-workspaces",
        ok: true,
        detail: "no npm workspaces (OpenClaw skill layout)",
      });
    }
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks, notes: NOTES };
}

function main(): void {
  const argv = process.argv.slice(2);
  let rootDir = DEFAULT_ROOT;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) rootDir = resolve(argv[++i]!);
    else if (argv[i] === "--json") json = true;
  }

  const report = runSkillSelfCheck({ rootDir });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("Freedom Preserving Protocol — skill self-check (prompt-layer)\n");
    for (const c of report.checks) {
      console.log(`${c.ok ? "✓" : "✗"} ${c.id}: ${c.detail}`);
    }
    console.log("");
    for (const n of report.notes) console.log(n);
    console.log("");
    console.log(report.ok ? "Skill package layout OK." : "Skill package layout FAILED.");
  }
  process.exit(report.ok ? 0 : 1);
}

const isDirect =
  process.argv[1] &&
  normalize(fileURLToPath(import.meta.url)) ===
    normalize(resolve(process.argv[1]));

if (isDirect) {
  main();
}
