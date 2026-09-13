# Settlement values (v0.6)

Scope: registered component attributes remain reusable queries; per-action intermediate numbers belong to a settlement instance. Both use stable add-then-multiply arithmetic. This module is checkpoint data and validation, not a second execution engine or a generic expression language.

## Declaration and lifecycle

`defineSettlement({ id, version, input, stages, values })` declares canonical input data, an ordered list of stage names and a closed set of named numeric values. Each value belongs to one stage and can supply a final numeric constraint. Register the definition in the ruleset's `settlement` category. Definitions use trusted deterministic callbacks and version changes must accompany semantic changes.

```ts
const damage = defineSettlement({
  id: "damage", version: "1",
  input: z.strictObject({ attack: z.number().nonnegative() }),
  stages: ["sample", "defense"],
  values: {
    raw: { stage: "sample" },
    final: { stage: "defense", constrain: n => Math.max(0, Math.floor(n)) },
  },
});
let s = damage.start({ sessionId: "match", id: frame.id }, { attack: 15 });
s = damage.seed(s, "raw", s.input.attack);
s = damage.advance(s);
s = damage.seed(s, "final", damage.read(s, "raw"));
// Save s in frame.data before waiting for a defensive choice.
```

- `seed` records a fixed stage input once. The caller chooses when to sample component attributes and explicitly supplies computed numbers; later world changes never silently resample them.
- `ref` creates a settlement-value address containing session, settlement instance, definition and local name. Component modifier addresses are structurally different. A repeated hit needs a new identity; the example uses the unique Flow frame ID. For repeated settlements inside one frame, the host must append a persisted occurrence counter.
- `modify` accepts a numeric term for an already seeded value in the currently open stage. IDs cannot repeat within the settlement. Cross-instance/session/definition addresses and out-of-stage writes fail.
- `read` recomputes from fixed base and matching terms while the stage is open. Repeated reads do not apply terms to previously calculated results.
- `advance` requires every declared value in the current stage to be seeded, freezes their results and opens the next stage. The final stage produces `ready`.
- `complete` accepts only `ready`; `cancel` accepts `open` or `ready`. Completed/cancelled settlements reject further changes. The final game operation remains responsible for domain checks and actual world writes.

All functions detach their arguments. Snapshot parsing validates definition/version, canonical inputs, stage/status, declared value names, finite numbers, required past values, matching frozen arithmetic, and every modifier address. Parsing does not prove historical reachability or authenticate a checkpoint. Callbacks are trusted and must remain deterministic; repeated validation may call numeric constraints again.

A settlement modifier records an already accepted effect. Its source reference is provenance and must be in the same session. It is not a live component modifier: the source disappearing later does not revoke a previously accepted per-hit effect. Game rules check source authority/liveness before accepting it (the example rechecks the defending pet). Retained terms explain frozen results; terminal terms no longer act on future settlements. No automatic source-delete subscription is introduced.

## Integration with Flow, Operation and storage

Synchronous work can keep its settlement in local variables. Waiting work saves the entire settlement in Frame data. The game validates that the settlement ID/session match that frame/session, and that its status/stage agree with the flow step. Canonical stage arithmetic and game-specific sampling invariants are checked on restore.

The pet `strike` flow samples attack and randomness, consumes the RNG state once through a controlled operation, then waits **before damage is applied**. The defender's `respond` command may add a 0.5 modifier to this hit's incoming damage. After sealing the value, `apply-strike` rechecks current participants and health, applies shield/HP writes, and emits damage facts. Completion and damage commit occur in the same Flow candidate; operation failure rolls back the candidate. The finished result preserves the completed settlement for inspection.

The module does not make calling a pure `complete` function a durable commit, and cannot prevent a caller reusing an older copy by itself. Flow state, session revisions, storage fencing and request receipts enforce single application at the public command boundary. Previously committed work (including RNG consumed at a wait) is not undone by a later rejected command.

## Acceptance scenarios

- Repeated reads are stable; closed stages reject new terms; impossible stage snapshots and changed frozen results fail.
- Two hits never share modifiers; component and settlement references are not interchangeable.
- A pending strike survives JSON restoration; changing a valid world's attack after sampling does not change the stored hit, and resumption does not consume RNG again.
- Invalid choices or no-longer-eligible participants preserve the checkpoint.
- Another worker resumes pending damage; successful request retries return the receipt, and the old worker is fenced out.

Initial scope is finite numeric intermediate values and fixed stage ordering. Structured metadata belongs to the input schema. Dynamic branching remains in Flow; no arbitrary serializable expressions, arbitrary rewind, per-value state machine, or migration layer is added.
