import { detached } from "../validation/json.js";
import { finite, object, text } from "../validation/parse.js";
import { parseRef, sameRef, type Ref } from "../objects/types.js";
export type Lifetime = { kind: "source" } | { kind: "flow"; flowId: string };
export interface NumericModifier {
  id: string;
  target: Ref;
  valueId: string;
  mode: "add" | "multiply";
  amount: number;
  source: Ref;
  lifetime: Lifetime;
}
export function parseModifier(input: unknown): NumericModifier {
  const v = object(input, [
    "id",
    "target",
    "valueId",
    "mode",
    "amount",
    "source",
    "lifetime",
  ]);
  const life = object(v.lifetime, ["kind", "flowId"]);
  let lifetime: Lifetime;
  if (life.kind === "source" && life.flowId === undefined)
    lifetime = { kind: "source" };
  else if (life.kind === "flow")
    lifetime = { kind: "flow", flowId: text(life.flowId) };
  else throw Error("Invalid lifetime");
  if (v.mode !== "add" && v.mode !== "multiply")
    throw Error("Unsupported numeric modifier");
  return {
    id: text(v.id),
    target: parseRef(v.target),
    valueId: text(v.valueId),
    mode: v.mode,
    amount: finite(v.amount),
    source: parseRef(v.source),
    lifetime,
  };
}
export function activeModifiers(
  modifiers: readonly NumericModifier[],
  refs: readonly Ref[],
  flows: readonly string[],
): NumericModifier[] {
  return detached(
    modifiers.filter(
      (m) =>
        refs.some((r) => sameRef(r, m.source)) &&
        refs.some((r) => sameRef(r, m.target)) &&
        (m.lifetime.kind === "source" || flows.includes(m.lifetime.flowId)),
    ),
  );
}
export function combineNumeric(
  base: number,
  modifiers: readonly NumericModifier[],
): number {
  finite(base);
  const ordered = [...modifiers].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  let result = base;
  // Explicit policy: sum additions first, then multiply factors. Rounding belongs to the field.
  for (const m of ordered)
    if (m.mode === "add") result = finite(result + finite(m.amount));
  for (const m of ordered)
    if (m.mode === "multiply") result = finite(result * finite(m.amount));
  return result;
}

/** Checkpoints reject invalid/expired modifiers; cleanup is an explicit operation. */
export function validateModifiers(
  input: readonly unknown[],
  definitions: readonly {
    readonly id: string;
    readonly kind: string;
    readonly numeric: boolean;
  }[],
  refs: readonly Ref[],
  flows: readonly string[],
): NumericModifier[] {
  if (new Set(definitions.map((d) => d.id)).size !== definitions.length)
    throw Error("Duplicate value definition");
  const modifiers = input.map(parseModifier);
  if (new Set(modifiers.map((m) => m.id)).size !== modifiers.length)
    throw Error("Duplicate modifier");
  for (const modifier of modifiers) {
    const definition = definitions.find((d) => d.id === modifier.valueId);
    if (!definition?.numeric || definition.kind !== modifier.target.kind)
      throw Error("Modifier target/value mismatch");
  }
  if (activeModifiers(modifiers, refs, flows).length !== modifiers.length)
    throw Error("Expired modifier or missing endpoint");
  return modifiers;
}
