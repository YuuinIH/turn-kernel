# Approved blueprint v0.2 implementation

Build separate modules, not a single implementation file. Keep old experimental sessions compatible. Strict TS: no any, double assertions or ts-ignore.

1. Typed objects/references and relations: runtime object validation, session/type/liveness checks, cardinality/cycle/deletion checks, controlled writes.
2. Modifier and dependency queries: numerical add/multiply with deterministic combination, source/flow lifetime, dynamic dependency tracing, cycle errors, read-only evaluation, validated finite values.
3. Operation protocol: typed serializable requests, read-only behavior capabilities, declared write authority, before adjustments/replacements and post reactions with bounded deterministic execution. Roll back one candidate on failure.
4. Serializable flow protocol: explicit step/wait/child/return/fault, prompt IDs, bounded advancement, RNG state. No transaction held across waiting.
5. Durable session: storage CAS with fencing and lease, same-ID same-payload receipts, uncertain outcome recovery, restart. In-memory and real Redis adapters share contract tests. No login/room service scope.
6. Mindbug uses shared operation, flow and relation contracts; pet/mark fixture exercises healing, attachment, attack/cost modifiers, shield/damage and multi-hit switch/resume. Existing Mindbug behavior remains verified.

Trusted game implementations define schemas/invariants. Content code gets queries and allowed operations, not arbitrary writes. No sandbox for malicious TS. Checkpoints are complete submissions. Redis durability depends on server persistence/replication configuration; atomic CAS does not itself promise zero data loss.
