import assert from "node:assert/strict";
import { test } from "node:test";
import {
  z,
  defineObject,
  registration,
  RulesetBuilder,
  worldParser,
  createSession,
  restoreSession,
  WorldQuery,
  type GameDefinition,
  type World,
} from "../src/index.js";

const barrierSchema = z.strictObject({
  durability: z.number().int().nonnegative(),
  element: z.enum(["fire", "ice"]),
});
type Barrier = z.infer<typeof barrierSchema>;
const barrier = defineObject("example:barrier", "1", barrierSchema);
const token = registration("object", barrier.kind, barrier.version, barrier);
const rules = new RulesetBuilder().add(token).build("schema-example", "1");
const parseWorld = worldParser([rules.resolve(token)], []);
const game: GameDefinition<World, null, never> = {
  ruleset: rules.id,
  parseState: parseWorld,
  parseCommand: (input) => z.null().parse(input),
  decide: () => ({ ok: false, reason: "Read-only fixture" }),
};

test("engine-exported schemas infer custom objects and validate registered snapshot restoration", () => {
  const ref = barrier.ref("one", "barrier-1");
  const session = createSession(game, "one", {
    sessionId: "one",
    retiredIds: [],
    relations: [],
    entities: [{ ref, value: { durability: 20, element: "fire" } }],
  });
  const restored = restoreSession(
    game,
    JSON.parse(JSON.stringify(session.snapshot())),
  );
  const value: Barrier = new WorldQuery(restored.view()).get(barrier, ref);
  const durability: number = value.durability;
  assert.equal(durability, 20);
  assert.equal(value.element, "fire");
  for (const value of [
    { durability: -1, element: "fire" },
    { durability: "20", element: "fire" },
    { durability: 20, element: "water" },
    { durability: 20, element: "fire", extra: true },
  ]) {
    const bad = session.snapshot();
    bad.state.entities = [{ ref, value }];
    assert.throws(() => restoreSession(game, bad));
  }
});

test("schema parsing still enforces the engine JSON boundary before and after validation", () => {
  const invalidOutput = defineObject(
    "bad-output",
    "1",
    z.unknown().transform(() => new Date()),
  );
  assert.throws(() => invalidOutput.parse(null));
  let called = false;
  const parser = defineObject(
    "guarded",
    "1",
    z.unknown().transform(() => {
      called = true;
      return 1;
    }),
  );
  assert.throws(() => parser.parse(new Map()));
  assert.equal(called, false);
});

function typeChecks(query: WorldQuery): void {
  const value = query.get(barrier, barrier.ref("one", "b"));
  // @ts-expect-error A schema-inferred number is not a string.
  const invalid: string = value.durability;
  // @ts-expect-error Reference kinds stay exact when an object is defined with a schema.
  query.get(barrier, { kind: "mark", sessionId: "one", id: "b" });
  void invalid;
}
void typeChecks;
