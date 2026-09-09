# Protocol subplan 1 — reconcile institutional claims

**Status:** PENDING
**Created:** 2026-09-09
**Lifecycle:** PENDING → COMPLETE → VERIFIED. COMPLETE requires implementation evidence; VERIFIED requires a separate review. Creating this document completes neither.
**Planning authority:** `I:/Dev/Projects/FIDES-ANIMA/skills/plan/SKILL.md`. Root placement of master documents follows the user's explicit request; detailed subplans use `docs/plans/YYYY-MM-DD-<name>.md`.

## Summary

Expand protocol master Task 1. Apply the organizational ceiling without changing technical evidence or adding features.

## Architecture

Parent: [MASTER_PLAN.md, Task 1](../../MASTER_PLAN.md). Root org ceiling governs institutional claims; CAPABILITY_STATUS governs technical status. Ratification navigation is editorial, not an independent review body.

## Scope (In/Out)

In: active README, capability explanation, lab-note labels and evidence review. Out: package release, license changes, RFC submission, code, signed constitution, stored research-source changes.

## Progress Tracking

- [ ] Task 1: Inventory claim surfaces and evidence
- [ ] Task 2: Apply the institutional ceiling
- [ ] Task 3: Label ratification discussions as lab notes
- [ ] Task 4: Verify cross-repo consistency

## Implementation Tasks

### Task 1: Inventory claim surfaces and evidence

**Objective:** Identify exact wording that implies more than present custody supports.

**Files:**
- Read only: `README.md`
- Read only: `docs/CAPABILITY_STATUS.md`
- Read only: `docs/external/ratification/README.md`
- Read only: `docs/rfc/SUBMISSION.md`
- Create: `docs/evidence/2026-09-09-org-claims-review.md`

**Implementation Steps:**
1. Record commit and dirty state; list active claims concerning institute, Prime Steward, role separation, external review, universal laws, quorum and emergency authority.
2. For each claim map technical support and institutional support separately; use the org single-principal baseline.
3. Inventory additional active navigation claims before editing; enumerate exact paths rather than a broad rewrite.

**Definition of Done:**
- [ ] Every proposed replacement has a source and a precise target.
- [ ] SHIPPED technical functions are not falsely downgraded merely because organizational separation is missing.

### Task 2: Apply the institutional ceiling

**Objective:** Make the protocol README compatible with the org reality.

**Files:**
- Modify: `README.md`
- Modify: `docs/CAPABILITY_STATUS.md`

**Implementation Steps:**
1. Add compact solo-maintainer/steward disclosure near the top and link the org ceiling plus ledger declaration-only limit.
2. Explain that implemented quorum/emergency mechanisms are not evidence of independently staffed institutional custody or review.
3. Preserve gateway draft/deferred status and grade limitations; do not elevate prompt-only adoption, self-tests or signed declarations into compliance evidence.
4. Remove or qualify universal-law and independent-stewardship marketing; no new roadmap items.

**Definition of Done:**
- [ ] No claim of independent organizational control is inferred from multiple keys or agents.
- [ ] Technical matrix statuses remain grounded in their existing evidence.

### Task 3: Label ratification discussions as lab notes

**Objective:** Remove peer-review implications while preserving historical material.

**Files:**
- Modify: `docs/external/ratification/README.md`
- Modify: `docs/evidence/2026-09-09-org-claims-review.md`

**Implementation Steps:**
1. Retitle the navigation as multi-model lab notes; state these are prompted model outputs and syntheses, not independent human peer review.
2. Retain non-normative status and UNRESOLVED ratification; preserve original transcripts and historical attribution.
3. List any additional navigation surfaces still needing correction as exact follow-up paths inside this task, without turning it into new governance design.

**Definition of Done:**
- [ ] Model count is not reviewer independence; no transcript is presented as ratification or institutional legitimacy.
- [ ] Original source material remains intact.

### Task 4: Verify cross-repo consistency

**Objective:** Close only the bounded claim correction.

**Files:**
- Modify: `docs/evidence/2026-09-09-org-claims-review.md`

**Implementation Steps:**
1. Review links to org and ledger ceilings and all targeted search matches; confirm RFC remains unsubmitted absent actual evidence.
2. Inspect diff to confirm no runtime code, package manifest or signed-constitution changes.
3. Record local checks and, after authorized publication, live page permalinks and revision; keep unperformed public checks pending.

**Definition of Done:**
- [ ] Three public narratives agree on sole stewardship, declaration-only assurance and limits.
- [ ] No network availability, publishing or external review is claimed from a local edit.

## Testing Strategy

Use targeted `rg` searches plus manual review of context and Markdown links. Do not create tests mirroring editorial phrases. No runtime suite is needed for these documentation-only changes; package verification belongs to master Tasks 2–3.

## Risks and Mitigations

A shipped mechanism can be confused with social legitimacy → separate columns and explicit note. Historical sources may contain stronger claims → preserve history but qualify navigation. The actual org profile may not be in this checkout → verify publication separately.


## Implementation Handoff

Review this PENDING plan before implementation. Re-read it after confirmation; run `/clear`, then `/implement <this-plan-path>`. Implement one task at a time and retain evidence for a separate `/verify` pass. Planning creates no publication, submission, registry release, custody transfer, or admission. External messages require explicit authorization; do not treat this planning request as authorization to send them.

