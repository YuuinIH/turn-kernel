import type { z } from "../validation/schema.js";
import type {
  receiptSchema,
  leaseSchema,
  commitSchema,
  commitResultSchema,
} from "./schemas.js";
import type { Snapshot } from "../session/types.js";
export type Receipt = z.infer<typeof receiptSchema>;
export interface StoredSession {
  snapshot: Snapshot<unknown>;
  fence: number;
  owner: string;
  leaseUntil: number;
}
export type Lease = z.infer<typeof leaseSchema>;
export type Commit = z.infer<typeof commitSchema>;
export type CommitResult = z.infer<typeof commitResultSchema>;
export interface SessionStore {
  create(snapshot: Snapshot<unknown>): Promise<void>;
  claim(sessionId: string, owner: string, leaseMs: number): Promise<Lease>;
  load(sessionId: string): Promise<StoredSession>;
  receipt(sessionId: string, requestId: string): Promise<Receipt | null>;
  commit(commit: Commit): Promise<CommitResult>;
}
