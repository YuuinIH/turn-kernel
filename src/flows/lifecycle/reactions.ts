import { detached } from "../../validation/json.js";
import { flowReactionsSchema } from "../schemas.js";
import type { FlowIdentity, FlowReaction } from "./types.js";
export function matches(a: FlowIdentity, b: FlowIdentity): boolean {
  return a.id === b.id && a.version === b.version;
}
export function parseReactions(
  input: unknown,
  operations: readonly FlowIdentity[],
  flows: readonly FlowIdentity[],
): FlowReaction[] {
  return flowReactionsSchema
    .parse(detached(input))
    .map((action): FlowReaction => {
      if (action.kind === "operation") {
        const { request } = action;
        if (
          !operations.some((p) =>
            matches(p, { id: request.operation, version: request.version }),
          )
        )
          throw Error("Lifecycle operation denied");
        return { kind: "operation", request };
      }
      if (action.kind === "flow") {
        const start = { ...action.start, data: action.start.data ?? null };
        if (
          !flows.some((p) =>
            matches(p, { id: start.type, version: start.version }),
          )
        )
          throw Error("Lifecycle child flow denied");
        return { kind: "flow", start };
      }
      throw Error("Unknown lifecycle reaction");
    });
}
