# Zod protocol validation

Use named, module-local Zod schemas as the source of truth for JSON protocol structure. Infer concrete protocol types with `z.infer`; parameterize only opaque game data and typed reference kinds. Do not maintain a second hand-written interface and field/type parser for the same protocol.

This refactor covers object/entity/relation/world envelopes, operation requests, flow starts/frames/prompts/lifecycle reactions, numeric modifier lifetimes, settlements, session requests/snapshots, durable receipts/commits and Redis response tuples. The engine exports these named schemas alongside its existing `z` API. They describe structure; they do not independently establish game-state validity.

TS-authored rule definitions and handlers are trusted once they compile. This refactor does not add runtime validation of their declarations, sandboxing, or new capability restrictions. For example, RelationDefinition remains a TypeScript interface; defineRelation captures it without an additional Zod validation pass. Existing gameplay invariants are preserved.

Validation at data boundaries remains layered:

1. `detached` checks plain finite acyclic JSON before schema parsing. It rejects accessors without evaluating them, class instances, sparse/extended arrays, symbols, undefined and negative zero. Zod's ordinary schemas are not a substitute for this transport boundary.
2. Zod strict objects, discriminated unions, enums, required opaque payloads and numeric bounds validate shape without coercion or unknown-field stripping. Opaque payload schemas require the field, then the corresponding registered game schema validates its contents.
3. Domain code checks registered identities/versions, session ownership, relation cardinality/cycles, lifecycle cursors/child topology, scope permissions, modifier liveness and frozen settlement arithmetic. These checks require live definitions or state and stay explicit.
4. Existing candidate isolation, result validation and CAS/fencing/receipts remain authoritative.

Canonical settlement parsing compares the complete input with the schema result, rejecting any rewrite. In particular, a Zod record can discard `__proto__`; the engine rejects that checkpoint instead of silently accepting changed values. Lifecycle input/result and component canonical checks remain unchanged.

Legacy `parse.object/text/integer/finite/list` convenience functions use Zod too. New protocols should use named schemas directly. The object helper still allows declared fields to be absent, matching its prior role; required fields belong in a named schema. No new Zod dependency is required in game repositories.

This is a validation refactor, not a new lifecycle or effect model. Normal JSON wire formats and gameplay are unchanged. Malformed payloads may now fail earlier and return richer Zod issue paths. Raw schemas are reusable building blocks; use engine parsers/session APIs for the full JSON and semantic boundary.
