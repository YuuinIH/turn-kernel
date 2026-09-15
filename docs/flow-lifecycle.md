# Flow lifecycle (v0.7)

Object declarations only. `defineFlow` declares an entry, engine-owned Zod input/result schemas and optional `hooks.before` / `hooks.after` objects. Ordinary FlowDefinition steps remain private implementation details; no step hooks or global trigger registry are added. The executor invokes hooks automatically once per flow occurrence, not per step or resume.

Before handlers run synchronously in ascending order, then ID, on detached state/input. They may continue, replace input only if the flow supplies an independent replacement authorizer, or cancel only if the flow enables cancellation. Replacement is re-parsed and authorized before the next handler or body sees it. Before handlers cannot perform state writes or suspend. Use a child Flow in the body for a player decision.

After handlers run only on successful completion, after body operations. Each sees detached original accepted input and schema-validated result plus current state. They return an ordered list of explicitly allowed operation requests or child flow starts. Each handler's work finishes before the next handler is evaluated. Reaction child flows may wait; all after work completes before the caller continues. A cancelled reaction child finishes without a result; a fault rolls back the current advancement. No universal cancellation of an entire parent or implicit rollback of previously committed work is implied.

Cancellation skips the body and after handlers. Root status is `cancelled` with a reason; callers receive `childCancelled` and null childResult. Successful children set childCancelled to null. This is a game outcome, distinct from fault. A parent must decide how to handle it.

Lifecycle phase, accepted input, result, handler cursor and remaining work are JSON checkpoints. Code and handler lists are immutable definitions reconstructed on resume. Resume does not register or execute already-completed hooks again. Flow versions must change when handlers, permissions, ordering or semantics change, and must be pinned by the session ruleset. Parsing validates structure and declared permissions; it does not prove historical reachability of an arbitrary forged snapshot. Only server-owned committed snapshots are authoritative.

Hooks do not imply a storage commit. Existing candidate isolation, CAS, fencing and receipts remain the durable boundary. An after hook runs inside the candidate, not after Redis acknowledgement. Runtime callbacks must not perform external I/O or retain mutable closure state.

This slice adds flow lifecycle infrastructure and a pet-duel example. It does not add dynamic effect-instance registration, aura evaluation, effect parameter modifiers or lifecycle hooks for synchronous operations. Game handlers can inspect current object state to determine applicability. Each handler and each returned action consumes flow budget; the existing operation runtime also bounds its own reaction expansion.

## Object API

The public types are `FlowHooks`, `BeforeHandler`, and `AfterHandler`. A handler is an object with `id`, `version`, `order`, and `run`; there is no composition setup or ambient active instance. Handlers can be declared in a separate game module and supplied through `hooks`. Each permitted before decision is checked by the declaration's TypeScript union and checked again at runtime. Input/result schemas must accept canonical JSON without changing it; defaults and non-idempotent transforms cannot rewrite restored checkpoints.

```ts
const hit = defineFlow<Battle, HitInput, HitResult>({
  id: "hit",
  version: "1",
  entry: "apply",
  input: hitInputSchema,
  result: hitResultSchema,
  hooks: {
    before: {
      cancel: true,
      handlers: [immunityRule],
    },
    after: {
      handlers: [retaliationRule],
    },
  },
  steps: hitSteps,
});
// Typed start input; the executor invokes the hooks automatically.
const checkpoint = runtime.start(hit.start(input), executionId);
```

`after` handler `operations` / `flows` lists grant ID/version-scoped permissions. Referenced definitions must be present when constructing the runtime. The handler returns `{kind: "operation", request}` or `{kind: "flow", start}` entries. Empty lists grant no write or child-flow permission. Hook arguments are detached copies; after input/result properties are read-only in TypeScript. Mutating a nested copy cannot alter the completed result or authoritative state.

`before.authorizeReplacement(state, before, after)` is required for a handler to return `{kind: "replace", input}`. It must independently constrain allowed fields and invariants. It cannot depend on mutations to its arguments being persisted. Cancellation uses `{kind: "cancel", reason}`; ordinary observers return `{kind: "continue"}`. Missing hooks require no empty callbacks and ordinary TS helper calls have no lifecycle.

Flow checkpoints now use format 2 and include `Frame.lifecycle`, `Frame.childCancelled`, and `FlowState.cancellation`. No compatibility shim or migration is supplied. See `test/lifecycle.test.ts` and `test/lifecycle-durable.test.ts` for executable ordering, rejection, checkpoint and takeover examples.
