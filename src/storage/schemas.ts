import { z } from "../validation/schema.js";
import {
  integerSchema,
  payloadSchema,
  textSchema,
} from "../validation/primitives.js";
import { snapshotSchema, submissionSchema } from "../session/schemas.js";
export const receiptSchema = z.strictObject({
  requestId: textSchema,
  fingerprint: textSchema,
  result: payloadSchema,
});
export const durableSubmissionSchema = submissionSchema.extend({
  requestId: textSchema,
});
export const successfulReceiptSchema = z.strictObject({
  ok: z.literal(true),
  revision: integerSchema,
  facts: z.array(payloadSchema),
});
export const leaseSchema = z.strictObject({
  owner: textSchema,
  fence: integerSchema.min(1),
});
export const commitSchema = z.strictObject({
  sessionId: textSchema,
  lease: leaseSchema,
  expectedRevision: integerSchema,
  next: snapshotSchema,
  receipt: receiptSchema,
});

export const commitResultSchema = z.enum([
  "committed",
  "duplicate",
  "request-conflict",
  "stale",
  "not-owner",
]);
export const redisLoadSchema = z.tuple([
  z.string(),
  z.string(),
  z.string(),
  z.string(),
]);
