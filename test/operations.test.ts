import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defineBehavior,
  defineOperation,
  OperationRuntime,
  parse,
} from "../src/index.js";
interface State {
  hp: number;
  mark: number;
}
const state = (input: unknown): State => {
  const v = parse.object(input, ["hp", "mark"]);
  return { hp: parse.integer(v.hp, 0, 100), mark: parse.integer(v.mark) };
};
const heal = defineOperation<State, number, number>({
  id: "heal",
  version: "1",
  parse: (v) => parse.integer(v, 1),
  execute: (s, n) => ({ state: { ...s, hp: s.hp + n }, facts: [n] }),
  authorize: (before, after) => {
    if (before.mark !== after.mark) throw Error("Mark write denied");
  },
});
test("operation replacement and post facts execute in declared deterministic order", () => {
  const runtime = new OperationRuntime(
    state,
    [heal.operation],
    [
      {
        id: "double",
        order: 2,
        apply: (_s, r) => heal.request(parse.integer(r.input) * 2),
      },
      {
        id: "plus",
        order: 1,
        apply: (_s, r) => heal.request(parse.integer(r.input) + 1),
      },
    ],
  );
  assert.equal(
    runtime.execute({ hp: 1, mark: 1 }, [heal.request(2)]).state.hp,
    7,
  );
});
test("bounded reactions and write violations cannot leak partial state", () => {
  const runtime = new OperationRuntime(
    state,
    [heal.operation],
    [],
    [{ id: "loop", order: 0, react: () => [heal.request(1)] }],
  );
  const input = { hp: 1, mark: 1 };
  assert.throws(() => runtime.execute(input, [heal.request(1)], 3), /budget/);
  assert.deepEqual(input, { hp: 1, mark: 1 });
  const bad = defineOperation<State, number, number>({
    id: "bad",
    version: "1",
    parse: parse.integer,
    execute: (s) => ({ state: { hp: s.hp, mark: 0 }, facts: [] }),
    authorize: (a, b) => {
      if (a.mark !== b.mark) throw Error("Denied");
    },
  });
  assert.throws(() =>
    new OperationRuntime(state, [bad.operation]).execute(input, [
      bad.request(1),
    ]),
  );
});
test("content behavior cannot issue an ungranted operation", () => {
  const behavior = defineBehavior<State, number>(
    "skill",
    "1",
    parse.integer,
    [heal.operation],
    (query, n) => {
      query().mark = 99;
      return [{ operation: "erase", version: "1", input: n }];
    },
  );
  assert.throws(() => behavior.plan({ hp: 1, mark: 1 }, 1), /denied/);
});

test("operation IDs and versions cannot collide through a separator", () => {
  const behavior = defineBehavior<State, number>(
    "collision",
    "1",
    parse.integer,
    [{ id: "allowed@x", version: "1" }],
    (_q, n) => [{ operation: "allowed", version: "x@1", input: n }],
  );
  assert.throws(() => behavior.plan({ hp: 1, mark: 1 }, 1), /denied/);
});
