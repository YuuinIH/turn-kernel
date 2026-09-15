import { test } from "node:test";
import assert from "node:assert/strict";
import {
  z,
  parse,
  operationRequestSchema,
  snapshotSchema,
  submissionSchema,
  flowReactionSchema,
  lifecycleCheckpointSchema,
  numericModifierSchema,
  parseModifier,
  parseSettlementValueRef,
  defineSettlement,
  restoreSession,
  createSession,
  type GameDefinition,
} from "../src/index.js";
import { fixture } from "./fixtures/lifecycle.js";

const ref = { kind: "pet", sessionId: "one", id: "pet-1" };
const modifier = {
  id: "bonus",
  target: ref,
  valueId: "attack",
  mode: "add",
  amount: 2,
  source: ref,
  lifetime: { kind: "source" },
};

test("protocol schemas require opaque payload fields, reject mixed union branches and never coerce", () => {
  assert.equal(
    operationRequestSchema.safeParse({ operation: "hit", version: "1" })
      .success,
    false,
  );
  assert.equal(
    snapshotSchema.safeParse({
      format: 1,
      ruleset: "one",
      sessionId: "one",
      revision: 0,
    }).success,
    false,
  );
  assert.equal(
    submissionSchema.safeParse({ sessionId: "one", revision: 0 }).success,
    false,
  );
  assert.equal(
    submissionSchema.safeParse({
      sessionId: "one",
      revision: "0",
      command: null,
    }).success,
    false,
  );
  assert.equal(
    lifecycleCheckpointSchema.safeParse({ phase: "before", input: null })
      .success,
    false,
  );
  assert.equal(
    flowReactionSchema.safeParse({
      kind: "operation",
      request: { operation: "hit", version: "1", input: null },
      start: { type: "hit", version: "1", step: "run" },
    }).success,
    false,
  );
  assert.equal(
    numericModifierSchema.safeParse({
      ...modifier,
      lifetime: { kind: "source", flowId: "foreign" },
    }).success,
    false,
  );
  assert.equal(
    numericModifierSchema.safeParse({ ...modifier, amount: "2" }).success,
    false,
  );
  assert.deepEqual(parseModifier(modifier), modifier);
});

test("snapshot schema errors locate nested fields while domain checks still validate lifecycle cursors", () => {
  const f = fixture();
  const waiting = f.engine.run(f.initial);
  const before = JSON.stringify(waiting);
  const checkpoint = structuredClone(waiting.flow);
  const frame = checkpoint.stack[1];
  assert.ok(frame?.lifecycle?.phase === "after");
  // Exercise untrusted input, not an unchecked type assertion.
  Object.defineProperty(frame.lifecycle, "awaitingChild", {
    value: "true",
    enumerable: true,
  });
  assert.throws(
    () => f.engine.parse(checkpoint),
    (error: unknown) =>
      error instanceof z.ZodError &&
      error.issues.some(
        (issue) =>
          JSON.stringify(issue.path) ===
          JSON.stringify(["stack", 1, "lifecycle", "awaitingChild"]),
      ),
  );
  const cursor = structuredClone(waiting.flow);
  const pending = cursor.stack[1]?.lifecycle;
  assert.ok(pending?.phase === "after");
  pending.handler = 900;
  assert.throws(() => f.engine.parse(cursor));
  assert.equal(JSON.stringify(waiting), before);
});

test("JSON guard precedes schemas: accessors are never evaluated and non-JSON references are rejected", () => {
  let reads = 0;
  const target = { ...ref };
  Object.defineProperty(target, "id", {
    enumerable: true,
    get() {
      reads++;
      return "pet-1";
    },
  });
  assert.throws(() => parseModifier({ ...modifier, target }));
  assert.equal(reads, 0);
  assert.throws(() => parseModifier({ ...modifier, amount: -0 }));
  assert.throws(() =>
    parseSettlementValueRef({
      kind: "settlement-value",
      sessionId: "one",
      instanceId: "hit-1",
      definition: "damage",
      name: "amount",
      extra: true,
    }),
  );
});

test("canonical settlement boundary rejects a dictionary key that Zod would silently discard", () => {
  const settlement = defineSettlement({
    id: "damage",
    version: "1",
    input: z.null(),
    stages: ["apply"],
    values: { damage: { stage: "apply" } },
  });
  const initial = settlement.seed(
    settlement.start({ sessionId: "one", id: "hit-1" }, null),
    "damage",
    3,
  );
  const corrupted = structuredClone(initial);
  Object.defineProperty(corrupted.values, "__proto__", {
    value: { base: 100, result: null },
    enumerable: true,
  });
  assert.throws(() => settlement.parse(corrupted), /canonical/);
  assert.equal(settlement.read(initial, "damage"), 3);
});

test("session schema rejection is atomic and successful snapshots preserve opaque game data", () => {
  const data = z.strictObject({ n: z.number().int() });
  const game: GameDefinition<z.infer<typeof data>, number, never> = {
    ruleset: "schema-regression/1",
    parseState: (v) => data.parse(v),
    parseCommand: (v) => z.number().int().parse(v),
    decide: (state, n) => ({ ok: true, state: { n: state.n + n }, facts: [] }),
  };
  const session = createSession(game, "one", { n: 0 });
  const initial = session.snapshot();
  for (const command of [
    { sessionId: "one", revision: 0, command: 1, extra: true },
    { sessionId: "one", revision: "0", command: 1 },
    { sessionId: "one", revision: 0 },
  ]) {
    assert.equal(session.submit(command).ok, false);
    assert.deepEqual(session.snapshot(), initial);
  }
  assert.ok(session.dispatch(2, 0).ok);
  assert.deepEqual(
    restoreSession(game, JSON.parse(JSON.stringify(session.snapshot()))).view(),
    { n: 2 },
  );
});

test("legacy list parsers receive only the item, preserving scalar default bounds", () => {
  assert.deepEqual(parse.list([0, 1, 2], parse.integer), [0, 1, 2]);
  assert.throws(() => parse.list([-1], parse.integer));
});
