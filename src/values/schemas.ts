import { z } from "../validation/schema.js";
import { finiteSchema, textSchema } from "../validation/primitives.js";
import { refSchema } from "../objects/schemas.js";
export const lifetimeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("source") }),
  z.strictObject({ kind: z.literal("flow"), flowId: textSchema }),
]);
export const numericModifierSchema = z.strictObject({
  id: textSchema,
  target: refSchema,
  valueId: textSchema,
  mode: z.enum(["add", "multiply"]),
  amount: finiteSchema,
  source: refSchema,
  lifetime: lifetimeSchema,
});
