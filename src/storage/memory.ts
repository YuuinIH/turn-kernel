import { detached } from '../validation/json.js';
import { integer, text } from '../validation/parse.js';
import type { Snapshot } from '../session/types.js';
import type { Commit, CommitResult, Lease, Receipt, SessionStore, StoredSession } from './types.js';
import { parseSnapshot, validateCommit } from './validation.js';
interface Entry extends StoredSession { receipts: Map<string, Receipt> }
export class MemoryStore implements SessionStore {
  #entries = new Map<string, Entry>();
  constructor(private readonly now: () => number = Date.now) {}
  #entry(id: string): Entry { const entry = this.#entries.get(id); if (!entry) throw Error('Session missing'); return entry; }
  async create(input: Snapshot<unknown>): Promise<void> {
    const snapshot = parseSnapshot(input);
    if (this.#entries.has(snapshot.sessionId)) throw Error('Session exists');
    this.#entries.set(snapshot.sessionId, { snapshot, fence: 0, owner: '', leaseUntil: 0, receipts: new Map() });
  }
  async claim(id: string, owner: string, leaseMs: number): Promise<Lease> {
    text(owner); integer(leaseMs, 1, 3600000);
    const entry = this.#entry(id); const now = this.now();
    if (entry.leaseUntil > now && entry.owner !== owner) throw Error('Session already owned');
    if (entry.leaseUntil <= now || entry.owner !== owner) entry.fence = integer(entry.fence + 1, 1);
    entry.owner = owner; entry.leaseUntil = now + leaseMs;
    return { owner, fence: entry.fence };
  }
  async load(id: string): Promise<StoredSession> {
    const { snapshot, fence, owner, leaseUntil } = this.#entry(id); return detached({ snapshot, fence, owner, leaseUntil });
  }
  async receipt(id: string, requestId: string): Promise<Receipt | null> { return detached(this.#entry(id).receipts.get(requestId) ?? null); }
  async commit(input: Commit): Promise<CommitResult> {
    const c = validateCommit(input); const entry = this.#entry(c.sessionId);
    const previous = entry.receipts.get(c.receipt.requestId);
    if (previous) return previous.fingerprint === c.receipt.fingerprint ? 'duplicate' : 'request-conflict';
    if (entry.owner !== c.lease.owner || entry.fence !== c.lease.fence || entry.leaseUntil <= this.now()) return 'not-owner';
    if (entry.snapshot.revision !== c.expectedRevision || entry.snapshot.ruleset !== c.next.ruleset) return 'stale';
    entry.snapshot = detached(c.next); entry.receipts.set(c.receipt.requestId, detached(c.receipt));
    return 'committed';
  }
}
