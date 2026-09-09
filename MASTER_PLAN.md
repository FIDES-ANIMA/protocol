# Freedom-Preserving Protocol master organizational alignment plan

**Status:** PENDING
**Created:** 2026-09-09
**Lifecycle:** PENDING → COMPLETE → VERIFIED. COMPLETE requires implementation evidence; VERIFIED requires a separate review. Creating this document completes neither.
**Planning authority:** `I:/Dev/Projects/FIDES-ANIMA/skills/plan/SKILL.md`. Root placement of master documents follows the user's explicit request; detailed subplans use `docs/plans/YYYY-MM-DD-<name>.md`.

## Summary

Finish public identity and evidence claims around the existing protocol; no new protocol implementation.

## Architecture

Governed by [org master](../MASTER_PLAN.md) and [org roadmap](../ORG_ROADMAP.md). CAPABILITY_STATUS remains the technical ceiling. Reuse 2026-09-08 npm staging and npm-publish runbook. Ledger declarations remain a separate assurance domain.

## Scope (In/Out)

In: org claim reconciliation, canonical metadata/distribution, licensing, custody disclosure, one technical-review request and conditional RFC submission.

Out: No new funding, lab affiliation, or second engineer is assumed. No ledger-growth target, new protocol feature, additional harness, telemetry dashboard, ZK compliance proof, sub-agent vouching, post-quantum migration, decorative board, honorary AI founder, agent staff roster, competing foundation, or new amendment/Sybil design enters this work. High audit issues remain in the separate engineering workstream and can block release or adoption evidence. Existing implementations are not removed or promoted by this plan. No signed constitution, declaration, admission history, or key material is rewritten for editorial purposes.

## Progress Tracking

- [ ] Task 1: Reconcile public protocol claims with the org ceiling
- [ ] Task 2: Complete the canonical supply chain
- [ ] Task 3: Reconcile artifact licensing
- [ ] Task 4: Separate authorship from steward authority in documentation
- [ ] Task 5: Prepare truthful upstream technical review
- [ ] Task 6: Verify public claims and preserve the feature freeze

## Implementation Tasks

### Task 1: Reconcile public protocol claims with the org ceiling

**Objective:** Keep technical capability distinct from institutional custody, adoption and review.

**Files:**
- Modify: `README.md`
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `docs/external/ratification/README.md`
- Create: `docs/evidence/2026-09-09-org-claims-review.md`

**Implementation Steps:**
1. Execute [the first subplan](docs/plans/2026-09-09-01-protocol-org-claims.md).
2. Link the org ceiling and identify present solo authorship/steward custody.
3. Keep shipped code status accurate while explicitly disclaiming independent institutional quorum, gateway non-bypassability and peer review.

**Definition of Done:**
- [ ] No technical SHIPPED row is mistaken for organizational separation or proven adoption.
- [ ] Ratification material is labeled multi-model lab notes and no external-review claim is inferred from model count.

### Task 2: Complete the canonical supply chain

**Objective:** Use the existing npm staging work and make install claims match tested distribution.

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `harness/openclaw/README.md`
- Modify: `harness/openclaw/skill/README.md`
- Modify: `harness/openclaw/plugin/README.md`
- Modify: `harness/openclaw/plugin-trust/README.md`
- Modify: `docs/runbooks/npm-publish.md`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`

**Implementation Steps:**
1. Inventory active manifests/install commands and build an exact affected-file list before editing; preserve historical attribution and old plans.
2. Set repository.url to https://github.com/FIDES-ANIMA/protocol; align active package metadata using the already-staged @fides-anima names without changing plugin IDs.
3. Verify live npm and ClawHub ownership/version at implementation time. Until release evidence exists, label names staged/unpublished and disclose verified ovrsr coordinates where needed.
4. After Task 3 and separate release blockers pass, use existing runbook for an authorized release or retain the honest fallback. Verify tarball contents and clean installation from the exact advertised source.
5. Coordinate predecessor README redirect with org Task 2; no duplicate source home.

**Definition of Done:**
- [ ] Every advertised command works from a clean environment and identifies version/source; dry-run is never publication evidence.
- [ ] npm run verify:all and npm run publish:npm:dry pass for metadata/package changes, or blockers are recorded without claiming completion.

### Task 3: Reconcile artifact licensing

**Objective:** Resolve root MIT-0 versus Humanitarian Use License discrepancies through the org rights decision.

**Files:**
- Modify: `LICENSE`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/runbooks/npm-publish.md`

**Implementation Steps:**
1. Inventory all workspace/harness LICENSE and package.json files plus prompt bundle notices; write exact paths in the root licensing decision before modification.
2. Apply org Task 7 approved per-class identities; retain third-party rights and avoid changing signed constitutional bytes.
3. Inspect packed artifacts using existing dry-run tooling, checking license text, metadata, source URL and bundled dependencies.

**Definition of Done:**
- [ ] Canonical table, local notices and packed licenses agree; no protocol-created jurisdiction claim.
- [ ] Release stays blocked until contradictory or unknown rights are resolved.

### Task 4: Separate authorship from steward authority in documentation

**Objective:** State what present human custody can and cannot support.

**Files:**
- Modify: `docs/governance/KEY_GOVERNANCE.md`
- Modify: `docs/governance/README.md`
- Modify: `README.md`

**Implementation Steps:**
1. Link the org stewardship notice and ledger succession procedure; distinguish constitution signing, release signing and admission keys.
2. Disclose authorship/review conflict; no second address, agent, or key counts as independent review.
3. Freeze social claims about emergency override and quorum until independently staffed; retain accurate implementation status and existing safety floors.

**Definition of Done:**
- [ ] Current sole-principal status is explicit and no trust-root/key migration is smuggled into editorial work.

### Task 5: Prepare truthful upstream technical review

**Objective:** Use the Foundation intake when it exists and distinguish drafting, discussion and acceptance.

**Files:**
- Modify: `docs/rfc/SUBMISSION.md`
- Modify: `docs/rfc/AOS-COORDINATION.md`
- Create: `docs/rfc/CLAIM_CLASS_REVIEW_REQUEST.md`

**Implementation Steps:**
1. Check official current venue and intake instructions during implementation; record URL and date, including absence of intake.
2. Prepare one Discussion focused on CAPABILITY_STATUS and EVIDENCE_SEMANTICS limitations and one concrete request for technical criticism; coordinate with adjacent work.
3. Publish only with explicit message authorization and an actual venue; record public thread and substantive response separately.
4. Submit RFC 0001 only after official intake exists and REVIEW_CHECKLIST is satisfied. Keep draft / discussed / submitted / accepted / merged / shipped as different states.

**Definition of Done:**
- [ ] No fabricated submission date, accepted status or foundation relationship.
- [ ] Unavailable intake keeps RFC deferred; no new foundation or harness development.

### Task 6: Verify public claims and preserve the feature freeze

**Objective:** Close protocol org work without advancing its feature roadmap.

**Files:**
- Create: `docs/evidence/2026-09-09-org-verification.md`
- Modify: `docs/ROADMAP.md`

**Implementation Steps:**
1. Add only an org-priority/freeze pointer to the existing roadmap; preserve historical feature status and separate High-issue work.
2. Review cross-repo claims, distribution evidence, license consistency and upstream status; record public/local distinction.
3. Confirm no runtime, signed constitution or scope expansion in editorial diffs; run relevant existing package checks only when manifest or packaging changes warrant them.

**Definition of Done:**
- [ ] Deferred features remain deferred and org work does not claim protocol implementation completion.
- [ ] All remaining claims link to evidence or explicit limits.

## Testing Strategy

Editorial-only changes need targeted claim/link/diff review. Package metadata changes use existing package-contract checks through npm run verify:all and npm run publish:npm:dry, followed by clean advertised installation during release verification. Existing CI documents Node/runtime prerequisites. No npm publish, RFC posting or runtime modifications occur in planning.

## Risks and Mitigations

Staged package mistaken for registry artifact → record versioned live evidence. Technical quorum mistaken for independent humans → explicit custody note. License mismatch → rights decision before release. Missing Foundation intake → keep deferred. Security blockers remain in their separate workstream; passing packaging does not close them.


## Implementation Handoff

Review this PENDING plan before implementation. Re-read it after confirmation; run `/clear`, then `/implement <this-plan-path>`. Implement one task at a time and retain evidence for a separate `/verify` pass. Planning creates no publication, submission, registry release, custody transfer, or admission. External messages require explicit authorization; do not treat this planning request as authorization to send them.

