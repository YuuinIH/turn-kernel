import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MemoryStore, RedisStore, createSession, openDurableSession, parse, type GameDefinition, type SessionStore, type Commit } from '../src/index.js';
const exec = promisify(execFile);
const game: GameDefinition<number, number, number> = { ruleset: 'count/1', parseState: parse.integer, parseCommand: parse.integer,
  decide: (s, n) => ({ ok: true, state: s + n, facts: [n] }) };
async function contract(store: SessionStore, expire: () => Promise<void>) {
  await store.create(createSession(game, 'one', 0).snapshot());
  await assert.rejects(() => store.create(createSession(game, 'one', 0).snapshot()));
  const a = await store.claim('one', 'worker-a', 50);
  await assert.rejects(() => store.claim('one', 'worker-b', 10000));
  const candidate = (requestId: string, value: number): Commit => ({ sessionId: 'one', lease: a, expectedRevision: 0,
    next: { format: 1, sessionId: 'one', ruleset: 'count/1', revision: 1, state: value }, receipt: { requestId, fingerprint: String(value), result: { ok: true, revision: 1, facts: [value] } } });
  // Renew to avoid test process timing affecting the race portion.
  await store.claim('one', 'worker-a', 10000);
  const outcomes = await Promise.all([store.commit(candidate('first', 1)), store.commit(candidate('second', 2))]);
  assert.equal(outcomes.filter(v => v === 'committed').length, 1); assert.equal(outcomes.filter(v => v === 'stale').length, 1);
  const winning = outcomes[0] === 'committed' ? candidate('first', 1) : candidate('second', 2);
  assert.equal(await store.commit(winning), 'duplicate');
  assert.equal(await store.commit({ ...winning, receipt: { ...winning.receipt, fingerprint: 'changed' } }), 'request-conflict');
  const loaded = await store.load('one'); assert.equal(loaded.snapshot.revision, 1);
  await expire();
  const b = await store.claim('one', 'worker-b', 10000); assert.ok(b.fence > a.fence);
  const next = { ...winning, expectedRevision: 1, next: { ...winning.next, revision: 2 }, receipt: { requestId: 'third', fingerprint: 'third', result: {} } };
  assert.equal(await store.commit(next), 'not-owner');
  assert.equal(await store.commit({ ...next, lease: b }), 'committed');
}
test('memory store implements CAS, receipts and fencing contract', async () => {
  let now = 0; await contract(new MemoryStore(() => now), async () => { now += 20000; });
});
test('real Redis implements the same CAS, receipts and fencing contract', async t => {
  try { await exec('redis-server', ['--version']); await exec('redis-cli', ['--version']); }
  catch { if (process.env.REQUIRE_REDIS === '1') throw Error('Redis binaries required'); t.skip('Install Redis or run CI with REQUIRE_REDIS=1'); return; }
  const dir = await mkdtemp(join(tmpdir(), 'turn-kernel-redis-')); const socket = join(dir, 'redis.sock');
  const server = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 100; i += 1) { try { await access(socket); await exec('redis-cli', ['-s', socket, 'PING']); ready = true; break; } catch { await delay(20); } }
    assert.ok(ready, 'Redis starts');
    const evaluate = async (script: string, keys: readonly string[], args: readonly string[]): Promise<unknown> => {
      const { stdout } = await exec('redis-cli', ['-s', socket, '--json', 'EVAL', script, String(keys.length), ...keys, ...args]);
      if (stdout.startsWith('error:')) throw Error(stdout); return JSON.parse(stdout);
    };
    const store = new RedisStore(evaluate, 'test');
    await contract(store, async () => { await exec('redis-cli', ['-s', socket, 'HSET', 'test:{one}:session', 'expires', '0']); });
  } finally {
    if (server.exitCode === null) { server.kill('SIGTERM'); await new Promise<void>(resolve => server.once('exit', () => resolve())); }
    await rm(dir, { recursive: true, force: true });
  }
});
test('durable session recovers lost acknowledgement, retries once and survives ownership transfer', async () => {
  let now = 0; const memory = new MemoryStore(() => now);
  await memory.create(createSession(game, 'one', 0).snapshot());
  let fail = true;
  const uncertain: SessionStore = { create: s => memory.create(s), claim: (s, o, ttl) => memory.claim(s, o, ttl), load: s => memory.load(s), receipt: (s, r) => memory.receipt(s, r),
    commit: async c => { const result = await memory.commit(c); if (fail) { fail = false; throw Error('Connection lost after commit'); } return result; },
  };
  const a = await openDurableSession(game, uncertain, 'one', 'a', parse.integer, 100);
  const first = await a.dispatch(4, 0, 'r1'); assert.equal(first.ok, true);
  assert.deepEqual(await a.dispatch(4, 0, 'r1'), first);
  assert.equal((await a.dispatch(5, 0, 'r1')).ok, false);
  assert.equal((await a.snapshot()).state, 4);
  now = 200;
  const b = await openDurableSession(game, memory, 'one', 'b', parse.integer);
  assert.equal((await a.dispatch(3, 1, 'old')).ok, false);
  assert.equal((await b.dispatch(3, 1, 'next')).ok, true);
  assert.equal((await b.snapshot()).state, 7);
});
