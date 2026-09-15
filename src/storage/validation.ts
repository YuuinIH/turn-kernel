import { detached } from "../validation/json.js";
import { snapshotSchema } from "../session/schemas.js";
import { commitSchema, receiptSchema } from "./schemas.js";
import type { Snapshot } from "../session/types.js";
import type { Commit, Receipt } from "./types.js";
export function parseSnapshot(input: unknown): Snapshot<unknown> {
  return snapshotSchema.parse(detached(input));
}
export function parseReceipt(input: unknown): Receipt {
  return receiptSchema.parse(detached(input));
}
export function validateCommit(input: Commit): Commit {
  const commit = commitSchema.parse(detached(input));
  if (
    commit.next.sessionId !== commit.sessionId ||
    commit.next.revision !== commit.expectedRevision + 1
  )
    throw Error("Invalid candidate version");
  return commit;
}
