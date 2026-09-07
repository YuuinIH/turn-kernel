import { detached } from "../validation/json.js";
import { integer, object, text } from "../validation/parse.js";
import type { Snapshot } from "../session/types.js";
import type { Commit, Receipt } from "./types.js";
export function parseSnapshot(input: unknown): Snapshot<unknown> {
  const s = object(detached(input), [
    "format",
    "ruleset",
    "sessionId",
    "revision",
    "state",
  ]);
  if (s.format !== 1) throw Error("Unknown snapshot format");
  return {
    format: 1,
    ruleset: text(s.ruleset),
    sessionId: text(s.sessionId),
    revision: integer(s.revision),
    state: detached(s.state),
  };
}
export function parseReceipt(input: unknown): Receipt {
  const r = object(input, ["requestId", "fingerprint", "result"]);
  return {
    requestId: text(r.requestId),
    fingerprint: text(r.fingerprint),
    result: detached(r.result),
  };
}
export function validateCommit(commit: Commit): Commit {
  const next = parseSnapshot(commit.next);
  text(commit.sessionId);
  text(commit.lease.owner);
  integer(commit.lease.fence, 1);
  integer(commit.expectedRevision);
  if (
    next.sessionId !== commit.sessionId ||
    next.revision !== commit.expectedRevision + 1
  )
    throw Error("Invalid candidate version");
  return { ...detached(commit), next, receipt: parseReceipt(commit.receipt) };
}
