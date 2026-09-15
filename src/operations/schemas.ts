import { z } from "../validation/schema.js";
import { payloadSchema, textSchema } from "../validation/primitives.js";
export const operationRequestSchema = z.strictObject({
  operation: textSchema,
  version: textSchema,
  input: payloadSchema,
});
