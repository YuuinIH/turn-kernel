import { ownValue } from "./ownership.js";
import type { ComponentTarget } from "../objects/components.js";
import { WorldQuery, type World } from "../objects/world.js";
import { detached } from "../validation/json.js";
import { finite, text, type Parser } from "../validation/parse.js";
import { parseRef, refKey, sameRef, type Ref } from "../objects/types.js";
import {
  combineNumeric,
  parseModifier,
  type NumericModifier,
} from "./modifiers.js";
export interface ValueDefinition<S, K extends string, T> {
  readonly id: string;
  readonly name: string;
  readonly kinds: readonly K[];
  readonly version: string;
  readonly component: { readonly id: string; readonly version: string };
  readonly numeric: boolean;
  validateTarget(world: World, ref: Ref): void;
  evaluate(query: Evaluation<S>, ref: Ref<NoInfer<K>>): T;
}
export function defineValue<S, K extends string, C, T>(
  target: ComponentTarget<K, C>,
  name: string,
  version: string,
  parse: Parser<T>,
  compute: (query: Evaluation<S>, ref: Ref<K>, component: C) => T,
): ValueDefinition<S, K, T> {
  return ownValue(
    Object.freeze({
      id: JSON.stringify([target.component.id, text(name)]),
      name,
      kinds: target.kinds,
      version: text(version),
      component: target.component,
      numeric: false,
      validateTarget(world: World, ref: Ref): void {
        new WorldQuery(world).component(target, target.parseRef(ref));
      },
      evaluate(query: Evaluation<S>, ref: Ref<K>): T {
        const data = query.component(target, ref);
        return detached(parse(compute(query, ref, data)));
      },
    }),
  );
}
export interface NumericValueDefinition<
  S,
  K extends string,
> extends ValueDefinition<S, K, number> {
  readonly numeric: true;
  modifier(
    input: Omit<NumericModifier, "target" | "valueId"> & {
      target: Ref<NoInfer<K>>;
    },
  ): NumericModifier;
}
export function defineNumericValue<S, K extends string, C>(
  target: ComponentTarget<K, C>,
  name: string,
  version: string,
  compute: (query: Evaluation<S>, ref: Ref<K>, component: C) => number,
  constrain: (value: number) => number = finite,
): NumericValueDefinition<S, K> {
  const definition = defineValue(target, name, version, finite, compute);
  return ownValue(
    Object.freeze({
      ...definition,
      numeric: true,
      modifier(
        input: Omit<NumericModifier, "target" | "valueId"> & {
          target: Ref<NoInfer<K>>;
        },
      ): NumericModifier {
        target.parseRef(input.target);
        return parseModifier({ ...input, valueId: definition.id });
      },
      evaluate(query: Evaluation<S>, ref: Ref<K>): number {
        const base = definition.evaluate(query, ref);
        return finite(
          constrain(combineNumeric(base, query.modifiers(definition.id, ref))),
        );
      },
    }),
  );
}
/** One evaluator per immutable candidate view. No cross-commit cache survives. */
export class Evaluation<S> {
  #state: S;
  #world: World;
  #modifiers: readonly NumericModifier[];
  #definitions: ReadonlySet<unknown>;
  #stack: string[] = [];
  #edges = new Map<string, Set<string>>();
  constructor(
    state: S,
    world: (state: S) => World,
    definitions: readonly ValueDefinition<S, string, unknown>[],
    modifiers: readonly NumericModifier[] = [],
  ) {
    this.#state = detached(state);
    this.#world = detached(world(detached(this.#state)));
    this.#modifiers = detached(modifiers);
    this.#definitions = new Set(definitions);
    if (new Set(definitions.map((d) => d.id)).size !== definitions.length)
      throw Error("Duplicate value definition");
    if (new Set(modifiers.map((m) => m.id)).size !== modifiers.length)
      throw Error("Duplicate modifier");
    for (const modifier of modifiers) {
      const definition = definitions.find((d) => d.id === modifier.valueId);
      if (!definition || !definition.numeric)
        throw Error("Modifier target/value mismatch");
      definition.validateTarget(this.#world, modifier.target);
    }
  }
  #dependency(key: string): void {
    const parent = this.#stack.at(-1);
    if (parent) {
      const edges = this.#edges.get(parent) ?? new Set<string>();
      edges.add(key);
      this.#edges.set(parent, edges);
    }
  }
  observe<T>(key: string, read: (state: S) => T): T {
    this.#dependency(`state:${key}`);
    return detached(read(detached(this.#state)));
  }
  component<K extends string, T>(
    target: ComponentTarget<K, T>,
    ref: Ref<NoInfer<K>>,
  ): T {
    return this.observe(`component:${target.component.id}:${refKey(ref)}`, () =>
      new WorldQuery(this.#world).component(target, ref),
    );
  }
  read<K extends string, T>(
    definition: ValueDefinition<S, K, T>,
    ref: Ref<NoInfer<K>>,
  ): T {
    parseRef(ref);
    if (!this.#definitions.has(definition))
      throw Error("Unregistered value or wrong target type");
    const key = `${definition.id}:${refKey(ref)}`;
    this.#dependency(key);
    if (this.#stack.includes(key))
      throw Error(`Dependency cycle: ${[...this.#stack, key].join(" -> ")}`);
    this.#stack.push(key);
    try {
      // Typed computation preserves the definition/result relationship without casting cached unknown.
      const value = definition.evaluate(this, detached(ref));
      return value;
    } finally {
      this.#stack.pop();
    }
  }
  modifiers(valueId: string, ref: Ref): readonly NumericModifier[] {
    this.#dependency(`modifiers:${valueId}:${refKey(ref)}`);
    return detached(
      this.#modifiers.filter(
        (m) => m.valueId === valueId && sameRef(m.target, ref),
      ),
    );
  }
  trace(): ReadonlyArray<{ value: string; dependencies: readonly string[] }> {
    return [...this.#edges].map(([value, edges]) => ({
      value,
      dependencies: [...edges].sort(),
    }));
  }
}
