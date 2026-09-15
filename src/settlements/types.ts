import type { z } from "../validation/schema.js";
import type {
  settlementValueRefSchema,
  settlementModifierSchema,
  settlementSchema,
} from "./schemas.js";
export type SettlementValueRef<N extends string = string> = Omit<
  z.infer<typeof settlementValueRefSchema>,
  "name"
> & { name: N };
export type SettlementModifier<N extends string = string> = Omit<
  z.infer<typeof settlementModifierSchema>,
  "target"
> & { target: SettlementValueRef<N> };
export type Settlement<I> = Omit<z.infer<typeof settlementSchema>, "input"> & {
  input: I;
};
export interface SettlementValueRule {
  stage: string;
  constrain?: (value: number) => number;
}
