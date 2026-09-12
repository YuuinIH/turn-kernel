import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FlowRuntime,
  OperationRuntime,
  defineOperation,
  nextRandom,
  parse,
  type FlowDefinition,
} from "../src/index.js";
interface State {
  count: number;
  rng: number;
}
const parseState = (input: unknown): State => {
  const v = parse.object(input, ["count", "rng"]);
  return {
    count: parse.integer(v.count),
    rng: parse.integer(v.rng, 0, 0xffffffff),
  };
};
const tick = defineOperation<State, number, number>({
  id: "tick",
  version: "1",
  parse: parse.integer,
  execute: (s, n) => {
    const random = nextRandom(s.rng, 10);
    return {
      state: { count: s.count + n + random.value, rng: random.state },
      facts: [random.value],
    };
  },
  authorize: () => {},
});
const child: FlowDefinition<State> = {
  id: "child",
  version: "1",
  steps: {
    choose: {
      parseData: parse.integer,
      parseChoice: (v) => parse.integer(v),
      advance: (_s, frame, input) =>
        input === undefined
          ? { kind: "wait", actor: "B", operations: [] }
          : {
              kind: "done",
              result: input,
              operations: [
                tick.request(parse.integer(frame.data) + parse.integer(input)),
              ],
            },
    },
  },
};
const parent: FlowDefinition<State> = {
  id: "parent",
  version: "1",
  steps: {
    start: {
      parseData: parse.integer,
      advance: (_s, f) => ({
        kind: "call",
        child: {
          type: "child",
          version: "1",
          step: "choose",
          data: f.data,
        },
        resumeStep: "end",
        data: null,
        operations: [tick.request(1)],
      }),
    },
    end: {
      parseData: (v) => {
        if (v !== null) throw Error();
        return null;
      },
      advance: (_s, f) => ({
        kind: "done",
        result: f.childResult,
        operations: [tick.request(2)],
      }),
    },
  },
};
function runtime() {
  return new FlowRuntime(
    [child, parent],
    new OperationRuntime(parseState, [tick.operation]),
  );
}
test("parent/child flow saves waiting state, validates chooser and returns deterministically", () => {
  const engine = runtime();
  const initial = {
    state: { count: 0, rng: 123 },
    flow: engine.start(
      { type: "parent", version: "1", step: "start", data: 3 },
      "execution-1",
    ),
  };
  const waiting = engine.run(initial);
  assert.equal(waiting.flow.status, "waiting");
  const prompt = waiting.flow.prompt;
  assert.ok(prompt);
  assert.throws(() =>
    engine.run(waiting, { promptId: prompt.id, actor: "A", value: 4 }),
  );
  assert.throws(() =>
    engine.run(waiting, { promptId: "old", actor: "B", value: 4 }),
  );
  const recovered = {
    state: parseState(JSON.parse(JSON.stringify(waiting.state))),
    flow: runtime().parse(JSON.parse(JSON.stringify(waiting.flow))),
  };
  const a = engine.run(waiting, { promptId: prompt.id, actor: "B", value: 4 });
  const b = runtime().run(recovered, {
    promptId: prompt.id,
    actor: "B",
    value: 4,
  });
  assert.deepEqual(a, b);
  assert.equal(a.flow.status, "finished");
  assert.equal(a.flow.result, 4);
  assert.throws(() =>
    engine.run(a, { promptId: prompt.id, actor: "B", value: 4 }),
  );
});
test("budget exhaustion records fault and rolls back candidate random/state changes", () => {
  const loop: FlowDefinition<State> = {
    id: "loop",
    version: "1",
    steps: {
      run: {
        parseData: parse.integer,
        advance: (_s, f) => ({
          kind: "next",
          step: "run",
          data: f.data,
          operations: [tick.request(1)],
        }),
      },
    },
  };
  const engine = new FlowRuntime(
    [loop],
    new OperationRuntime(parseState, [tick.operation]),
  );
  const initial = {
    state: { count: 0, rng: 1 },
    flow: engine.start(
      { type: "loop", version: "1", step: "run", data: 0 },
      "execution-1",
    ),
  };
  const result = engine.run(initial, undefined, 3);
  assert.equal(result.flow.status, "fault");
  assert.deepEqual(result.state, initial.state);
  assert.deepEqual(result.facts, []);
  assert.doesNotThrow(() => engine.parse(result.flow));
});

test("a choice from one root execution cannot complete a later root execution", () => {
  const engine = runtime();
  const start = (id: string) =>
    engine.run({
      state: { count: 0, rng: 1 },
      flow: engine.start(
        { type: "child", version: "1", step: "choose", data: 1 },
        id,
      ),
    });
  const first = start("first");
  const second = start("second");
  assert.ok(first.flow.prompt && second.flow.prompt);
  assert.notEqual(first.flow.prompt.id, second.flow.prompt.id);
  assert.throws(
    () =>
      engine.run(second, {
        promptId: first.flow.prompt?.id ?? "",
        actor: "B",
        value: 1,
      }),
    /stale choice/,
  );
  const invalid = structuredClone(second.flow);
  invalid.sequence = 1;
  assert.throws(() => engine.parse(invalid), /identity/);
});

test("stateless root and child frames default to null without a context object", () => {
  const leaf: FlowDefinition<State> = {
    id: "leaf",
    version: "1",
    steps: {
      run: {
        advance: (_state, frame) => {
          assert.equal(frame.data, null);
          return { kind: "done", result: 7, operations: [] };
        },
      },
    },
  };
  const root: FlowDefinition<State> = {
    id: "root",
    version: "1",
    steps: {
      run: {
        advance: () => ({
          kind: "call",
          child: { type: "leaf", version: "1", step: "run" },
          resumeStep: "end",
          data: null,
          operations: [],
        }),
      },
      end: {
        advance: (_state, frame) => ({
          kind: "done",
          result: frame.childResult,
          operations: [],
        }),
      },
    },
  };
  const engine = new FlowRuntime(
    [root, leaf],
    new OperationRuntime(parseState, []),
  );
  const flow = engine.start(
    { type: "root", version: "1", step: "run" },
    "empty-data",
  );
  assert.equal(flow.stack[0]?.data, null);
  const result = engine.run({ state: { count: 0, rng: 1 }, flow });
  assert.equal(result.flow.result, 7);
  assert.equal(result.flow.status, "finished");
  assert.throws(
    () =>
      engine.start(
        { type: "root", version: "1", step: "run", data: {} },
        "invalid",
      ),
    /null data/,
  );
});

test("frame data is the only local checkpoint and legacy or invalid checkpoints are rejected", () => {
  const engine = runtime();
  const started = {
    state: { count: 0, rng: 1 },
    flow: engine.start(
      { type: "parent", version: "1", step: "start", data: 3 },
      "persisted",
    ),
  };
  const waiting = engine.run(started);
  assert.deepEqual(
    waiting.flow.stack.map((frame) => frame.data),
    [null, 3],
  );
  assert.equal(started.flow.stack[0]?.data, 3);
  const checkpoint: unknown = JSON.parse(JSON.stringify(waiting.flow));
  assert.deepEqual(engine.parse(checkpoint), waiting.flow);
  assert.throws(() => engine.parse({ ...waiting.flow, format: 99 }), /format/);
  const { format: _format, ...legacy } = waiting.flow;
  assert.throws(() => engine.parse(legacy), /format/);
  const invalid = structuredClone(waiting.flow);
  const frame = invalid.stack.at(-1);
  assert.ok(frame);
  frame.data = "not-a-number";
  assert.throws(() => engine.parse(invalid));
});
