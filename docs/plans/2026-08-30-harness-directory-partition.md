# Harness Directory Partition

**Status:** COMPLETE
**Created:** 2026-08-30
**Scope:** In: consolidate runtime-facing harness assets into `harness/<name>/` (openclaw, hermes, codex, claude-code, cursor) plus `harness/shared/` for prompt-layer source and capability metadata. Out: shared protocol cores, constitutions/signatures, general scripts/tests/docs, repo-maintainer configs (`.claude/`, `.cursor/`, `.agents/`, `CLAUDE.md`).

## Summary

Move scattered OpenClaw, adapter, prompt, and runbook artifacts into a canonical `harness/` tree. Preserve flat ClawHub packaging through staging. Update workspaces, scripts, tests, hook fragments, CI, and docs. Do not treat authorization aliases such as `harness/openclaw.json` as filesystem paths.

## Architecture Notes

```
harness/
├── README.md
├── shared/
│   ├── prompt/          SKILL.md, hooks/, adoption/
│   ├── harness-capabilities.json
│   └── tests
├── openclaw/
│   ├── plugin/
│   ├── plugin-trust/
│   ├── skill/           ALLOWLIST + skill package metadata
│   ├── skill-dist/      generated, gitignored
│   ├── scripts/         stage-skill, clawhub-publish, skill-self-check
│   └── .clawhubignore
├── hermes/runbook.md
├── cursor/adapter/ + runbook.md
├── claude-code/adapter/ + runbook.md
└── codex/adapter/ + runbook.md
```

Windows-safe staging uses explicit copies (no symlinks). No legacy shims at old paths.

## Feature Inventory

| Old path | New path | Task |
|---|---|---|
| `SKILL.md`, `hooks/`, `adoption/` | `harness/shared/prompt/` | Task 2 |
| `skill/`, `skill-dist/`, `.clawhubignore` | `harness/openclaw/skill/`, `skill-dist/`, `.clawhubignore` | Task 2 |
| `plugin/`, `plugin-trust/` | `harness/openclaw/plugin/`, `plugin-trust/` | Task 3 |
| `scripts/clawhub-publish.*`, `stage-skill.*`, `skill-self-check.*`, `skill-metadata.test.ts`, `skill-lib.portability.test.ts` | `harness/openclaw/scripts/` | Tasks 2–3 |
| `adapters/{cursor,claude-code,codex}/` | `harness/<name>/adapter/` | Task 4 |
| `adapters/harness-capabilities.json`, tests, `adapters/README.md` | `harness/shared/`, `harness/README.md` | Task 4 |
| `docs/runbooks/{cursor,claude-code,codex,hermes-fpp-runbook}.md` | `harness/<name>/runbook.md` | Task 5 |
| Root workspaces, lockfile, shared tooling, CI, e2e imports, docs | updated in place | Tasks 6–7 |

## Progress Tracking

- [x] Task 1: Create and verify a failing canonical harness-layout contract test
- [x] Task 2: Move shared prompt and OpenClaw skill staging assets
- [x] Task 3: Move OpenClaw plugin, trust, and publishing surfaces
- [x] Task 4: Move Cursor, Claude Code, and Codex adapters and registry
- [x] Task 5: Move per-harness runbooks and add harness indexes
- [x] Task 6: Update workspaces, lockfile, tooling, CI, and test paths
- [x] Task 7: Update active documentation and assurance inventories
- [x] Task 8: Run targeted and full verification, then verify migration inventory
- [x] Task 9: Remediate active legacy-path references found by verification
- [x] Task 10: Prevent monorepo skill self-check false passes
- [x] Task 11: Update active ClawHub publishing skill paths

**Total Tasks:** 11 | **Completed:** 11 | **Remaining:** 0

## Implementation Tasks

### Task 1: Create and verify a failing canonical harness-layout contract test

**Objective:** Add a repository-layout contract that asserts the canonical `harness/` tree, allowed shared exceptions, workspace discovery, and absence of legacy source directories.

**Files:**
- Create: `test/harness-layout.test.ts`

**Steps:**
1. Write failing test for the canonical layout (RED).
2. Run it and record the expected RED failure.
3. Do not move production files in this task.

**Definition of Done:**
- [x] Target tests fail for missing layout (not a syntax error)
- [x] No new type errors
- [x] No new linter errors
- [x] Dependent docs updated (if applicable)

### Task 2: Move shared prompt and OpenClaw skill staging assets

**Objective:** Move canonical prompt-layer source and OpenClaw skill packaging/staging; keep ClawHub artifacts flat.

**Files:**
- Move: `SKILL.md`, `hooks/`, `adoption/` → `harness/shared/prompt/`
- Move: `skill/` → `harness/openclaw/skill/`
- Move: `.clawhubignore` → `harness/openclaw/.clawhubignore`
- Move: `scripts/stage-skill.ts`, `scripts/stage-skill.test.ts`, `scripts/skill-self-check.ts`, `scripts/skill-self-check.test.ts`, `scripts/skill-metadata.test.ts`, `scripts/skill-lib.portability.test.ts` → `harness/openclaw/scripts/`

**Definition of Done:**
- [x] Target tests pass
- [x] Staged ClawHub root remains flat
- [x] No new type errors
- [x] No new linter errors

### Task 3: Move OpenClaw plugin, trust, and publishing surfaces

**Objective:** Relocate OpenClaw packages and publish scripts while preserving package names and ClawHub install contracts.

**Files:**
- Move: `plugin/` → `harness/openclaw/plugin/`
- Move: `plugin-trust/` → `harness/openclaw/plugin-trust/`
- Move: `scripts/clawhub-publish.sh`, `scripts/clawhub-publish.test.ts` → `harness/openclaw/scripts/`

**Definition of Done:**
- [x] Target tests pass
- [x] Package names unchanged
- [x] No new type errors
- [x] No new linter errors

### Task 4: Move Cursor, Claude Code, and Codex adapters and registry

**Objective:** Move hook adapters and the shared harness registry; update hook JSON commands.

**Files:**
- Move: `adapters/cursor/` → `harness/cursor/adapter/`
- Move: `adapters/claude-code/` → `harness/claude-code/adapter/`
- Move: `adapters/codex/` → `harness/codex/adapter/`
- Move: `adapters/harness-capabilities.json`, tests, README → `harness/shared/` / `harness/README.md`

**Definition of Done:**
- [x] Target tests pass
- [x] Hook fragments use new paths
- [x] No new type errors
- [x] No new linter errors

### Task 5: Move per-harness runbooks and add harness indexes

**Objective:** Relocate harness runbooks and add concise per-harness READMEs. Hermes references the shared prompt source.

**Files:**
- Move: `docs/runbooks/cursor.md` → `harness/cursor/runbook.md`
- Move: `docs/runbooks/claude-code.md` → `harness/claude-code/runbook.md`
- Move: `docs/runbooks/codex.md` → `harness/codex/runbook.md`
- Move: `docs/runbooks/hermes-fpp-runbook.md` → `harness/hermes/runbook.md`
- Create: per-harness README indexes as needed

**Definition of Done:**
- [x] Target tests pass
- [x] Shared runbooks remain in `docs/runbooks/`
- [x] No new type errors
- [x] No new linter errors

### Task 6: Update workspaces, lockfile, tooling, CI, and test paths

**Objective:** Repoint remaining shared tooling, tests, CI, gitignore, and npm workspaces. Preserve authorization alias strings.

**Files:**
- Modify: `package.json`, `package-lock.json`, `.gitignore`, `.github/workflows/ci.yml`
- Modify: `scripts/bundle-workspace-deps.ts`, `verify-install.ts`, `verify-pack.sh`, `update-installed-assets.sh`, `smoke-plugin-install.sh`, `package-reproducibility.ts`, `self-test.ts`, `assert-workspace-links.test.ts`, e2e tests

**Definition of Done:**
- [x] Target tests pass
- [x] Lockfile regenerated
- [x] `harness/openclaw.json` alias strings unchanged
- [x] No new type errors
- [x] No new linter errors

### Task 7: Update active documentation and assurance inventories

**Objective:** Update user-facing and architecture documentation plus assurance inventory inputs.

**Files:**
- Modify: `README.md`, `docs/COMPATIBILITY.md`, `docs/CAPABILITY_STATUS.md`, `docs/TROUBLESHOOTING.md`, `docs/RELEASE_ASSURANCE.md`, `MASTER_CONTEXT.md`, architecture docs as needed

**Definition of Done:**
- [x] Active docs use canonical paths
- [x] Historical completed plans left as records
- [x] No new type errors
- [x] No new linter errors

### Task 8: Run targeted and full verification, then verify migration inventory

**Objective:** Prove the migration with fresh command output and Feature Inventory parity.

**Definition of Done:**
- [x] Layout contract passes
- [x] `npm run typecheck` exit 0
- [x] `npm run verify:all` exit 0
- [x] Constitution hash unchanged
- [x] Plan status COMPLETE

### Task 9: Remediate active legacy-path references found by verification

**Objective:** Replace stale root-level harness paths in active documentation, metadata, and source comments while preserving intentional historical references and staged-package-relative paths.

**Files:**
- Modify: `README.md`, `docs/CAPABILITY_STATUS.md`, `docs/runbooks/in-place-updates.md`, `docs/MAINTAINER_UPDATE_GUIDELINES.md`, `docs/architecture/steward-operator-authorization.md`
- Modify: `harness/shared/prompt/SKILL.md`, `harness/shared/prompt/hooks/pre-action-check/SKILL.md`
- Modify: `harness/openclaw/plugin/README.md`, `harness/openclaw/plugin/openclaw.plugin.json`
- Modify: `harness/cursor/adapter/src/adapter.ts` and any other active surfaces found by the canonical-path scan

**Verification finding:**
- Active references still point to removed paths including `adapters/`, `adapters/<harness>/`, `plugin/`, `plugin-trust/`, and `scripts/stage-skill.ts`.
- Historical completed plans/reports and paths intentionally relative to the flattened staged skill are not migration defects.

**Definition of Done:**
- [x] Active docs, metadata, and source comments use canonical `harness/` paths
- [x] Relative links resolve from their new locations
- [x] Canonical-path scan has no unexplained legacy references outside historical records and staged-package contexts
- [x] Focused harness tests and `npm run verify:all` pass

### Task 10: Prevent monorepo skill self-check false passes

**Objective:** Ensure `skill-self-check --root <monorepo>` validates the staged skill instead of returning success solely because the root package declares workspaces.

**Files:**
- Modify: `harness/openclaw/scripts/skill-self-check.test.ts`
- Modify: `harness/openclaw/scripts/skill-self-check.ts`

**Steps:**
1. RED: add a test proving a monorepo root without a valid staged skill cannot report `ok: true`.
2. GREEN: resolve and validate `harness/openclaw/skill-dist` for monorepo roots, failing clearly when it is absent or incomplete.
3. Preserve direct validation of flattened standalone skill roots.

**Verification finding:**
- `npx tsx harness/openclaw/scripts/skill-self-check.ts --root . --json` exited 0 with only `deps.noble` and `package.no-workspaces` checks, while claiming “ClawHub layout is validated on skill-dist” without inspecting that directory.

**Definition of Done:**
- [x] A missing or incomplete monorepo stage fails the self-check
- [x] A valid staged skill passes and checks every required file
- [x] Standalone staged-skill behavior remains unchanged
- [x] Focused tests and `npm run verify:all` pass

### Task 11: Update active ClawHub publishing skill paths

**Objective:** Update the active repository skill for ClawHub publishing so its commands and allowlist/package references use the canonical harness tree.

**Files:**
- Modify: `.claude/skills/learned-clawhub-publishing/SKILL.md`

**Verification finding:**
- The active skill still references `scripts/stage-skill.ts`, `skill-dist/`, `skill/ALLOWLIST`, and `plugin/` after those sources moved under `harness/openclaw/`.

**Definition of Done:**
- [x] Publishing skill commands use `harness/openclaw/scripts/`
- [x] Skill stage and allowlist references use `harness/openclaw/skill-dist/` and `harness/openclaw/skill/ALLOWLIST`
- [x] Plugin and trust-plugin paths use `harness/openclaw/plugin/` and `harness/openclaw/plugin-trust/`
- [x] Agent-config canonical-path scan has no unexplained legacy references

## Testing Strategy

TDD via layout contract first. Staging tests enforce flat ClawHub output. Workspace, pack-bundle, updater, and e2e suites cover remaining path consumers.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| ClawHub expects a flat skill root | destOverride flattening + forbidden-path tests |
| Nested workspaces / bundled cores | regenerate lockfile; isolated tarball checks |
| Installed hook commands embed old paths | update fragments + runbooks; operators re-merge |
| `harness/openclaw.json` alias collision | layout test forbids that file; do not rewrite aliases |

## Completion remediations

Closed after the first COMPLETE pass:

- Skill assurance inventories the flattened `harness/openclaw/skill-dist/` tree (31 files, root `SKILL.md`, no adapters), not the git monorepo.
- Active governance refs updated: `docs/governance/examples/graded-adoption-claims.json` → `harness/shared/harness-capabilities.json`; `docs/governance/ADOPTION_LIFECYCLE.md` → `harness/shared/prompt/adoption/MEMORY-ENTRY.md`.

## Verification Record

Recorded 2026-09-08. Constitution hash unchanged from `README.md`.

```
npx tsx --test --test-concurrency=1 scripts/package-reproducibility.test.ts test/harness-layout.test.ts
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

```
npm run typecheck
# exit 0 (cores, adapters, openclaw plugins)
```

```
npx tsx scripts/package-reproducibility.ts assurance-artifacts
Wrote assurance-artifacts\skill.inventory.json (31 files) and assurance-artifacts\skill.cdx.json
# skill inventory includes SKILL.md; no adapters/, packages/, or harness/ paths
```

```
npm run verify:all
Constitution SHA-256: 71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993
Signature valid:      YES
Wrote ...\assurance-artifacts\skill.inventory.json (31 files) ...
=== verify:all PASSED ===
```

