export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject non-JSON values instead of silently dropping or rewriting them. */
function checkJson(value: unknown, parents = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    !Object.is(value, -0)
  )
    return;
  if (typeof value !== "object" || value === null || parents.has(value))
    throw Error("Not finite acyclic JSON");
  const proto: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null)
    throw Error("Not a plain object");
  parents.add(value);
  const array = Array.isArray(value);
  if (array && Object.keys(value).length !== value.length)
    throw Error("Sparse or extended array");
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === "length") continue;
    if (typeof key !== "string") throw Error("Symbol key");
    if (
      array &&
      (!Number.isInteger(Number(key)) ||
        Number(key) < 0 ||
        Number(key) >= value.length ||
        String(Number(key)) !== key)
    )
      throw Error("Non-index array property");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
      throw Error("Accessor or hidden property");
    checkJson(descriptor.value, parents);
  }
  parents.delete(value);
}

export function detached<T>(value: T): T {
  checkJson(value);
  return structuredClone(value);
}
