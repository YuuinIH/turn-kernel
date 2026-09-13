import { test } from "node:test";
import assert from "node:assert/strict";
import {
  z,
  defineComponent,
  defineObject,
  componentTarget,
  defineRelation,
  worldParser,
  WorldQuery,
  WorldEditor,
  authorizeComponentWrite,
  detached,
  Evaluation,
  validateModifiers,
  activeModifiers,
  RulesetBuilder,
  registration,
  type World,
} from "../src/index.js";
const health = defineComponent(
  "health",
  "1",
  z
    .strictObject({
      hp: z.number().int().min(0),
      max: z.number().int().positive(),
    })
    .refine((v) => v.hp <= v.max),
);
const unit = defineObject(
  "unit",
  "1",
  z.strictObject({
    health: health.schema(),
    name: z.string(),
  }),
  [health.slot("health")],
);
const tower = defineObject(
  "tower",
  "1",
  z.strictObject({
    vitality: health.schema(),
    name: z.string(),
  }),
  [health.slot("vitality")],
);
const mark = defineObject(
  "mark",
  "1",
  z.strictObject({ stacks: z.number().int().positive() }),
);
const living = componentTarget(health, unit, tower);
const unitHealth = componentTarget(health, unit);
const attached = defineRelation({
  id: "attached",
  version: "1",
  from: "mark",
  to: { component: "health" },
  cardinality: "one",
  required: true,
  acyclic: true,
  onTargetDelete: "cascade",
});
const parseWorld = worldParser([unit, tower, mark], [attached]);
const u = unit.ref("one", "u"),
  t = tower.ref("one", "t"),
  m = mark.ref("one", "m");
function fixture(): World {
  return parseWorld({
    sessionId: "one",
    retiredIds: [],
    entities: [
      { ref: u, value: { health: { hp: 5, max: 10 }, name: "unit" } },
      { ref: t, value: { vitality: { hp: 7, max: 20 }, name: "tower" } },
      { ref: m, value: { stacks: 1 } },
    ],
    relations: [{ id: "edge", type: "attached", from: m, to: t }],
  });
}
const policy = {
  objects: [],
  relations: [],
  components: [
    { kind: "unit", component: "health" },
    { kind: "tower", component: "health" },
  ],
};
test("shared components use one authoritative field, isolate reads and recheck live references on write", () => {
  const world = fixture(),
    before = detached(world);
  const query = new WorldQuery(world),
    editor = new WorldEditor(world, policy, [attached]);
  const selected = query.component(living, t);
  selected.hp = 10;
  assert.equal(query.component(living, t).hp, 7);
  editor.setComponent(living, t, selected);
  authorizeComponentWrite(before, world, living, t);
  assert.deepEqual(new WorldQuery(world).get(tower, t), {
    vitality: { hp: 10, max: 20 },
    name: "tower",
  });
  assert.throws(() => editor.setComponent(living, t, { hp: 21, max: 20 }));
  assert.throws(() =>
    editor.setComponent(living, tower.ref("other", "t"), selected),
  );
  const destroy = new WorldEditor(
    world,
    { objects: ["tower", "mark"], relations: ["attached"] },
    [attached],
  );
  destroy.remove(t);
  assert.equal(parseWorld(world).entities.length, 1);
  assert.throws(() => editor.setComponent(living, t, selected), /stale/);
});
test("component grants cannot write whole objects and independent authorization rejects unrelated changes", () => {
  const before = fixture(),
    after = detached(before);
  const editor = new WorldEditor(after, policy, [attached]);
  assert.throws(
    () => editor.set(unit, u, { health: { hp: 8, max: 10 }, name: "changed" }),
    /denied/,
  );
  assert.throws(
    () =>
      new WorldEditor(after, { objects: ["unit"], relations: [] }, [
        attached,
      ]).setComponent(living, u, { hp: 8, max: 10 }),
    /denied/,
  );
  editor.setComponent(living, u, { hp: 8, max: 10 });
  editor.setComponent(living, t, { hp: 8, max: 20 });
  assert.throws(
    () => authorizeComponentWrite(before, after, living, u),
    /scope/,
  );
});
test("component relationship constraints survive JSON restore and reject absent capabilities and cardinality errors", () => {
  const world = fixture();
  assert.deepEqual(parseWorld(JSON.parse(JSON.stringify(world))), world);
  assert.throws(
    () =>
      parseWorld({
        ...world,
        relations: [{ id: "edge", type: "attached", from: m, to: m }],
      }),
    /endpoints/,
  );
  assert.throws(() => parseWorld({ ...world, relations: [] }), /cardinality/);
  assert.throws(
    () =>
      parseWorld({
        ...world,
        relations: [
          ...world.relations,
          { id: "other", type: "attached", from: m, to: u },
        ],
      }),
    /cardinality/,
  );
  assert.throws(() => living.parseRef(m), /component/);
  assert.throws(() => componentTarget(health, mark), /not declared/);
  const malformed = detached(world);
  const entity = malformed.entities[0];
  assert.ok(entity);
  entity.value = { health: { hp: 12, max: 10 }, name: "unit" };
  assert.throws(() => parseWorld(malformed));
});
test("component definitions are registered once and conflicting assembly fails before any session", () => {
  const token = registration("component", health.id, health.version, health);
  const rules = new RulesetBuilder()
    .add(token)
    .add(
      registration("object", unit.kind, unit.version, unit, [
        "component:health",
      ]),
    )
    .build("test", "1");
  assert.equal(rules.resolve(token), health);
  assert.throws(() => worldParser([unit, unit], []), /Duplicate/);
  assert.throws(() => worldParser([mark], [attached]), /Unknown/);
  const other = defineComponent("health", "1", z.number());
  const wrong = defineObject(
    "wrong",
    "1",
    z.strictObject({ health: other.schema() }),
    [other.slot("health")],
  );
  assert.throws(() => worldParser([unit, wrong], []), /Conflicting/);
});
const effective = unitHealth.numericValue<World>(
  "effective",
  "1",
  (_q, _ref, health) => health.hp,
);
test("derived component reads track dependencies, recalculate after writes, and validate modifier endpoints and scopes", () => {
  const world = fixture();
  const boost = effective.modifier({
    id: "boost",
    target: u,
    mode: "add",
    amount: 2,
    source: m,
    lifetime: { kind: "flow", flowId: "turn" },
  });
  const refs = world.entities.map((e) => e.ref);
  const mods = validateModifiers([boost], [effective], world, ["turn"]);
  const first = new Evaluation(world, (state) => state, [effective], mods);
  assert.equal(first.read(effective, u), 7);
  assert.ok(
    first
      .trace()
      .some((e) =>
        e.dependencies.some((d) => d.startsWith("state:component:health:")),
      ),
  );
  new WorldEditor(world, policy, [attached]).setComponent(unitHealth, u, {
    hp: 8,
    max: 10,
  });
  assert.equal(first.read(effective, u), 7);
  assert.equal(
    new Evaluation(world, (state) => state, [effective], mods).read(
      effective,
      u,
    ),
    10,
  );
  assert.throws(
    () => validateModifiers([boost], [effective], world, []),
    /Expired/,
  );
  assert.throws(
    () =>
      validateModifiers(
        [boost],
        [effective],
        {
          ...world,
          entities: world.entities.filter((e) => e.ref.kind !== "mark"),
        },
        ["turn"],
      ),
    /endpoint/,
  );
  assert.throws(
    () =>
      validateModifiers([{ ...boost, target: t }], [effective], world, [
        "turn",
      ]),
    /component/,
  );
  assert.throws(() =>
    validateModifiers([{ ...boost, amount: Infinity }], [effective], world, [
      "turn",
    ]),
  );
  assert.throws(
    () => validateModifiers([boost, boost], [effective], world, ["turn"]),
    /Duplicate/,
  );
  assert.deepEqual(activeModifiers(mods, refs, []), []);
});
const typeChecks = () => {
  // @ts-expect-error A mark cannot be a target of a health-derived value.
  new Evaluation(fixture(), (state) => state, [effective]).read(effective, m);
  // @ts-expect-error Marks are outside the declared component target kind union.
  new WorldQuery(fixture()).component(living, m);
  new WorldEditor(fixture(), policy, []).setComponent(living, u, {
    // @ts-expect-error A component value retains its schema type.
    hp: "bad",
    max: 10,
  });
  effective.modifier({
    id: "bad",
    // @ts-expect-error A numeric value's target is typed independently of its source.
    target: m,
    source: m,
    amount: 1,
    mode: "add",
    lifetime: { kind: "source" },
  });
};
void typeChecks;

test("component state rejects implicit normalization instead of changing repeated reads and checkpoints", () => {
  const increment = defineComponent(
    "increment",
    "1",
    z.number().transform((n) => n + 1),
  );
  const counter = defineObject(
    "counter",
    "1",
    z.strictObject({ count: increment.schema() }),
    [increment.slot("count")],
  );
  assert.throws(() => counter.parse({ count: 0 }), /canonical state/);
  const conversion = defineComponent(
    "conversion",
    "1",
    z.string().transform(Number),
  );
  assert.throws(() => conversion.parse("1"), /canonical state/);
  const objectTransform = defineObject(
    "transformed",
    "1",
    z
      .strictObject({
        health: health.schema(),
      })
      .transform((v) => ({ health: { ...v.health, hp: v.health.hp + 1 } })),
    [health.slot("health")],
  );
  assert.throws(
    () => objectTransform.parse({ health: { hp: 1, max: 10 } }),
    /canonical state/,
  );

  const canonical = defineComponent(
    "count",
    "1",
    z.number().transform((n) => Math.floor(n)),
  );
  const type = defineObject(
    "counter",
    "1",
    z.strictObject({ count: canonical.schema() }),
    [canonical.slot("count")],
  );
  const target = componentTarget(canonical, type);
  const ref = type.ref("one", "counter");
  const restore = worldParser([type], []);
  const world = restore({
    sessionId: "one",
    entities: [{ ref, value: { count: 1 } }],
    relations: [],
    retiredIds: [],
  });
  for (let i = 0; i < 3; i++) {
    assert.equal(new WorldQuery(world).component(target, ref), 1);
    assert.deepEqual(restore(JSON.parse(JSON.stringify(world))), world);
  }
  const writer = new WorldEditor(
    world,
    {
      objects: [],
      relations: [],
      components: [{ kind: "counter", component: "count" }],
    },
    [],
  );
  const before = detached(world);
  assert.throws(() => writer.setComponent(target, ref, 1.5), /canonical state/);
  assert.deepEqual(world, before);
  writer.setComponent(target, ref, 2);
  assert.equal(
    new WorldQuery(restore(JSON.parse(JSON.stringify(world)))).component(
      target,
      ref,
    ),
    2,
  );
});

test("derived values are component-owned across object kinds and validate even constant computations", () => {
  const maximum = living.numericValue<World>(
    "maximum",
    "1",
    (_q, _ref, data) => data.max,
  );
  const constant = living.numericValue<World>("constant", "1", () => 42);
  const world = fixture();
  const query = new Evaluation(world, (state) => state, [maximum, constant]);
  assert.equal(query.read(maximum, u), 10);
  assert.equal(query.read(maximum, t), 20);
  assert.throws(
    () => query.read(constant, tower.ref("one", "missing")),
    /stale/,
  );
  assert.throws(() => query.read(constant, tower.ref("other", "t")), /stale/);
  const invalid = detached(world);
  const entity = invalid.entities.find((e) => e.ref.id === "t");
  assert.ok(entity);
  entity.value = { name: "tower" };
  assert.throws(() =>
    new Evaluation(invalid, (state) => state, [constant]).read(constant, t),
  );
  const modifier = maximum.modifier({
    id: "max",
    target: t,
    source: m,
    amount: 1,
    mode: "add",
    lifetime: { kind: "source" },
  });
  assert.throws(() => validateModifiers([modifier], [maximum], invalid, []));
  assert.equal(
    new Evaluation(world, (state) => state, [maximum], [modifier]).read(
      maximum,
      t,
    ),
    21,
  );
});

test("same local value names are separated by component and registration requires the exact owner", () => {
  const a = living.numericValue<World>(
    "maximum",
    "1",
    (_q, _ref, data) => data.max,
  );
  const label = defineComponent("label", "1", z.string());
  const labeled = defineObject(
    "labeled",
    "1",
    z.strictObject({ label: label.schema() }),
    [label.slot("label")],
  );
  const b = componentTarget(label, labeled).numericValue<World>(
    "maximum",
    "1",
    () => 1,
  );
  assert.notEqual(a.id, b.id);
  const token = registration("value", a.id, a.version, a);
  assert.deepEqual(token.requires, ["component:health"]);
  assert.throws(
    () => new RulesetBuilder().add(token).build("missing", "1"),
    /Missing/,
  );
  assert.throws(
    () => registration("value", "bare", "1", { evaluate: () => 1 }),
    /component/,
  );
  const impostor = defineComponent("health", "1", z.number());
  assert.throws(
    () =>
      new RulesetBuilder()
        .add(token)
        .add(registration("component", "health", "1", impostor))
        .build("wrong", "1"),
    /exact/,
  );
  const rules = new RulesetBuilder()
    .add(token)
    .add(registration("component", health.id, health.version, health))
    .build("ok", "1");
  assert.equal(rules.resolve(token), a);
  assert.throws(
    () =>
      new Evaluation(fixture(), (state) => state, [
        a,
        living.numericValue<World>("maximum", "2", () => 1),
      ]),
    /Duplicate/,
  );
});
