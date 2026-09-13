import { test } from "node:test";
import assert from "node:assert/strict";
import {
  z,
  defineSettlement,
  parseModifier,
  type SettlementModifier,
  type NumericModifier,
} from "../src/index.js";
const damage = defineSettlement({
  id: "damage",
  version: "1",
  input: z.strictObject({ sampledAttack: z.number() }),
  stages: ["base", "reduction"],
  values: {
    raw: { stage: "base" },
    final: {
      stage: "reduction",
      constrain: (n: number) => Math.max(0, Math.floor(n)),
    },
  },
});
function initial(id = "hit:1") {
  return damage.start({ sessionId: "one", id }, { sampledAttack: 10 });
}
const source = { kind: "mark", sessionId: "one", id: "buff" };
test("settlement values freeze by stage, repeated reads do not compound and checkpoints retain calculation inputs", () => {
  const original = initial();
  let s = damage.seed(original, "raw", original.input.sampledAttack);
  s = damage.modify(s, {
    id: "critical",
    target: damage.ref(s, "raw"),
    source,
    mode: "multiply",
    amount: 2,
  });
  assert.equal(damage.read(s, "raw"), 20);
  assert.equal(damage.read(s, "raw"), 20);
  assert.deepEqual(original.values, {});
  s = damage.advance(s);
  assert.equal(s.values.raw?.result, 20);
  assert.throws(
    () =>
      damage.modify(s, {
        id: "late",
        target: damage.ref(s, "raw"),
        source,
        mode: "add",
        amount: 5,
      }),
    /writable/,
  );
  s = damage.seed(s, "final", damage.read(s, "raw"));
  const restored = damage.parse(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored, s);
  const reduced = damage.modify(restored, {
    id: "armor",
    target: damage.ref(s, "final"),
    source,
    mode: "add",
    amount: -3,
  });
  const ready = damage.advance(reduced);
  assert.equal(damage.read(ready, "final"), 17);
  assert.equal(ready.status, "ready");
  const done = damage.complete(ready);
  assert.equal(done.status, "completed");
  assert.deepEqual(damage.parse(JSON.parse(JSON.stringify(done))), done);
  assert.throws(() => damage.complete(done), /ready/);
  assert.throws(() => damage.advance(done), /open/);
});
test("modifiers cannot cross settlement instances, sessions, values or component-attribute addresses", () => {
  const a = damage.seed(initial(), "raw", 10),
    b = damage.seed(initial("hit:2"), "raw", 10);
  const modifier: SettlementModifier<"raw"> = {
    id: "buff",
    target: damage.ref(a, "raw"),
    source,
    mode: "add",
    amount: 2,
  };
  assert.throws(() => damage.modify(b, modifier), /Foreign/);
  assert.throws(
    () =>
      damage.modify(a, {
        ...modifier,
        source: { ...source, sessionId: "other" },
      }),
    /Foreign/,
  );
  assert.throws(() => damage.modify(a, { ...modifier, amount: Infinity }));
  const huge = damage.seed(initial("huge"), "raw", 1e308);
  assert.throws(
    () =>
      damage.modify(huge, {
        ...modifier,
        target: damage.ref(huge, "raw"),
        amount: 1e308,
      }),
    /finite/,
  );
  const applied = damage.modify(a, modifier);
  assert.throws(() => damage.modify(applied, modifier), /Duplicate/);
  assert.throws(() => parseModifier(modifier));
  // @ts-expect-error Component modifiers cannot target settlement values.
  const wrong: NumericModifier = { ...modifier, valueId: "attack" };
  void wrong;
  // @ts-expect-error Settlement values have a closed set of declared names.
  const badName = () => damage.ref(a, "unknown");
  void badName;
});
test("restore rejects impossible stage data and tampered frozen results without modifying the original", () => {
  const s = damage.advance(damage.seed(initial(), "raw", 10));
  const original = JSON.stringify(s);
  const bad = structuredClone(s);
  assert.ok(bad.values.raw);
  bad.values.raw.result = 999;
  assert.throws(() => damage.parse(bad), /frozen/);
  assert.throws(() => damage.parse({ ...s, stage: 2 }), /status/);
  assert.throws(() => damage.parse({ ...s, values: {} }), /frozen/);
  assert.throws(() => damage.parse({ ...s, version: "old" }), /version/);
  assert.equal(JSON.stringify(s), original);
  assert.throws(() => damage.seed(initial(), "final", 10), /writable/);
  assert.throws(() => damage.advance(initial()), /unseeded/);
});
test("cancellation closes write windows and canonical input parsing never re-transforms saved state", () => {
  const cancelled = damage.cancel(damage.seed(initial(), "raw", 10));
  assert.equal(
    damage.parse(JSON.parse(JSON.stringify(cancelled))).status,
    "cancelled",
  );
  assert.throws(() => damage.read(cancelled, "raw"), /cancelled/);
  assert.throws(() => damage.seed(cancelled, "raw", 20), /writable/);
  assert.throws(() => damage.cancel(cancelled), /terminal/);
  const invalid = defineSettlement({
    id: "bad",
    version: "1",
    input: z.number().transform((n) => n + 1),
    stages: ["one"],
    values: { number: { stage: "one" } },
  });
  assert.throws(
    () => invalid.start({ sessionId: "one", id: "bad" }, 1),
    /canonical/,
  );
});
