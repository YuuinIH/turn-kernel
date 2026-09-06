import { detached } from '../validation/json.js';
import { finite, text, type Parser } from '../validation/parse.js';
import { parseRef, refKey, sameRef, type Ref } from '../objects/types.js';
import { combineNumeric, type NumericModifier } from './modifiers.js';
export interface ValueDefinition<S, K extends string, T> {
  readonly id: string; readonly version: string; readonly kind: K; readonly numeric: boolean;
  evaluate(query: Evaluation<S>, ref: Ref<NoInfer<K>>): T;
}
export function defineValue<S, const K extends string, T>(id: string, version: string, kind: K, parse: Parser<T>,
  compute: (query: Evaluation<S>, ref: Ref<K>) => T): ValueDefinition<S, K, T> {
  return Object.freeze({ id: text(id), version: text(version), kind, numeric: false,
    evaluate: (query: Evaluation<S>, ref: Ref<K>) => detached(parse(compute(query, ref))),
  });
}
export function defineNumericValue<S, const K extends string>(id: string, version: string, kind: K,
  compute: (query: Evaluation<S>, ref: Ref<K>) => number, constrain: (value: number) => number = finite): ValueDefinition<S, K, number> {
  return Object.freeze({ id: text(id), version: text(version), kind, numeric: true,
    evaluate(query: Evaluation<S>, ref: Ref<K>): number {
      const base = finite(compute(query, ref));
      const modifiers = query.modifiers(id, ref);
      return finite(constrain(combineNumeric(base, modifiers)));
    },
  });
}
/** One evaluator per immutable candidate view. No cross-commit cache survives. */
export class Evaluation<S> {
  #state: S; #modifiers: readonly NumericModifier[]; #definitions: ReadonlySet<unknown>;
  #stack: string[] = []; #edges = new Map<string, Set<string>>();
  constructor(state: S, definitions: readonly ValueDefinition<S, string, unknown>[], modifiers: readonly NumericModifier[] = []) {
    this.#state = detached(state); this.#modifiers = detached(modifiers); this.#definitions = new Set(definitions);
    if (new Set(definitions.map(d => d.id)).size !== definitions.length) throw Error('Duplicate value definition');
    if (new Set(modifiers.map(m => m.id)).size !== modifiers.length) throw Error('Duplicate modifier');
    for (const modifier of modifiers) {
      const definition = definitions.find(d => d.id === modifier.valueId);
      if (!definition || !definition.numeric || modifier.target.kind !== definition.kind) throw Error('Modifier target/value mismatch');
    }
  }
  #dependency(key: string): void {
    const parent = this.#stack.at(-1);
    if (parent) { const edges = this.#edges.get(parent) ?? new Set<string>(); edges.add(key); this.#edges.set(parent, edges); }
  }
  observe<T>(key: string, read: (state: S) => T): T {
    this.#dependency(`state:${key}`);
    return detached(read(detached(this.#state)));
  }
  read<K extends string, T>(definition: ValueDefinition<S, K, T>, ref: Ref<NoInfer<K>>): T {
    const parsed = parseRef(ref);
    if (!this.#definitions.has(definition) || parsed.kind !== definition.kind) throw Error('Unregistered value or wrong target type');
    const key = `${definition.id}:${refKey(ref)}`;
    this.#dependency(key);
    if (this.#stack.includes(key)) throw Error(`Dependency cycle: ${[...this.#stack, key].join(' -> ')}`);
    this.#stack.push(key);
    try {
      // Typed computation preserves the definition/result relationship without casting cached unknown.
      const value = definition.evaluate(this, detached(ref));
      return value;
    } finally { this.#stack.pop(); }
  }
  modifiers(valueId: string, ref: Ref): readonly NumericModifier[] {
    this.#dependency(`modifiers:${valueId}:${refKey(ref)}`);
    return detached(this.#modifiers.filter(m => m.valueId === valueId && sameRef(m.target, ref)));
  }
  trace(): ReadonlyArray<{ value: string; dependencies: readonly string[] }> {
    return [...this.#edges].map(([value, edges]) => ({ value, dependencies: [...edges].sort() }));
  }
}
