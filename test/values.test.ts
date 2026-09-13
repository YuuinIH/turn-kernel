import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defineComponent,
  defineObject,
  componentTarget,
  worldParser,
  z,
  Evaluation,
  activeModifiers,
  parseModifier,
  type NumericModifier,
  type Ref,
} from "../src/index.js";
interface State {
  base: number;
  alternate: boolean;
  bonus: number;
}
const target: Ref<"pet"> = { kind: "pet", sessionId: "one", id: "p" };
const source: Ref<"mark"> = { kind: "mark", sessionId: "one", id: "m" };
const stats = defineComponent("stats", "1", z.strictObject({}));
const pet = defineObject(
  "pet",
  "1",
  z.strictObject({ stats: stats.schema() }),
  [stats.slot("stats")],
);
const mark = defineObject("mark", "1", z.strictObject({}));
const petStats = componentTarget(stats, pet);
const world = () =>
  worldParser(
    [pet, mark],
    [],
  )({
    sessionId: "one",
    retiredIds: [],
    relations: [],
    entities: [
      { ref: target, value: { stats: {} } },
      { ref: source, value: {} },
    ],
  });
const attack = petStats.numericValue<State>("attack", "1", (q) =>
  q.observe("base", (s) => s.base),
);
const bonus = petStats.numericValue<State>("bonus", "1", (q) =>
  q.observe("bonus", (s) => s.bonus),
);
const effective = petStats.numericValue<State>("effective", "1", (q, ref) =>
  q.observe("alternate", (s) => s.alternate)
    ? q.read(bonus, ref)
    : q.read(attack, ref),
);
const alive = petStats.value<State, boolean>(
  "alive",
  "1",
  (v) => {
    if (typeof v !== "boolean") throw Error();
    return v;
  },
  (q) => q.observe("base", (s) => s.base > 0),
);
const mod: NumericModifier = {
  id: "add",
  target,
  valueId: attack.id,
  mode: "add",
  amount: 5,
  source,
  lifetime: { kind: "source" },
};
test("typed modifiers use add-then-multiply and source/flow lifetimes", () => {
  const multiply: NumericModifier = {
    ...mod,
    id: "factor",
    mode: "multiply",
    amount: 2,
  };
  const flow: NumericModifier = {
    ...mod,
    id: "flow",
    amount: 3,
    lifetime: { kind: "flow", flowId: "f" },
  };
  const q = new Evaluation(
    { base: 10, bonus: 1, alternate: false },
    world,
    [attack],
    [multiply, mod],
  );
  assert.equal(q.read(attack, target), 30);
  assert.equal(activeModifiers([mod, flow], [target, source], []).length, 1);
  assert.equal(activeModifiers([mod, flow], [target], ["f"]).length, 0);
  assert.throws(
    () =>
      new Evaluation(
        { base: 1, bonus: 1, alternate: false },
        world,
        [alive],
        [{ ...mod, valueId: alive.id }],
      ),
  );
  assert.throws(() => parseModifier({ ...mod, amount: Infinity }));
});
test("dynamic reads expose dependencies and are rebuilt for each state snapshot", () => {
  const first = new Evaluation(
    { base: 10, bonus: 3, alternate: false },
    world,
    [attack, bonus, effective],
  );
  assert.equal(first.read(effective, target), 10);
  assert.ok(first.trace().some((e) => e.dependencies.includes("state:base")));
  const second = new Evaluation(
    { base: 10, bonus: 3, alternate: true },
    world,
    [attack, bonus, effective],
  );
  assert.equal(second.read(effective, target), 3);
  assert.equal(
    second.trace().some((e) => e.dependencies.includes("state:base")),
    false,
  );
});
test("dependency cycles fail with the path, and query copies cannot modify inputs", () => {
  const cycle = petStats.numericValue<State>("cycle", "1", (q, ref): number =>
    q.read(cycle, ref),
  );
  const original = { base: 10, bonus: 2, alternate: false };
  const q = new Evaluation(original, world, [cycle]);
  assert.throws(() => q.read(cycle, target), /cycle.*cycle/);
  q.observe("write-attempt", (s) => {
    s.base = 999;
    return s.base;
  });
  assert.equal(original.base, 10);
});
