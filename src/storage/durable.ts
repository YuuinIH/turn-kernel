import { createHash } from 'node:crypto';
import { detached, record } from '../validation/json.js';
import { integer, list, object, text, type Parser } from '../validation/parse.js';
import { restoreSession } from '../session/session.js';
import type { GameDefinition, Snapshot, Submission } from '../session/types.js';
import type { Receipt, SessionStore } from './types.js';
export type DurableResult<F> = Submission<F> | { ok: false; code: 'request-conflict' | 'not-owner' | 'storage-uncertain'; reason: string };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v: unknown) => canonical(v)).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  const encoded = JSON.stringify(value); if (encoded === undefined) throw Error('Not JSON'); return encoded;
}
export async function openDurableSession<S, C, F>(game: GameDefinition<S, C, F>, store: SessionStore,
  sessionId: string, owner: string, parseFact: Parser<F>, leaseMs = 30000) {
  const lease = await store.claim(sessionId, owner, leaseMs);
  function decode(receipt: Receipt, fingerprint: string): DurableResult<F> {
    if (receipt.fingerprint !== fingerprint) return { ok: false, code: 'request-conflict', reason: 'Request ID reused with different payload' };
    const result = object(receipt.result, ['ok', 'revision', 'facts']);
    if (result.ok !== true) throw Error('Invalid stored receipt');
    return { ok: true, revision: integer(result.revision), facts: list(result.facts, parseFact) };
  }
  async function submit(input: unknown): Promise<DurableResult<F>> {
    let revision: number; let requestId: string; let command: C; let fingerprint: string;
    try {
      const request = object(detached(input), ['sessionId', 'revision', 'requestId', 'command']);
      if (request.sessionId !== sessionId) return { ok: false, code: 'wrong-session', reason: 'Session mismatch' };
      revision = integer(request.revision); requestId = text(request.requestId);
      command = detached(game.parseCommand(detached(request.command)));
      // Fingerprint the original payload: changing a field is not the same request.
      fingerprint = createHash('sha256').update(canonical(request)).digest('hex');
    } catch { return { ok: false, code: 'invalid-input', reason: 'Invalid durable request' }; }
    const previous = await store.receipt(sessionId, requestId);
    if (previous) return decode(previous, fingerprint);
    const current = await store.load(sessionId);
    if (current.owner !== lease.owner || current.fence !== lease.fence) return { ok: false, code: 'not-owner', reason: 'Ownership changed' };
    const candidate = restoreSession(game, current.snapshot);
    const result = candidate.dispatch(command, revision);
    if (!result.ok) return result;
    const facts = result.facts.map(fact => detached(parseFact(detached(fact))));
    const success = { ...result, facts };
    const next = candidate.snapshot();
    try {
      const outcome = await store.commit({ sessionId, lease, expectedRevision: revision, next,
        receipt: { requestId, fingerprint, result: success } });
      if (outcome === 'committed') return success;
      if (outcome === 'duplicate') {
        const receipt = await store.receipt(sessionId, requestId);
        if (!receipt) throw Error('Missing committed receipt');
        return decode(receipt, fingerprint);
      }
      if (outcome === 'request-conflict') return { ok: false, code: 'request-conflict', reason: 'Request ID reused' };
      if (outcome === 'not-owner') return { ok: false, code: 'not-owner', reason: 'Lease expired or replaced' };
      return { ok: false, code: 'stale-revision', reason: 'Concurrent commit' };
    } catch {
      try { const receipt = await store.receipt(sessionId, requestId); if (receipt) return decode(receipt, fingerprint); } catch { /* preserve uncertainty */ }
      return { ok: false, code: 'storage-uncertain', reason: 'Retry with the same request ID and payload' };
    }
  }
  return {
    submit,
    dispatch: (command: C, revision: number, requestId: string) => submit({ sessionId, revision, requestId, command }),
    snapshot: async (): Promise<Snapshot<S>> => restoreSession(game, (await store.load(sessionId)).snapshot).snapshot(),
    renew: async (): Promise<void> => {
      const renewed = await store.claim(sessionId, owner, leaseMs);
      if (renewed.fence !== lease.fence) throw Error('Lease lost; reopen the session');
    },
  };
}
