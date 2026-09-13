/** Factory-issued metadata lets registration enforce component ownership. */
interface OwnedValue {
  readonly id: string;
  readonly version: string;
  readonly component: { readonly id: string; readonly version: string };
}
const owners = new WeakMap<object, OwnedValue>();
export function ownValue<T extends OwnedValue>(definition: T): T {
  owners.set(definition, definition);
  return definition;
}
export function valueOwnership(value: unknown): OwnedValue {
  const owner =
    typeof value === "object" && value !== null ? owners.get(value) : undefined;
  if (!owner) throw Error("Values must be declared under a component");
  return owner;
}
