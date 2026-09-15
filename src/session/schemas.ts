import { z } from "../validation/schema.js";
import {
  integerSchema,
  payloadSchema,
  textSchema,
} from "../validation/primitives.js";
export const snapshotSchema = z.strictObject({
  format: z.literal(1),
  ruleset: textSchema,
  sessionId: textSchema,
  revision: integerSchema,
  state: payloadSchema,
});
export const submissionSchema = z.strictObject({
  sessionId: textSchema,
  revision: integerSchema,
  command: payloadSchema,
});
