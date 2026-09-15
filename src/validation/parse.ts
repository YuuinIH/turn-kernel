import { isDeepStrictEqual } from "node:util";
import { detached } from "./json.js";
import { z } from "./schema.js";
import { finiteSchema, textSchema } from "./primitives.js";
export type Parser<T> = (value: unknown) => T;
/** Legacy field-list helper. Prefer a module's named strict schema for new protocols. */
export function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const source = detached(value);
  const parsed = z
    .strictObject(
      Object.fromEntries(keys.map((key) => [key, z.unknown().optional()])),
    )
    .parse(source);
  if (!isDeepStrictEqual(source, parsed))
    throw Error("Object parser changed input");
  return parsed;
}
export function text(value: unknown): string {
  return textSchema.parse(value);
}
export function integer(
  value: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  return z.number().int().min(min).max(max).parse(value);
}
export function finite(value: unknown): number {
  return finiteSchema.parse(value);
}
export function list<T>(value: unknown, parse: Parser<T>): T[] {
  return z
    .array(z.unknown())
    .parse(detached(value))
    .map((item) => parse(item));
}
