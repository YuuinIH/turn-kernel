# v0.7 lifecycle review

Scope: object-declared flow lifecycle, automatic before/after scheduling, permission-checked input replacement/cancellation, ordered controlled reactions including resumable child flows, and pet-duel consumer integration. Spec: `flow-lifecycle.md`. Review baselines: kernel e3980a1508e0d12bb453f6f26326f5bf0d3680ce, lab 243af4ad1d95032af6eb9706d59b932232245d3d.

## Standards

Independent read-only review found one P3: game-level shared hooks used `unknown` rather than concrete result types. Replaced with the named union of hit input and strike settlement result. Reviewer verified the fix; no unresolved standards findings.

## Spec

Independent read-only review found no concrete spec violations. Reviewed automatic invocation, opt-in capabilities, input/result validation, cancellation, reaction permissions and ordering, checkpoint progress, rollback, and lab integration. Dynamic effect instances, auras and synchronous operation lifecycle remain explicitly deferred.

## Verification

- Kernel `REQUIRE_REDIS=1 npm run check`: 54 passed, zero failed or skipped, including real Redis.
- Lab `npm run check`: 23 passed, zero failed or skipped.
- Typecheck after narrowing the shared game hook result passed.
- Lifecycle tests include ordering across an after-reaction wait and restore, explicit child/root cancellation, denied replacement/cancellation/operations, malformed checkpoints, bounded fan-out, output schema rejection, worker fencing, receipt deduplication and rollback to the last committed wait.

No legacy checkpoint compatibility is provided. Candidate after hooks do not imply durable acknowledgement. Trusted rule code remains responsible for avoiding external I/O and mutable closure state.
