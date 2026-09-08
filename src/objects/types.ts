import type { ZodType } from "../validation/schema.js";
import { detached } from "../validation/json.js";
import { object, text, type Parser } from "../validation/parse.js";
export interface Ref<K extends string = string> {
  kind: K;
  sessionId: string;
  id: string;
}
export interface Entity {
  ref: Ref;
  value: unknown;
}
export interface ObjectType<K extends string, T> {
  readonly kind: K;
  readonly version: string;
  readonly parse: Parser<T>;
  ref(sessionId: string, id: string): Ref<K>;
  parseRef(input: unknown): Ref<K>;
}
export function parseRef(input: unknown): Ref {
  const v = object(input, ["kind", "sessionId", "id"]);
  return { kind: text(v.kind), sessionId: text(v.sessionId), id: text(v.id) };
}
export function defineObject<const K extends string, T>(
  kind: K,
  version: string,
  schema: ZodType<T> | Parser<T>,
): ObjectType<K, T> {
  text(kind);
  text(version);
  // Capture parsing behavior, keeping schema instances outside frozen registries.
  const parse =
    typeof schema === "function"
      ? schema
      : (input: unknown) => schema.parse(input);
  return Object.freeze({
    kind,
    version,
    parse: (input: unknown) => detached(parse(detached(input))),
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
