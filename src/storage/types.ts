import type { Snapshot } from '../session/types.js';
export interface Receipt { requestId: string; fingerprint: string; result: unknown }
export interface StoredSession { snapshot: Snapshot<unknown>; fence: number; owner: string; leaseUntil: number }
export interface Lease { owner: string; fence: number }
export interface Commit {
  sessionId: string; lease: Lease; expectedRevision: number;
  next: Snapshot<unknown>; receipt: Receipt;
}
export type CommitResult = 'committed' | 'duplicate' | 'request-conflict' | 'stale' | 'not-owner';
export interface SessionStore {
  create(snapshot: Snapshot<unknown>): Promise<void>;
  claim(sessionId: string, owner: string, leaseMs: number): Promise<Lease>;
  load(sessionId: string): Promise<StoredSession>;
  receipt(sessionId: string, requestId: string): Promise<Receipt | null>;
  commit(commit: Commit): Promise<CommitResult>;
}
