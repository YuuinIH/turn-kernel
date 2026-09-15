import { detached } from "../../validation/json.js";
import { list, object, text } from "../../validation/parse.js";
import type { FlowIdentity, FlowReaction } from "./types.js";
export function matches(a: FlowIdentity, b: FlowIdentity): boolean {
  return a.id === b.id && a.version === b.version;
}
export function parseReactions(
  input: unknown,
  operations: readonly FlowIdentity[],
  flows: readonly FlowIdentity[],
): FlowReaction[] {
  return list(detached(input), (value): FlowReaction => {
    const action = object(value, ["kind", "request", "start"]);
    if (action.kind === "operation") {
      object(action, ["kind", "request"]);
      const r = object(action.request, ["operation", "version", "input"]);
      const request = {
        operation: text(r.operation),
        version: text(r.version),
        input: detached(r.input),
      };
      if (
        !operations.some((p) =>
          matches(p, { id: request.operation, version: request.version }),
        )
      )
        throw Error("Lifecycle operation denied");
      return { kind: "operation", request };
    }
    if (action.kind === "flow") {
      object(action, ["kind", "start"]);
      const r = object(action.start, ["type", "version", "step", "data"]);
      const start = {
        type: text(r.type),
        version: text(r.version),
        step: text(r.step),
        data: r.data === undefined ? null : detached(r.data),
      };
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
