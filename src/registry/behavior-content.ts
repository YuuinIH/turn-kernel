import { z } from "../validation/schema.js";
import type { OperationRequest } from "../operations/types.js";
import type { Parser } from "../validation/parse.js";
import {
  content,
  registrationKey,
  type Registration,
  type Ruleset,
} from "./ruleset.js";
export interface ContentBehavior<S, I> {
  readonly id: string;
  readonly version: string;
  parseInput: Parser<I>;
  plan(state: S, input: unknown): readonly OperationRequest[];
}
/** Typed binding of JSON/YAML parameters to a registered TS behavior. */
export function bindBehavior<S, I>(
  id: string,
  behavior: Registration<ContentBehavior<S, I>>,
  parameters: unknown,
) {
  if (
    behavior.category !== "behavior" ||
    behavior.id !== behavior.value.id ||
    behavior.version !== behavior.value.version
  )
    throw Error("Behavior registration mismatch");
  const input = behavior.value.parseInput(parameters);
  const bindingSchema = z.strictObject({
    behavior: z.literal(behavior.id),
    version: z.literal(behavior.version),
    parameters: z
      .unknown()
      .transform((value) => behavior.value.parseInput(value)),
  });
  const definition = content(
    id,
    { behavior: behavior.id, version: behavior.version, parameters: input },
    (value) => bindingSchema.parse(value),
    [registrationKey(behavior)],
  );
  return Object.freeze({
    definition,
    plan(ruleset: Ruleset, state: S): readonly OperationRequest[] {
      const bound = ruleset.resolve(definition);
      const implementation = ruleset.resolve(behavior);
      return implementation.plan(state, bound.parameters);
    },
  });
}
