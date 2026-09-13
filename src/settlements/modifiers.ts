import { finite, object, text } from "../validation/parse.js";
import { parseRef } from "../objects/types.js";
import type { SettlementModifier, SettlementValueRef } from "./types.js";
export function parseSettlementValueRef(input: unknown): SettlementValueRef {
  const v = object(input, [
    "kind",
    "sessionId",
    "instanceId",
    "definition",
    "name",
  ]);
  if (v.kind !== "settlement-value")
    throw Error("Expected settlement value reference");
  return {
    kind: "settlement-value",
    sessionId: text(v.sessionId),
    instanceId: text(v.instanceId),
    definition: text(v.definition),
    name: text(v.name),
  };
}
export function parseSettlementModifier(input: unknown): SettlementModifier {
  const v = object(input, ["id", "target", "source", "mode", "amount"]);
  if (v.mode !== "add" && v.mode !== "multiply")
    throw Error("Invalid settlement modifier mode");
  return {
    id: text(v.id),
    target: parseSettlementValueRef(v.target),
    source: parseRef(v.source),
    mode: v.mode,
    amount: finite(v.amount),
  };
}
