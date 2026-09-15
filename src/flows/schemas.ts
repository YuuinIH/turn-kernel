import { z } from "../validation/schema.js";
import {
  integerSchema,
  payloadSchema,
  textSchema,
} from "../validation/primitives.js";
import { operationRequestSchema } from "../operations/schemas.js";

export const startFlowSchema = z.strictObject({
  type: textSchema,
  version: textSchema,
  step: textSchema,
  data: payloadSchema.optional(),
});
export const flowReactionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("operation"),
    request: operationRequestSchema,
  }),
  z.strictObject({ kind: z.literal("flow"), start: startFlowSchema }),
]);
export const flowReactionsSchema = z.array(flowReactionSchema);
export const lifecycleCheckpointSchema = z.discriminatedUnion("phase", [
  z.strictObject({ phase: z.literal("before") }),
  z.strictObject({ phase: z.literal("body"), input: payloadSchema }),
  z.strictObject({
    phase: z.literal("after"),
    input: payloadSchema,
    result: payloadSchema,
    handler: integerSchema,
    pending: flowReactionsSchema,
    awaitingChild: z.boolean(),
  }),
]);
export const frameSchema = z.strictObject({
  id: textSchema,
  type: textSchema,
  version: textSchema,
  step: textSchema,
  data: payloadSchema,
  childResult: payloadSchema,
  childCancelled: textSchema.nullable(),
  lifecycle: lifecycleCheckpointSchema.nullable(),
});
export const promptSchema = z.strictObject({
  id: textSchema,
  actor: textSchema,
  frameId: textSchema,
});
export const flowStateSchema = z.strictObject({
  format: z.literal(2, { error: "Unsupported flow checkpoint format" }),
  instanceId: textSchema,
  sequence: integerSchema.min(1),
  stack: z.array(frameSchema),
  status: z.enum(["running", "waiting", "finished", "cancelled", "fault"]),
  prompt: promptSchema.nullable(),
  result: payloadSchema,
  error: textSchema.nullable(),
  cancellation: textSchema.nullable(),
});
export const flowIdentitySchema = z.tuple([
  textSchema,
  z.enum(["frame", "choice"]),
  integerSchema,
]);
