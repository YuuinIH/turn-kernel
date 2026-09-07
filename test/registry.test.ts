import { test } from "node:test";
import assert from "node:assert/strict";
import { RulesetBuilder, registration, content, parse } from "../src/index.js";
test("registration rejects duplicates, missing dependencies and forged tokens; manifests ignore registration order", () => {
  const operation = registration("operation", "heal", "1", { target: "pet" });
  const behavior = registration(
    "behavior",
    "medic",
    "1",
    { operation: "heal" },
    ["operation:heal"],
  );
  assert.throws(
    () => new RulesetBuilder().add(operation).add(operation),
    /Duplicate/,
  );
  assert.throws(
    () => new RulesetBuilder().add(behavior).build("game", "1"),
    /Missing/,
  );
  const builder = new RulesetBuilder().add(operation).add(behavior);
  const rules = builder.build("game", "1");
  assert.equal(
    rules.id,
    new RulesetBuilder().add(behavior).add(operation).build("game", "1").id,
  );
  assert.equal(rules.resolve(operation).target, "pet");
  assert.throws(() =>
    rules.resolve(registration("operation", "heal", "1", { target: "mark" })),
  );
  assert.throws(() => builder.add(registration("operation", "other", "1", {})));
});
test("content is schema checked and its hash changes when values change", () => {
  const a = content("cost", 10, parse.integer);
  const b = content("cost", 11, parse.integer);
  assert.notEqual(a.version, b.version);
  assert.throws(() => content("cost", "invalid", parse.integer));
});

test("registered definition values and manifest dependencies are frozen", () => {
  const token = registration("content", "data", "1", { nested: { value: 1 } });
  const rules = new RulesetBuilder().add(token).build("test", "1");
  assert.throws(() => {
    token.value.nested.value = 2;
  });
  assert.equal(rules.resolve(token).nested.value, 1);
});

test("JSON parameters bind to the exact registered TS behavior and reject invalid parameters", async () => {
  const { bindBehavior, defineBehavior } = await import("../src/index.js");
  const definition = defineBehavior<number, number>(
    "add",
    "1",
    (v) => parse.integer(v, 1),
    [{ id: "add", version: "1" }],
    (_q, n) => [{ operation: "add", version: "1", input: n }],
  );
  const behavior = registration(
    "behavior",
    definition.id,
    definition.version,
    definition,
  );
  const binding = bindBehavior("small-add", behavior, JSON.parse("3"));
  const rules = new RulesetBuilder()
    .add(behavior)
    .add(binding.definition)
    .build("example", "1");
  assert.deepEqual(binding.plan(rules, 0), [
    { operation: "add", version: "1", input: 3 },
  ]);
  assert.throws(() => bindBehavior("invalid", behavior, "3"));
  assert.throws(() =>
    new RulesetBuilder().add(binding.definition).build("missing", "1"),
  );
});

test("structural tokens and mutable container definitions cannot bypass sealing", () => {
  const forged = {
    category: "content",
    id: "mutable",
    version: "1",
    requires: [],
    value: { value: 1 },
  } satisfies import("../src/index.js").Registration<{ value: number }>;
  assert.throws(() => new RulesetBuilder().add(forged), /factory/);
  assert.throws(
    () => registration("content", "map", "1", new Map([["a", 1]])),
    /mutable containers/,
  );
  assert.throws(
    () =>
      registration("content", "getter", "1", {
        get value() {
          return 1;
        },
      }),
    /accessors/,
  );
});
