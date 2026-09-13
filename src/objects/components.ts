import {
  defineValue,
  defineNumericValue,
  type Evaluation,
  type ValueDefinition,
  type NumericValueDefinition,
} from "../values/evaluation.js";
import { isDeepStrictEqual } from "node:util";
import { z, type ZodType } from "../validation/schema.js";
import { detached } from "../validation/json.js";
import { text, type Parser } from "../validation/parse.js";
import { parseRef, type ObjectType, type Ref } from "./types.js";

export interface ComponentSlot {
  readonly id: string;
  readonly version: string;
  readonly key: string;
  readonly parse: Parser<unknown>;
}
export interface ComponentDefinition<T> {
  readonly id: string;
  readonly version: string;
  readonly parse: Parser<T>;
  schema(): ZodType<T>;
  slot(key: string): ComponentSlot;
}
/** Component state occupies one field in the object's authoritative value. */
export function defineComponent<T>(
  id: string,
  version: string,
  schema: ZodType<T>,
): ComponentDefinition<T> {
  text(id);
  text(version);
  const parse = (input: unknown) => {
    const source = detached(input);
    const value = detached(schema.parse(detached(source)));
    if (!isDeepStrictEqual(source, value))
      throw Error(
        "Component schemas must preserve canonical state; convert command inputs separately",
      );
    return value;
  };
  return Object.freeze({
    id,
    version,
    parse,
    schema: () => z.unknown().transform(parse),
    slot: (key: string) =>
      Object.freeze({ id, version, key: text(key), parse }),
  });
}
export function componentField(value: unknown, key: string): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !Object.hasOwn(value, key)
  )
    throw Error(`Missing component field: ${key}`);
  return Reflect.get(value, key);
}
export interface ComponentTarget<K extends string, T> {
  readonly component: ComponentDefinition<T>;
  value<S, R>(
    name: string,
    version: string,
    parse: Parser<R>,
    compute: (query: Evaluation<S>, ref: Ref<K>, component: T) => R,
  ): ValueDefinition<S, K, R>;
  numericValue<S>(
    name: string,
    version: string,
    compute: (query: Evaluation<S>, ref: Ref<K>, component: T) => number,
    constrain?: (value: number) => number,
  ): NumericValueDefinition<S, K>;
  readonly kinds: readonly K[];
  parseRef(input: unknown): Ref<K>;
  read(ref: Ref<NoInfer<K>>, value: unknown): T;
  replace(ref: Ref<NoInfer<K>>, value: unknown, next: NoInfer<T>): unknown;
}
/** Explicit registered object set supplies the compile-time kind union and runtime membership. */
export function componentTarget<K extends string, T>(
  component: ComponentDefinition<T>,
  ...types: readonly ObjectType<K, unknown>[]
): ComponentTarget<K, T> {
  if (!types.length || new Set(types.map((t) => t.kind)).size !== types.length)
    throw Error("Empty or duplicate component target types");
  const entries = types.map((type) => {
    const slot = type.components.find((s) => s.id === component.id);
    if (
      !slot ||
      slot.version !== component.version ||
      slot.parse !== component.parse
    )
      throw Error(`Component ${component.id} is not declared by ${type.kind}`);
    return { type, slot };
  });
  function entry(ref: Ref) {
    const found = entries.find((e) => e.type.kind === ref.kind);
    if (!found) throw Error("Target lacks required component");
    found.type.parseRef(ref);
    return found;
  }
  const target: ComponentTarget<K, T> = {
    component,
    value: (name, version, parse, compute) =>
      defineValue(target, name, version, parse, compute),
    numericValue: (name, version, compute, constrain) =>
      defineNumericValue(target, name, version, compute, constrain),
    kinds: Object.freeze(types.map((t) => t.kind)),
    parseRef(input: unknown): Ref<K> {
      const ref = parseRef(input);
      return entry(ref).type.parseRef(ref);
    },
    read(ref: Ref<K>, value: unknown): T {
      const { type, slot } = entry(ref);
      return component.parse(componentField(type.parse(value), slot.key));
    },
    replace(ref: Ref<K>, value: unknown, next: T): unknown {
      const { type, slot } = entry(ref);
      const parsed = type.parse(value);
      componentField(parsed, slot.key);
      if (typeof parsed !== "object" || parsed === null)
        throw Error("Invalid component object");
      return type.parse({ ...parsed, [slot.key]: component.parse(next) });
    },
  };
  return Object.freeze(target);
}
