import { isDeepStrictEqual } from "node:util";
import { detached } from "../validation/json.js";
import type { ComponentTarget } from "./components.js";
import { sameRef, type Ref } from "./types.js";
import { WorldQuery, type World } from "./world.js";

/** Independent final check: exactly one component may differ, including object-wide invariants. */
export function authorizeComponentWrite<K extends string, T>(
  before: World,
  after: World,
  target: ComponentTarget<K, T>,
  ref: Ref<NoInfer<K>>,
): void {
  const candidate = detached(before);
  const parsed = target.parseRef(ref);
  const entity = candidate.entities.find((e) => sameRef(e.ref, parsed));
  if (!entity) throw Error("Missing component target");
  const value = new WorldQuery(after).component(target, parsed);
  entity.value = target.replace(parsed, entity.value, value);
  if (!isDeepStrictEqual(candidate, after))
    throw Error("Component write scope denied");
}
