import { z } from "../validation/schema.js";
import {
  finiteSchema,
  integerSchema,
  payloadSchema,
  textSchema,
} from "../validation/primitives.js";
import { refSchema } from "../objects/schemas.js";
export const settlementValueRefSchema = z.strictObject({
  kind: z.literal("settlement-value"),
  sessionId: textSchema,
  instanceId: textSchema,
  definition: textSchema,
  name: textSchema,
});
export const settlementModifierSchema = z.strictObject({
  id: textSchema,
  target: settlementValueRefSchema,
  source: refSchema,
  mode: z.enum(["add", "multiply"]),
  amount: finiteSchema,
});
export const settlementValueSchema = z.strictObject({
  base: finiteSchema,
  result: finiteSchema.nullable(),
});
export const settlementSchema = z.strictObject({
  definition: textSchema,
  version: textSchema,
  sessionId: textSchema,
  id: textSchema,
  stage: integerSchema,
  status: z.enum(["open", "ready", "completed", "cancelled"]),
  input: payloadSchema,
  values: z.record(textSchema, settlementValueSchema),
  modifiers: z.array(settlementModifierSchema),
});
