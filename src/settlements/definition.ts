import { isDeepStrictEqual } from "node:util";
import type { ZodType } from "../validation/schema.js";
import { detached } from "../validation/json.js";
import { finite, integer, list, object, text } from "../validation/parse.js";
import { combineNumeric } from "../values/modifiers.js";
import { parseSettlementModifier } from "./modifiers.js";
import type {
  Settlement,
  SettlementModifier,
  SettlementValueRef,
  SettlementValueRule,
} from "./types.js";

/** Typed checkpoint arithmetic. Flow/Operation remains responsible for execution and commit. */
export function defineSettlement<I, const N extends string>(options: {
  id: string;
  version: string;
  input: ZodType<I>;
  stages: readonly string[];
  values: Record<N, SettlementValueRule>;
}) {
  const id = text(options.id),
    version = text(options.version);
  const stages = Object.freeze(options.stages.map(text));
  const entries: [string, SettlementValueRule][] = Object.entries(
    options.values,
  );
  const rules = new Map(
    entries.map(([name, rule]) => [text(name), Object.freeze({ ...rule })]),
  );
  if (!stages.length || new Set(stages).size !== stages.length || !rules.size)
    throw Error("Empty or duplicate settlement stages/values");
  for (const rule of rules.values())
    if (!stages.includes(rule.stage)) throw Error("Unknown settlement stage");
  const inputSchema = options.input;
  function parseInput(input: unknown): I {
    const original = detached(input),
      result = detached(inputSchema.parse(detached(original)));
    if (!isDeepStrictEqual(original, result))
      throw Error("Settlement input must be canonical");
    return result;
  }
  function ruleFor(name: string): SettlementValueRule {
    const rule = rules.get(name);
    if (!rule) throw Error("Unknown settlement value");
    return rule;
  }
  function calculate(s: Settlement<I>, name: string): number {
    const value = s.values[name];
    if (!value) throw Error("Unseeded settlement value");
    const rule = ruleFor(name);
    return finite(
      (rule.constrain ?? finite)(
        combineNumeric(
          value.base,
          s.modifiers.filter((m) => m.target.name === name),
        ),
      ),
    );
  }
  function parse(input: unknown): Settlement<I> {
    const v = object(detached(input), [
      "definition",
      "version",
      "sessionId",
      "id",
      "stage",
      "status",
      "input",
      "values",
      "modifiers",
    ]);
    if (v.definition !== id || v.version !== version)
      throw Error("Settlement definition/version mismatch");
    if (
      v.status !== "open" &&
      v.status !== "ready" &&
      v.status !== "completed" &&
      v.status !== "cancelled"
    )
      throw Error("Invalid settlement status");
    const stage = integer(v.stage, 0, stages.length);
    if (
      (v.status === "open" && stage === stages.length) ||
      ((v.status === "ready" || v.status === "completed") &&
        stage !== stages.length)
    )
      throw Error("Settlement stage/status mismatch");
    const values: Settlement<I>["values"] = {};
    for (const [name, raw] of Object.entries(
      object(v.values, [...rules.keys()]),
    )) {
      const item = object(raw, ["base", "result"]);
      Object.defineProperty(values, name, {
        value: {
          base: finite(item.base),
          result: item.result === null ? null : finite(item.result),
        },
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    const s: Settlement<I> = {
      definition: id,
      version,
      sessionId: text(v.sessionId),
      id: text(v.id),
      stage,
      status: v.status,
      input: parseInput(v.input),
      values,
      modifiers: list(v.modifiers, parseSettlementModifier),
    };
    if (new Set(s.modifiers.map((m) => m.id)).size !== s.modifiers.length)
      throw Error("Duplicate settlement modifier");
    for (const m of s.modifiers) {
      if (
        m.target.definition !== id ||
        m.target.instanceId !== s.id ||
        m.target.sessionId !== s.sessionId ||
        m.source.sessionId !== s.sessionId ||
        !Object.hasOwn(values, m.target.name)
      )
        throw Error("Foreign or unseeded settlement modifier target");
      ruleFor(m.target.name);
    }
    for (const [name, rule] of rules) {
      const index = stages.indexOf(rule.stage),
        value = Object.hasOwn(values, name) ? values[name] : undefined;
      if (index < stage) {
        if (
          !value ||
          value.result === null ||
          value.result !== calculate(s, name)
        )
          throw Error("Invalid frozen settlement value");
      } else if (value && (index > stage || value.result !== null))
        throw Error("Value outside its settlement stage");
      else if (value) calculate(s, name);
    }
    return s;
  }
  function writable(s: Settlement<I>, name: string): void {
    if (s.status !== "open" || ruleFor(name).stage !== stages[s.stage])
      throw Error("Settlement value is not writable in this stage");
  }
  return Object.freeze({
    id,
    version,
    stages,
    parse,
    start(
      identity: { sessionId: string; id: string },
      input: I,
    ): Settlement<I> {
      return parse({
        definition: id,
        version,
        ...identity,
        input,
        stage: 0,
        status: "open",
        values: {},
        modifiers: [],
      });
    },
    ref<const V extends N>(
      snapshot: Settlement<I>,
      name: V,
    ): SettlementValueRef<V> {
      const s = parse(snapshot);
      ruleFor(name);
      return {
        kind: "settlement-value",
        sessionId: s.sessionId,
        instanceId: s.id,
        definition: id,
        name,
      };
    },
    seed(snapshot: Settlement<I>, name: N, base: number): Settlement<I> {
      const s = parse(snapshot);
      writable(s, name);
      if (Object.hasOwn(s.values, name))
        throw Error("Settlement value already seeded");
      Object.defineProperty(s.values, name, {
        value: { base: finite(base), result: null },
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return parse(s);
    },
    modify(
      snapshot: Settlement<I>,
      modifier: SettlementModifier<NoInfer<N>>,
    ): Settlement<I> {
      const s = parse(snapshot),
        m = parseSettlementModifier(modifier);
      writable(s, m.target.name);
      s.modifiers.push(m);
      return parse(s);
    },
    read(snapshot: Settlement<I>, name: N): number {
      const s = parse(snapshot);
      ruleFor(name);
      if (s.status === "cancelled") throw Error("Settlement was cancelled");
      const value = Object.hasOwn(s.values, name) ? s.values[name] : undefined;
      if (!value) throw Error("Unseeded settlement value");
      return value.result ?? calculate(s, name);
    },
    advance(snapshot: Settlement<I>): Settlement<I> {
      const s = parse(snapshot);
      if (s.status !== "open") throw Error("Settlement is not open");
      for (const [name, rule] of rules)
        if (rule.stage === stages[s.stage]) {
          const value = Object.hasOwn(s.values, name)
            ? s.values[name]
            : undefined;
          if (!value) throw Error("Stage has unseeded values");
          value.result = calculate(s, name);
        }
      s.stage++;
      if (s.stage === stages.length) s.status = "ready";
      return parse(s);
    },
    complete(snapshot: Settlement<I>): Settlement<I> {
      const s = parse(snapshot);
      if (s.status !== "ready")
        throw Error("Settlement is not ready to complete");
      s.status = "completed";
      return parse(s);
    },
    cancel(snapshot: Settlement<I>): Settlement<I> {
      const s = parse(snapshot);
      if (s.status !== "open" && s.status !== "ready")
        throw Error("Settlement already terminal");
      s.status = "cancelled";
      return parse(s);
    },
  });
}
