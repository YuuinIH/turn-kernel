import { isDeepStrictEqual } from "node:util";
import { detached } from "../../validation/json.js";
import { integer, text } from "../../validation/parse.js";
import type { FlowDefinition, FlowStep, StartFlow } from "../types.js";
import type {
  FlowIdentity,
  FlowLifecycle,
  LifecycleDefinition,
} from "./types.js";
import { matches, parseReactions } from "./reactions.js";

function ordered<T extends FlowIdentity & { readonly order: number }>(
  items: readonly T[],
): T[] {
  if (new Set(items.map((h) => h.id)).size !== items.length)
    throw Error("Duplicate lifecycle handler");
  for (const h of items) {
    text(h.id);
    text(h.version);
    integer(h.order, -Number.MAX_SAFE_INTEGER);
  }
  return [...items].sort(
    (a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
export function defineFlow<S, I, R>(
  definition: LifecycleDefinition<S, I, R> & {
    readonly id: string;
    readonly version: string;
    readonly entry: string;
    readonly steps: Readonly<Record<string, FlowStep<S>>>;
  },
): FlowDefinition<S> & { start(input: I): StartFlow } {
  const id = text(definition.id),
    version = text(definition.version),
    entry = text(definition.entry);
  if (!Object.hasOwn(definition.steps, entry))
    throw Error("Missing flow entry");
  const inputSchema = definition.input,
    resultSchema = definition.result;
  const parseInput = (v: unknown): I => {
    const parsed = detached(inputSchema.parse(detached(v)));
    if (!isDeepStrictEqual(v, parsed))
      throw Error("Lifecycle input must be canonical JSON");
    return parsed;
  };
  const parseResult = (v: unknown): R => {
    const parsed = detached(resultSchema.parse(detached(v)));
    if (!isDeepStrictEqual(v, parsed))
      throw Error("Lifecycle result must be canonical JSON");
    return parsed;
  };
  const before = ordered(definition.hooks?.before?.handlers ?? []).map((h) =>
    Object.freeze({ ...h }),
  );
  const after = ordered(definition.hooks?.after?.handlers ?? []).map((h) =>
    Object.freeze({
      ...h,
      operations: h.operations.map(({ id, version }) => ({
        id: text(id),
        version: text(version),
      })),
      flows: h.flows.map(({ id, version }) => ({
        id: text(id),
        version: text(version),
      })),
    }),
  );
  const authorize = definition.hooks?.before?.authorizeReplacement;
  const cancel = definition.hooks?.before?.cancel === true;
  const handler = (index: number) => {
    const h = after[integer(index)];
    if (!h) throw Error("Unknown lifecycle handler cursor");
    return h;
  };
  const lifecycle = Object.freeze<FlowLifecycle<S>>({
    entry,
    afterCount: after.length,
    parseInput,
    parseResult,
    before(state, input, frameId, spend) {
      let accepted = parseInput(input);
      for (const h of before) {
        spend();
        const decision = detached(
          h.run(detached(state), detached(accepted), { frameId }),
        );
        switch (decision.kind) {
          case "continue":
            break;
          case "replace": {
            if (!authorize) throw Error("Lifecycle input replacement denied");
            const replacement = parseInput(decision.input);
            authorize(
              detached(state),
              detached(accepted),
              detached(replacement),
            );
            accepted = replacement;
            break;
          }
          case "cancel":
            if (!cancel) throw Error("Lifecycle cancellation denied");
            return { kind: "cancel", reason: text(decision.reason) };
          default:
            throw Error("Invalid before decision");
        }
      }
      return { kind: "replace", input: accepted };
    },
    after(index, state, input, result, frameId) {
      const h = handler(index);
      return parseReactions(
        h.run(detached(state), {
          input: parseInput(input),
          result: parseResult(result),
          frameId,
        }),
        h.operations,
        h.flows,
      );
    },
    parseReactions(index, input) {
      const h = handler(index);
      return parseReactions(input, h.operations, h.flows);
    },
    validateReferences(definitions, operations) {
      for (const h of after) {
        for (const p of h.flows)
          if (!definitions.some((d) => matches(d, p)))
            throw Error("Unknown lifecycle flow permission");
        for (const p of h.operations)
          if (!operations.some((d) => matches(d, p)))
            throw Error("Unknown lifecycle operation permission");
      }
    },
  });
  return Object.freeze({
    id,
    version,
    lifecycle,
    steps: Object.freeze(
      Object.fromEntries(
        Object.entries(definition.steps).map(([key, step]) => [
          key,
          Object.freeze({ ...step }),
        ]),
      ),
    ),
    start(input: I): StartFlow {
      return { type: id, version, step: entry, data: parseInput(input) };
    },
  });
}
