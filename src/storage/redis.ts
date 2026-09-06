import { integer, list, text } from '../validation/parse.js';
import type { Snapshot } from '../session/types.js';
import type { Commit, CommitResult, Lease, Receipt, SessionStore, StoredSession } from './types.js';
import { parseReceipt, parseSnapshot, validateCommit } from './validation.js';
import { SESSION_SCRIPT } from './redis-script.js';
export type RedisEval = (script: string, keys: readonly string[], args: readonly string[]) => Promise<unknown>;
/** Supply a Redis client's EVAL adapter; no client connection enters game definitions. */
export class RedisStore implements SessionStore {
  constructor(private readonly evaluate: RedisEval, private readonly prefix = 'turn-kernel') {}
  #key(id: string): string { return `${this.prefix}:{${encodeURIComponent(text(id))}}:session`; }
  #run(id: string, ...args: string[]): Promise<unknown> { return this.evaluate(SESSION_SCRIPT, [this.#key(id)], args); }
  async create(input: Snapshot<unknown>): Promise<void> {
    const s = parseSnapshot(input);
    await this.#run(s.sessionId, 'create', JSON.stringify(s), String(s.revision), s.ruleset);
  }
  async claim(id: string, owner: string, leaseMs: number): Promise<Lease> {
    text(owner); integer(leaseMs, 1, 3600000);
    const fence = integer(Number(await this.#run(id, 'claim', owner, String(leaseMs))), 1);
    return { owner, fence };
  }
  async load(id: string): Promise<StoredSession> {
    const result = list(await this.#run(id, 'load'), value => { if (typeof value !== 'string') throw Error('Redis protocol'); return value; });
    const [snapshot, fence, owner, expiry] = result;
    if (snapshot === undefined || owner === undefined || result.length !== 4) throw Error('Redis protocol');
    const parsed = parseSnapshot(JSON.parse(snapshot));
    if (parsed.sessionId !== id) throw Error('Storage session mismatch');
    return { snapshot: parsed, fence: integer(Number(fence)), owner, leaseUntil: integer(Number(expiry)) };
  }
  async receipt(id: string, requestId: string): Promise<Receipt | null> {
    const result = await this.#run(id, 'receipt', text(requestId));
    if (result === null || result === false) return null;
    return parseReceipt(JSON.parse(text(result)));
  }
  async commit(input: Commit): Promise<CommitResult> {
    const c = validateCommit(input);
    const result = await this.#run(c.sessionId, 'commit', c.lease.owner, String(c.lease.fence), String(c.expectedRevision),
      c.receipt.requestId, c.receipt.fingerprint, JSON.stringify(c.next), JSON.stringify(c.receipt), c.next.ruleset, String(c.next.revision));
    if (result !== 'committed' && result !== 'duplicate' && result !== 'request-conflict' && result !== 'stale' && result !== 'not-owner') throw Error('Redis protocol');
    return result;
  }
}
