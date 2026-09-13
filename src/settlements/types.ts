import type { Ref } from "../objects/types.js";
export interface SettlementValueRef<N extends string = string> {
  kind: "settlement-value";
  sessionId: string;
  instanceId: string;
  definition: string;
  name: N;
}
export interface SettlementModifier<N extends string = string> {
  id: string;
  target: SettlementValueRef<N>;
  source: Ref;
  mode: "add" | "multiply";
  amount: number;
}
export interface Settlement<I> {
  definition: string;
  version: string;
  sessionId: string;
  id: string;
  stage: number;
  status: "open" | "ready" | "completed" | "cancelled";
  input: I;
  values: Record<string, { base: number; result: number | null }>;
  modifiers: SettlementModifier[];
}
export interface SettlementValueRule {
  stage: string;
  constrain?: (value: number) => number;
}
