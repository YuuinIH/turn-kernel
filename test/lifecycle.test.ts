import { test } from "node:test";
import assert from "node:assert/strict";
import {
  z,
  createSession,
  restoreSession,
  defineFlow,
  FlowRuntime,
  OperationRuntime,
  type BeforeHandler,
  type AfterHandler,
} from "../src/index.js";
import {
  fixture,
  record,
  inputSchema,
  type State,
  type Input,
} from "./fixtures/lifecycle.js";

test("object lifecycle automatically wraps a flow; after reactions finish before its parent continues", () => {
  const { game, initial } = fixture();
  const session = createSession(game, "one", initial);
  const first = session.dispatch(null, 0);
  assert.ok(first.ok);
  assert.deepEqual(first.facts, ["first", "after:first:5"]);
  const snapshot = session.snapshot();
  assert.equal(snapshot.state.state.total, 5);
  assert.equal(snapshot.state.flow.stack.length, 3);
  assert.equal(snapshot.state.flow.stack[1]?.lifecycle?.phase, "after");
  const resumed = restoreSession(
    fixture().game,
    JSON.parse(JSON.stringify(snapshot)),
  );
  assert.ok(resumed.dispatch(true, 1).ok);
  assert.deepEqual(resumed.view().state, {
    total: 6,
    log: [
      "first",
      "after:first:5",
      "response",
      "after-response",
      "observed:6",
      "parent-continued",
    ],
  });
  assert.deepEqual(resumed.view().flow.result, { amount: 5, label: "first" });
  assert.equal(resumed.view().flow.status, "finished");
  assert.equal(session.view().state.total, 5);
  assert.equal(resumed.dispatch(true, 2).ok, false);
});

test("declared cancellation skips body and after and is explicit to a caller or root", () => {
  const { engine, initial, hit } = fixture({
    before: {
      cancel: true,
      handlers: [
        {
          id: "cancel",
          version: "1",
          order: 0,
          run: () => ({ kind: "cancel", reason: "immune" }),
        },
      ],
    },
    after: {
      handlers: [
        {
          id: "must-not-run",
          version: "1",
          order: 0,
          operations: [],
          flows: [],
          run() {
            throw Error("after called");
          },
        },
      ],
    },
  });
  const parent = engine.run(initial);
  assert.equal(parent.flow.status, "finished");
  assert.deepEqual(parent.state.log, ["parent-continued"]);
  assert.deepEqual(parent.flow.result, { amount: 0, label: "immune" });
  const root = engine.run({
    state: initial.state,
    flow: engine.start(hit.start({ amount: 1, label: "x" }), "root"),
  });
  assert.equal(root.flow.status, "cancelled");
  assert.equal(root.flow.cancellation, "immune");
  assert.equal(root.flow.result, null);
  assert.deepEqual(root.facts, []);
  assert.deepEqual(
    engine.parse(JSON.parse(JSON.stringify(root.flow))),
    root.flow,
  );
});

test("before handlers have deterministic order and independently checked replacement scope", () => {
  const handlers: BeforeHandler<
    State,
    Input,
    { kind: "replace"; input: Input }
  >[] = [
    {
      id: "z",
      version: "1",
      order: 0,
      run: (_s, i) => ({
        kind: "replace",
        input: { ...i, amount: i.amount * 2 },
      }),
    },
    {
      id: "a",
      version: "1",
      order: 0,
      run: (_s, i) => ({
        kind: "replace",
        input: { ...i, amount: i.amount + 1 },
      }),
    },
  ];
  const f = fixture({ before: { handlers, authorizeReplacement() {} } });
  handlers.reverse();
  const mutated = handlers[0];
  assert.ok(mutated);
  mutated.run = () => ({
    kind: "replace",
    input: { amount: 9999, label: "mutated-definition" },
  });
  const result = f.engine.run(f.initial);
  assert.equal(result.state.total, 8);
  const invalid = fixture({
    before: {
      handlers: [
        {
          id: "retarget",
          version: "1",
          order: 0,
          run: (_s, i) => ({
            kind: "replace",
            input: { ...i, label: "other" },
          }),
        },
      ],
      authorizeReplacement(_s, before, after) {
        if (before.label !== after.label) throw Error("retarget denied");
      },
    },
  });
  const failed = invalid.engine.run(invalid.initial);
  assert.match(failed.flow.error ?? "", /retarget denied/);
  assert.deepEqual(failed.state, invalid.initial.state);
});

test("undeclared cancellation/replacement, invalid replacement and after writes fail atomically", () => {
  for (const decision of [
    { kind: "cancel", reason: "no" },
    { kind: "replace", input: { amount: 1, label: "x" } },
  ] as const) {
    const f = fixture({
      // @ts-expect-error Undeclared cancellation/replacement must also fail at runtime.
      before: {
        handlers: [{ id: "bad", version: "1", order: 0, run: () => decision }],
      },
    });
    const result = f.engine.run(f.initial);
    assert.equal(result.flow.status, "fault");
    assert.deepEqual(result.state, f.initial.state);
    assert.deepEqual(result.facts, []);
  }
  const negative = fixture({
    before: {
      authorizeReplacement() {},
      handlers: [
        {
          id: "negative",
          version: "1",
          order: 0,
          run: (_s, i) => ({ kind: "replace", input: { ...i, amount: -1 } }),
        },
      ],
    },
  });
  assert.equal(negative.engine.run(negative.initial).flow.status, "fault");
  const unscoped = fixture({
    after: {
      handlers: [
        {
          id: "bad",
          version: "1",
          order: 0,
          operations: [],
          flows: [],
          run: () => [
            {
              kind: "operation",
              request: record.request({ amount: 100, label: "bad" }),
            },
          ],
        },
      ],
    },
  });
  const failed = unscoped.engine.run(unscoped.initial);
  assert.match(failed.flow.error ?? "", /operation denied/);
  assert.deepEqual(failed.state, unscoped.initial.state);
});

test("checkpoint validates lifecycle cursors, child linkage, result and pending permissions", () => {
  const f = fixture();
  const waiting = f.engine.run(f.initial);
  const original = JSON.stringify(waiting);
  for (const mutate of [
    (v: { [key: string]: unknown }) => {
      v.handler = 999;
    },
    (v: { [key: string]: unknown }) => {
      v.awaitingChild = false;
    },
    (v: { [key: string]: unknown }) => {
      v.result = { amount: -1, label: "x" };
    },
    (v: { [key: string]: unknown }) => {
      v.pending = [
        {
          kind: "operation",
          request: { operation: "forged", version: "1", input: null },
        },
      ];
    },
    (v: { [key: string]: unknown }) => {
      v.phase = "before";
    },
  ]) {
    const bad = structuredClone(waiting.flow);
    const checkpoint = bad.stack[1]?.lifecycle;
    assert.ok(checkpoint);
    mutate(checkpoint);
    assert.throws(() => f.engine.parse(bad));
  }
  assert.equal(JSON.stringify(waiting), original);
});

test("hook fan-out is bounded and output schemas protect the completion boundary", () => {
  const f = fixture({
    after: {
      handlers: [
        {
          id: "fanout",
          version: "1",
          order: 0,
          operations: [record.operation],
          flows: [],
          run: () =>
            Array.from({ length: 200 }, () => ({
              kind: "operation",
              request: record.request({ amount: 1, label: "many" }),
            })),
        },
      ],
    },
  });
  const result = f.engine.run(f.initial);
  assert.equal(result.flow.status, "fault");
  assert.deepEqual(result.state, f.initial.state);
  const flow = defineFlow<State, null, number>({
    id: "invalid-output",
    version: "1",
    entry: "run",
    input: z.null(),
    result: z.number(),
    steps: {
      run: {
        advance: () => ({
          kind: "done",
          result: "wrong",
          operations: [record.request({ amount: 1, label: "body" })],
        }),
      },
    },
  });
  const engine = new FlowRuntime(
    [flow],
    new OperationRuntime(
      (v) =>
        z
          .strictObject({ total: z.number(), log: z.array(z.string()) })
          .parse(v),
      [record.operation],
    ),
  );
  const failed = engine.run({
    state: f.initial.state,
    flow: engine.start(flow.start(null), "invalid-output"),
  });
  assert.equal(failed.flow.status, "fault");
  assert.deepEqual(failed.state, f.initial.state);
});

test("duplicate handlers, unknown permissions, alternate starts and noncanonical schemas fail early", () => {
  const h: AfterHandler<State, Input, Input> = {
    id: "same",
    version: "1",
    order: 0,
    operations: [],
    flows: [],
    run: () => [],
  };
  assert.throws(() => fixture({ after: { handlers: [h, h] } }), /Duplicate/);
  assert.throws(
    () =>
      fixture({
        after: {
          handlers: [{ ...h, flows: [{ id: "unknown", version: "1" }] }],
        },
      }),
    /permission/,
  );
  const f = fixture();
  assert.throws(() =>
    f.engine.start(
      { ...f.hit.start({ amount: 1, label: "x" }), step: "missing" },
      "one",
    ),
  );
  const flow = defineFlow<State, number, Input>({
    id: "transform",
    version: "1",
    entry: "run",
    input: z.number().transform((v) => v + 1),
    result: inputSchema,
    steps: {
      run: {
        parseData: (v) => z.number().parse(v),
        advance: () => ({ kind: "done", result: null, operations: [] }),
      },
    },
  });
  assert.throws(() => flow.start(1), /canonical/);
});
