import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MemoryStore,
  createSession,
  openDurableSession,
  parse,
} from "../src/index.js";
import { fixture, record } from "./fixtures/lifecycle.js";

test("worker takeover resumes an after child without replaying body/hooks and deduplicates receipts", async () => {
  let now = 0;
  const store = new MemoryStore(() => now);
  const a = fixture();
  await store.create(createSession(a.game, "one", a.initial).snapshot());
  const first = await openDurableSession(
    a.game,
    store,
    "one",
    "a",
    parse.text,
    10,
  );
  const started = await first.dispatch(null, 0, "start");
  assert.ok(started.ok);
  const waiting = await first.snapshot();
  assert.equal(waiting.state.flow.status, "waiting");
  assert.equal(waiting.state.state.total, 5);
  now = 20;
  const second = await openDurableSession(
    fixture().game,
    store,
    "one",
    "b",
    parse.text,
    10,
  );
  assert.deepEqual(await second.dispatch(null, 0, "start"), started);
  const resumed = await second.dispatch(true, 1, "response");
  assert.ok(resumed.ok);
  assert.deepEqual(resumed.facts, [
    "response",
    "after-response",
    "observed:6",
    "parent-continued",
  ]);
  const complete = await second.snapshot();
  assert.equal(complete.state.state.total, 6);
  assert.deepEqual(await second.dispatch(true, 1, "response"), resumed);
  assert.deepEqual(await second.snapshot(), complete);
  const stale = await first.dispatch(true, 1, "stale-worker");
  assert.ok(!stale.ok && stale.code === "not-owner");
});

test("after failure rolls back only the advancement since the last committed wait", () => {
  const original = fixture();
  const waiting = original.engine.run(original.initial);
  // Same declared slots, but a deliberately broken trusted callback tests candidate isolation.
  const broken = fixture({
    after: {
      handlers: [
        {
          id: "a",
          version: "1",
          order: 0,
          operations: [record.operation],
          flows: [original.response],
          run: () => [],
        },
        {
          id: "z",
          version: "1",
          order: 0,
          operations: [],
          flows: [],
          run() {
            throw Error("broken after");
          },
        },
      ],
    },
  });
  const prompt = waiting.flow.prompt;
  assert.ok(prompt);
  const result = broken.engine.run(waiting, {
    promptId: prompt.id,
    actor: "B",
    value: true,
  });
  assert.equal(result.flow.status, "fault");
  assert.match(result.flow.error ?? "", /broken after/);
  assert.deepEqual(result.state, waiting.state);
  assert.deepEqual(result.facts, []);
  assert.doesNotThrow(() => broken.engine.parse(result.flow));
});
