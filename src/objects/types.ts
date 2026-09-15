import { refSchema, entitySchema } from "./schemas.js";
import { isDeepStrictEqual } from "node:util";
import { componentField, type ComponentSlot } from "./components.js";
import type { z, ZodType } from "../validation/schema.js";
import { detached } from "../validation/json.js";
import { text, type Parser } from "../validation/parse.js";
export type Ref<K extends string = string> = Omit<
  z.infer<typeof refSchema>,
  "kind"
> & { kind: K };
export type Entity = z.infer<typeof entitySchema>;
export interface ObjectType<K extends string, T> {
  readonly kind: K;
  readonly components: readonly ComponentSlot[];
  readonly version: string;
  readonly parse: Parser<T>;
  ref(sessionId: string, id: string): Ref<K>;
  parseRef(input: unknown): Ref<K>;
}
export function parseRef(input: unknown): Ref {
  return refSchema.parse(detached(input));
}
export function defineObject<const K extends string, T>(
  kind: K,
  version: string,
  schema: ZodType<T> | Parser<T>,
  components: readonly ComponentSlot[] = [],
): ObjectType<K, T> {
  text(kind);
  text(version);
  const slots = Object.freeze([...components]);
  if (
    new Set(slots.map((s) => s.id)).size !== slots.length ||
    new Set(slots.map((s) => s.key)).size !== slots.length
  )
    throw Error("Duplicate component declaration");
  // Capture parsing behavior, keeping schema instances outside frozen registries.
  const parse =
    typeof schema === "function"
      ? schema
      : (input: unknown) => schema.parse(input);
  return Object.freeze({
    kind,
    version,
    components: slots,
    parse: (input: unknown) => {
      const source = detached(input);
      const value = detached(parse(detached(source)));
      if (slots.length > 0 && !isDeepStrictEqual(source, value))
        throw Error("Component objects must preserve canonical state");
      for (const slot of slots) slot.parse(componentField(value, slot.key));
      return value;
    },
    ref: (sessionId: string, id: string): Ref<K> => ({
      kind,
      sessionId: text(sessionId),
      id: text(id),
    }),
    parseRef(input: unknown): Ref<K> {
      const ref = parseRef(input);
      if (ref.kind !== kind)
        throw Error(`Expected ${kind} reference, received ${ref.kind}`);
      return { kind, sessionId: ref.sessionId, id: ref.id };
    },
  });
}
export function sameRef(a: Ref, b: Ref): boolean {
  return a.id === b.id && a.kind === b.kind && a.sessionId === b.sessionId;
}
export function refKey(ref: Ref): string {
  return JSON.stringify([ref.sessionId, ref.kind, ref.id]);
}
