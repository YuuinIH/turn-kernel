import { z } from "./schema.js";

/** Validate without trimming/coercing identifiers or rewriting checkpoints. */
export const textSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Expected nonempty string");
export const integerSchema = z.number().int().min(0);
export const finiteSchema = z.number({ error: "Expected finite number" });
/** Required opaque JSON payload. The boundary's detached() validates its contents. */
export const payloadSchema = z
  .unknown()
  .refine((value): boolean => value !== undefined, "Required JSON payload");
