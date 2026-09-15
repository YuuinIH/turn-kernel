import { detached } from "../validation/json.js";
import {
  settlementModifierSchema,
  settlementValueRefSchema,
} from "./schemas.js";
import type { SettlementModifier, SettlementValueRef } from "./types.js";
export function parseSettlementValueRef(input: unknown): SettlementValueRef {
  return settlementValueRefSchema.parse(detached(input));
}
export function parseSettlementModifier(input: unknown): SettlementModifier {
  return settlementModifierSchema.parse(detached(input));
}
