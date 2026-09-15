import type { z } from "../validation/schema.js";
import { numericModifierSchema, lifetimeSchema } from "./schemas.js";
import type { World } from "../objects/world.js";
import { detached } from "../validation/json.js";
import { finite } from "../validation/parse.js";
import { sameRef, type Ref } from "../objects/types.js";
export type Lifetime = z.infer<typeof lifetimeSchema>;
export type NumericModifier = z.infer<typeof numericModifierSchema>;
export function parseModifier(input: unknown): NumericModifier {
  return numericModifierSchema.parse(detached(input));
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
  modifiers: readonly Pick<NumericModifier, "id" | "mode" | "amount">[],
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
    validateTarget(world: World, ref: Ref): void;
    readonly numeric: boolean;
  }[],
  world: World,
  flows: readonly string[],
): NumericModifier[] {
  if (new Set(definitions.map((d) => d.id)).size !== definitions.length)
    throw Error("Duplicate value definition");
  const modifiers = input.map(parseModifier);
  if (new Set(modifiers.map((m) => m.id)).size !== modifiers.length)
    throw Error("Duplicate modifier");
  for (const modifier of modifiers) {
    const definition = definitions.find((d) => d.id === modifier.valueId);
    if (!definition?.numeric) throw Error("Modifier target/value mismatch");
    definition.validateTarget(world, modifier.target);
  }
  if (
    activeModifiers(
      modifiers,
      world.entities.map((e) => e.ref),
      flows,
    ).length !== modifiers.length
  )
    throw Error("Expired modifier or missing endpoint");
  return modifiers;
}
