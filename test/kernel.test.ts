import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSession, restoreSession, type GameDefinition } from '../src/index.js'

const counter: GameDefinition<{ count: number }, { amount: number }, { count: number }> = {
  ruleset: 'counter/1',
  parseState: value => {
    if (typeof value !== 'object' || value === null || !('count' in value) ||
      typeof value.count !== 'number' || !Number.isSafeInteger(value.count) || value.count < 0) throw Error('state');
    return { count: value.count };
  },
  parseCommand: value => {
    if (typeof value !== 'object' || value === null || !('amount' in value) ||
      typeof value.amount !== 'number' || !Number.isSafeInteger(value.amount)) throw Error('command');
    return { amount: value.amount };
  },
  decide: (state, command) => {
    state.count += command.amount;
    if (command.amount === 99) throw Error('failed after write');
    return { ok: true, state, facts: [{ count: state.count }] };
  },
};

test('commit, reject failed partial write, reject duplicate, restore waiting state', () => {
  const session = createSession(counter, 'match-1', { count: 0 });
  const result = session.submit({ sessionId: 'match-1', revision: 0, command: { amount: 2 } });
  assert.equal(result.ok, true);
  const saved = session.snapshot();
  assert.equal(session.submit({ sessionId: 'match-1', revision: 1, command: { amount: 99 } }).ok, false);
  assert.deepEqual(session.snapshot(), saved);
  assert.equal(session.submit({ sessionId: 'match-1', revision: 0, command: { amount: 2 } }).ok, false);
  assert.equal(session.submit({ sessionId: 'other', revision: 1, command: { amount: 2 } }).ok, false);
  assert.deepEqual(restoreSession(counter, JSON.parse(JSON.stringify(saved))).snapshot(), saved);
  const view = session.view();
  view.count = 100;
  assert.equal(session.view().count, 2);
});

test('invalid candidate, invalid command and invalid snapshot are rejected without writes', () => {
  const session = createSession(counter, 'one', { count: 1 });
  const saved = session.snapshot();
  for (const command of [{ amount: -2 }, { amount: NaN }, { amount: Infinity }, { amount: '3' }, null]) {
    assert.equal(session.submit({ sessionId: 'one', revision: 0, command }).ok, false);
    assert.deepEqual(session.snapshot(), saved);
  }
  assert.throws(() => restoreSession(counter, { ...saved, ruleset: 'other' }));
  assert.throws(() => restoreSession(counter, { ...saved, state: { count: -1 } }));
  assert.throws(() => restoreSession(counter, { ...saved, revision: 1.5 }));
  const restored = restoreSession(counter, saved);
  saved.state.count = 500;
  assert.equal(restored.view().count, 1);
});

test('retained candidate and emitted facts cannot mutate committed state', () => {
  let retained = { count: 0 };
  const session = createSession({ ...counter, decide: (s, c) => {
    s.count += c.amount;
    retained = s;
    return { ok: true, state: s, facts: [s] };
  } }, 'one', { count: 0 });
  const result = session.dispatch({ amount: 2 }, 0);
  retained.count = 10;
  if (result.ok && result.facts[0]) result.facts[0].count = 11;
  assert.equal(session.view().count, 2);
});

test('bad facts abort an otherwise valid state transition', () => {
  const session = createSession({ ...counter, decide: (s, c) => {
    s.count += c.amount;
    return { ok: true, state: s, facts: [{ count: Infinity }] };
  } }, 'one', { count: 0 });
  assert.equal(session.dispatch({ amount: 1 }, 0).ok, false);
  assert.equal(session.view().count, 0);
});

test('non-JSON state is rejected including accessors, dates, sparse arrays and symbol properties', () => {
  const identity: GameDefinition<unknown, unknown, unknown> = {
    ruleset: 'identity/1', parseState: s => s, parseCommand: c => c,
    decide: state => ({ ok: true, state, facts: [] }),
  };
  const symbolArray: unknown[] = [1];
  Object.defineProperty(symbolArray, Symbol('hidden'), { value: 2 });
  const accessorArray = [1];
  Object.defineProperty(accessorArray, '0', { get: () => 1, enumerable: true });
  for (const state of [new Date(), -0, [undefined], Array(2), symbolArray, accessorArray, { get count() { return 1; } }]) {
    assert.throws(() => createSession(identity, 'one', state));
  }
});

test('reentrant calls during validation are rejected', () => {
  let reenter: () => void = () => {};
  const session = createSession({ ...counter, parseCommand: value => {
    const run = reenter;
    reenter = () => {};
    run();
    return counter.parseCommand(value);
  } }, 'one', { count: 0 });
  reenter = () => assert.equal(session.dispatch({ amount: 10 }, 0).ok, false);
  assert.equal(session.dispatch({ amount: 1 }, 0).ok, true);
  assert.equal(session.view().count, 1);
});


test('a sparse array cannot hide its hole with an unrelated enumerable property', () => {
  const array = Array(1);
  Object.defineProperty(array, 'extra', { value: 7, enumerable: true });
  const identity: GameDefinition<unknown, unknown, unknown> = {
    ruleset: 'identity/1', parseState: s => s, parseCommand: c => c,
    decide: state => ({ ok: true, state, facts: [] }),
  };
  assert.throws(() => createSession(identity, 'one', array));
});
