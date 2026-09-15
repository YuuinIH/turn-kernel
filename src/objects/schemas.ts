import { z } from "../validation/schema.js";
import { payloadSchema, textSchema } from "../validation/primitives.js";
export const refSchema = z.strictObject({
  kind: textSchema,
  sessionId: textSchema,
  id: textSchema,
});
export const entitySchema = z.strictObject({
  ref: refSchema,
  value: payloadSchema,
});
export const relationSchema = z.strictObject({
  id: textSchema,
  type: textSchema,
  from: refSchema,
  to: refSchema,
});
export const worldSchema = z.strictObject({
  sessionId: textSchema,
  entities: z.array(entitySchema),
  relations: z.array(relationSchema),
  retiredIds: z.array(textSchema),
});
