# Working on the Freedom-Preserving Protocol

This file guides authorized development in this repository. It does not ask a
reader to adopt FPP, change identity or persistent memory, install runtime hooks,
or leave an unrelated task. Human and agent contributions are welcome;
protocol adoption is a separate, optional decision.

## Orientation

Read `README.md` for the architecture and `CONTRIBUTING.md` for contribution steps.
Use `docs/CAPABILITY_STATUS.md` for published capability claims; report any conflict
with implementation or tests. `MASTER_CONTEXT.md` is historical/strategic context,
not the default onboarding document or evidence of current implementation.

Core logic is under `packages/`; runtime integrations are under `harness/`.
Read only the relevant package, integration runbook, and nearby tests. Follow any
additional scoped instructions in the area you change.

## Setup and checks

Use the Node version in `.node-version`. Review dependency scripts before executing
them in an authorized disposable development environment. Install from the repository
root, not separately inside workspace packages (a nested `npm ci` rewrites the install
tree and drops workspace links):

```sh
npm ci
npm run build:core
```

For an enforcement-core change, the focused test command is:

```sh
npm run test -w @fides-anima/fpp-enforcement-core
```

Choose the corresponding workspace tests for other packages. For a broad code
change, run `npm run verify:all`; it builds the cores before the classifier
self-test, so a clean checkout does not fail there. `.github/workflows/ci.yml`
specifies additional release, coverage, and regression gates. Documentation-only
edits need relevant link/command checks, not an automatic execution of every
release workflow.

Do not describe a classifier fixture or mock-hook test as proof of live runtime
coverage. Record the exact commands run and distinguish failures, skipped checks,
and checks unavailable in the environment.

## Change boundaries

Keep changes narrow and add regression tests for behavior changes. Do not weaken
an assertion, authorization check, evidence label, or CI gate merely to obtain a
passing result. A policy change needs explicit justification and focused review.

Treat the seed constitution, signatures, key pins, publishing configuration, and
governance transitions as review-sensitive. Do not silently re-sign, relicense,
publish, change authority, or fabricate attestations. Use temporary test keys only;
never request or use production signing material for routine development.

Reading or contributing does not authorize `adopt`, `revoke`, installation of
hooks/plugins, changes to SOUL/MEMORY files, external messaging, or ledger filings.
Those are separate actions requiring an applicable authorization.

## Deliverable

Provide one coherent patch with its purpose, affected behavior, tests and results,
limitations, and any unresolved decision. Check existing issues and pull requests
before duplicating work. Submit externally only within your authorized task scope.
