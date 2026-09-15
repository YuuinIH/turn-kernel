# v0.7.1 Zod validation review

Baseline: kernel 2e2d411a10d3adaaa7e2f420250ad0aab126af4c. Spec: `zod-validation.md`. User clarification: trust TS-authored rule declarations when they compile; do not add runtime restrictions on those declarations. Zod targets data boundaries.

## Standards

Independent review noted inferred relation endpoints had lost their readonly component field. Resolved by keeping trusted relation definitions as TypeScript interfaces, restoring the readonly field and removing their added runtime schema validation. Reviewer verified the updated worktree. No unresolved findings.

## Spec

Independent review reproduced a callback-arity regression in the Zod-backed legacy list helper. Restored a unary callback wrapper and added a regression for `parse.list([0, 1, 2], parse.integer)` and negative-number rejection. Reviewer verified corrected source and test; no remaining concrete spec findings.

## Validation

- Final kernel `REQUIRE_REDIS=1 npm run check`: 60 tests passed, zero failed/skipped, including real Redis.
- Consumer `npm run check`: 23 passed; all three demos passed against the schema refactor. Its CI pins this kernel revision and repeats the checks against the final commit.
- Tests cover required opaque payloads, strict union branches, no numeric coercion, nested issue paths, JSON accessors rejected before evaluation, atomic session rejection, and unchanged restoration semantics.

The migration retains domain-state checks and JSON representation guards. Exported schemas are structural building blocks; engine/session parsers add semantic validation. No new effect model or compatibility layer was introduced.
