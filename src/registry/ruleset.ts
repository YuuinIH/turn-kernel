import { createHash } from "node:crypto";
import { detached } from "../validation/json.js";
import { text, type Parser } from "../validation/parse.js";
const issuedTokens = new WeakSet<object>();
export type Category =
  | "object"
  | "relation"
  | "value"
  | "operation"
  | "flow"
  | "behavior"
  | "content";
export interface Registration<T> {
  readonly category: Category;
  readonly id: string;
  readonly version: string;
  readonly requires: readonly string[];
  readonly value: T;
}
export function registration<T>(
  category: Category,
  id: string,
  version: string,
  value: T,
  requires: readonly string[] = [],
): Registration<T> {
  if (
    ![
      "object",
      "relation",
      "value",
      "operation",
      "flow",
      "behavior",
      "content",
    ].includes(category)
  )
    throw Error("Unknown registration category");
  const token = Object.freeze({
    category,
    id: text(id),
    version: text(version),
    value: freezeDefinition(value),
    requires: Object.freeze(requires.map(text)),
  });
  issuedTokens.add(token);
  return token;
}
export function registrationKey(
  entry: Pick<Registration<unknown>, "category" | "id">,
): string {
  return `${entry.category}:${entry.id}`;
}
export interface Ruleset {
  readonly id: string;
  readonly manifest: readonly {
    key: string;
    version: string;
    requires: readonly string[];
  }[];
  resolve<T>(token: Registration<T>): T;
}
export class RulesetBuilder {
  #entries = new Map<string, Registration<unknown>>();
  #built = false;
  add<T>(entry: Registration<T>): this {
    if (this.#built) throw Error("Ruleset already sealed");
    if (!issuedTokens.has(entry))
      throw Error("Definition must come from the registration factory");
    const key = registrationKey(entry);
    if (this.#entries.has(key)) throw Error(`Duplicate registration: ${key}`);
    this.#entries.set(key, entry);
    return this;
  }
  build(name: string, revision: string): Ruleset {
    if (this.#built) throw Error("Ruleset already sealed");
    text(name);
    text(revision);
    for (const entry of this.#entries.values())
      for (const dependency of entry.requires) {
        if (!this.#entries.has(dependency))
          throw Error(
            `Missing dependency ${dependency} for ${registrationKey(entry)}`,
          );
      }
    const entries = new Map(this.#entries);
    const manifest = [...entries.values()]
      .map((e) => ({
        key: registrationKey(e),
        version: e.version,
        requires: [...e.requires].sort(),
      }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const digest = createHash("sha256")
      .update(JSON.stringify(manifest))
      .digest("hex");
    this.#built = true;
    return Object.freeze({
      id: `${name}/${revision}/${digest}`,
      manifest: freezeDefinition(manifest),
      resolve<T>(token: Registration<T>): T {
        if (entries.get(registrationKey(token)) !== token)
          throw Error("Unregistered or forged definition token");
        return token.value;
      },
    });
  }
}
/** Content parameters are parsed once, detached and pinned by their content hash. */
export function content<T>(
  id: string,
  input: unknown,
  parse: Parser<T>,
  requires: readonly string[] = [],
): Registration<T> {
  const value = detached(parse(detached(input)));
  const version = createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
  return registration("content", id, version, value, requires);
}

// Freeze definition objects and data, not mutable state captured inside trusted code.
function freezeDefinition<T>(value: T, seen = new Set<object>()): T {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  )
    return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (typeof value === "object" && !Array.isArray(value)) {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw Error(
        "Definitions cannot contain mutable containers or class instances",
      );
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor))
      throw Error("Definition accessors are not allowed");
    freezeDefinition(descriptor.value, seen);
  }
  return Object.freeze(value);
}
