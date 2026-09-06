import { detached } from '../validation/json.js';
import { integer, text, type Parser } from '../validation/parse.js';
import type { BeforeRule, Operation, OperationDefinition, OperationOutcome, OperationRequest, ReactionRule } from './types.js';
export function defineOperation<S, I, F>(definition: OperationDefinition<S, I, F>) {
  const id = text(definition.id); const version = text(definition.version);
  const parse = definition.parse; const execute = definition.execute; const authorize = definition.authorize;
  const operation: Operation<S, F> = Object.freeze({ id, version,
    run(state: S, input: unknown): OperationOutcome<S, F> {
      const parsed = detached(parse(detached(input)));
      const before = detached(state);
      const result = execute(detached(state), detached(parsed));
      authorize(detached(before), detached(result.state), detached(parsed));
      return detached(result);
    },
  });
  return Object.freeze({ operation, request: (input: I): OperationRequest => ({ operation: id, version, input: detached(parse(detached(input))) }) });
}
function ordered<T extends { id: string; order: number }>(rules: readonly T[]): T[] {
  if (new Set(rules.map(r => r.id)).size !== rules.length) throw Error('Duplicate rule ID');
  for (const rule of rules) integer(rule.order, -Number.MAX_SAFE_INTEGER);
  return [...rules].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export class OperationRuntime<S, F> {
  #operations: Map<string, Operation<S, F>>;
  #parse: Parser<S>;
  #before: readonly BeforeRule<S>[];
  #reactions: readonly ReactionRule<S, F>[];
  constructor(parse: Parser<S>, operations: readonly Operation<S, F>[], before: readonly BeforeRule<S>[] = [], reactions: readonly ReactionRule<S, F>[] = []) {
    this.#parse = parse;
    this.#operations = new Map(operations.map(o => [o.id, o]));
    if (this.#operations.size !== operations.length) throw Error('Duplicate operation');
    this.#before = ordered(before); this.#reactions = ordered(reactions);
  }
  execute(initial: S, requests: readonly OperationRequest[], budget = 100): OperationOutcome<S, F> {
    integer(budget, 1, 10000);
    let state = detached(this.#parse(detached(initial)));
    const queue = detached([...requests]); const facts: F[] = [];
    let steps = 0;
    while (queue.length) {
      if (++steps > budget) throw Error('Operation/reaction budget exceeded');
      let request: OperationRequest | null | undefined = queue.shift();
      if (!request) throw Error('Missing operation');
      for (const rule of this.#before) {
        request = rule.apply(detached(state), detached(request));
        if (request === null) break;
      }
      if (request === null) continue;
      const operation = this.#operations.get(request.operation);
      if (!operation || operation.version !== request.version) throw Error('Unknown operation or version');
      const result = operation.run(state, request.input);
      state = detached(this.#parse(result.state));
      for (const fact of result.facts) {
        facts.push(detached(fact));
        for (const rule of this.#reactions) queue.push(...detached(rule.react(detached(state), detached(fact))));
      }
    }
    return { state, facts };
  }
}
/** Content receives detached queries and can only return explicitly allowed operations. */
export function defineBehavior<S, I>(id: string, version: string, parse: Parser<I>, allowed: readonly { id: string; version: string }[],
  plan: (query: () => S, input: I) => readonly OperationRequest[]) {
  const permissions = new Set(allowed.map(o => `${o.id}@${o.version}`));
  return Object.freeze({ id: text(id), version: text(version),
    plan(state: S, input: unknown): readonly OperationRequest[] {
      const source = detached(state);
      const requests = detached(plan(() => detached(source), detached(parse(detached(input)))));
      if (requests.some(r => !permissions.has(`${r.operation}@${r.version}`))) throw Error('Behavior operation denied');
      return requests;
    },
  });
}
