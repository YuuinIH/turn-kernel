import { detached } from "../validation/json.js";
import { list, object, text } from "../validation/parse.js";
import {
  parseRef,
  sameRef,
  type Entity,
  type ObjectType,
  type Ref,
} from "./types.js";
import {
  validateRelations,
  type Relation,
  type RelationDefinition,
} from "./relations.js";
export interface World {
  sessionId: string;
  entities: Entity[];
  relations: Relation[];
  retiredIds: string[];
}
export interface WritePolicy {
  objects: readonly string[];
  relations: readonly string[];
}
export function worldParser(
  types: readonly ObjectType<string, unknown>[],
  relations: readonly RelationDefinition[],
) {
  const definitions = new Map(types.map((t) => [t.kind, t]));
  return (input: unknown): World => {
    const value = object(input, [
      "sessionId",
      "entities",
      "relations",
      "retiredIds",
    ]);
    const sessionId = text(value.sessionId);
    const entities = list(value.entities, (input) => {
      const e = object(input, ["ref", "value"]);
      const ref = parseRef(e.ref);
      const type = definitions.get(ref.kind);
      if (!type || ref.sessionId !== sessionId)
        throw Error("Unknown or foreign object");
      return { ref, value: type.parse(e.value) };
    });
    const links = list(value.relations, (input) => {
      const r = object(input, ["id", "type", "from", "to"]);
      return {
        id: text(r.id),
        type: text(r.type),
        from: parseRef(r.from),
        to: parseRef(r.to),
      };
    });
    const retiredIds = list(value.retiredIds, text);
    const ids = [...entities.map((e) => e.ref.id), ...retiredIds];
    if (new Set(ids).size !== ids.length)
      throw Error("Duplicate or reused object ID");
    validateRelations(
      entities.map((e) => e.ref),
      links,
      relations,
    );
    return detached({ sessionId, entities, relations: links, retiredIds });
  };
}
/** Queries return detached values. This module never grants a writer to content code. */
export class WorldQuery {
  #world: World;
  constructor(world: World) {
    this.#world = detached(world);
  }
  get<K extends string, T>(type: ObjectType<K, T>, ref: Ref<NoInfer<K>>): T {
    type.parseRef(ref);
    const entity = this.#world.entities.find((e) => sameRef(e.ref, ref));
    if (!entity) throw Error("Missing or stale object");
    return type.parse(entity.value);
  }
  refs<K extends string, T>(type: ObjectType<K, T>): Ref<K>[] {
    return this.#world.entities
      .filter((e) => e.ref.kind === type.kind)
      .map((e) => type.parseRef(e.ref));
  }
  links(type: string, from?: Ref): Relation[] {
    return detached(
      this.#world.relations.filter(
        (r) => r.type === type && (!from || sameRef(r.from, from)),
      ),
    );
  }
}
/** Trusted operation implementation only. Permission checked again at each mutation. */
export class WorldEditor {
  #world: World;
  #policy: WritePolicy;
  #relations: readonly RelationDefinition[];
  constructor(
    world: World,
    policy: WritePolicy,
    relations: readonly RelationDefinition[],
  ) {
    this.#world = world;
    this.#policy = detached(policy);
    this.#relations = relations;
  }
  #allow(kind: string): void {
    if (!this.#policy.objects.includes(kind))
      throw Error(`Write denied: ${kind}`);
  }
  set<K extends string, T>(
    type: ObjectType<K, T>,
    ref: Ref<NoInfer<K>>,
    value: NoInfer<T>,
  ): void {
    this.#allow(type.kind);
    type.parseRef(ref);
    const entity = this.#world.entities.find((e) => sameRef(e.ref, ref));
    if (!entity) throw Error("Missing object");
    entity.value = type.parse(value);
  }
  create<K extends string, T>(
    type: ObjectType<K, T>,
    ref: Ref<NoInfer<K>>,
    value: NoInfer<T>,
  ): void {
    this.#allow(type.kind);
    type.parseRef(ref);
    if (
      ref.sessionId !== this.#world.sessionId ||
      this.#world.entities.some((e) => e.ref.id === ref.id) ||
      this.#world.retiredIds.includes(ref.id)
    )
      throw Error("Invalid or reused identity");
    this.#world.entities.push({ ref: detached(ref), value: type.parse(value) });
  }
  link(relation: Relation): void {
    if (!this.#policy.relations.includes(relation.type))
      throw Error("Relation write denied");
    this.#world.relations.push(detached(relation));
  }
  unlink(id: string): void {
    const relation = this.#world.relations.find((r) => r.id === id);
    if (!relation || !this.#policy.relations.includes(relation.type))
      throw Error("Relation write denied");
    this.#world.relations = this.#world.relations.filter((r) => r.id !== id);
  }
  remove(ref: Ref): void {
    this.#allow(ref.kind);
    if (!this.#world.entities.some((e) => sameRef(e.ref, ref)))
      throw Error("Missing object");
    // Collect the cascade before modifying anything, including restrict checks.
    const removed = new Map<string, Ref>([[ref.id, ref]]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const relation of this.#world.relations) {
        if (!removed.has(relation.to.id) || removed.has(relation.from.id))
          continue;
        const def = this.#relations.find((d) => d.id === relation.type);
        if (!def) throw Error("Unknown relation");
        if (def.onTargetDelete === "cascade") {
          this.#allow(relation.from.kind);
          removed.set(relation.from.id, relation.from);
          changed = true;
        }
      }
    }
    for (const relation of this.#world.relations) {
      if (
        removed.has(relation.to.id) &&
        !removed.has(relation.from.id) &&
        this.#relations.find((d) => d.id === relation.type)?.onTargetDelete ===
          "restrict"
      )
        throw Error("Referenced object cannot be deleted");
      if (
        (removed.has(relation.from.id) || removed.has(relation.to.id)) &&
        !this.#policy.relations.includes(relation.type)
      )
        throw Error("Relation cleanup denied");
    }
    this.#world.entities = this.#world.entities.filter(
      (e) => !removed.has(e.ref.id),
    );
    this.#world.relations = this.#world.relations.filter(
      (r) => !removed.has(r.from.id) && !removed.has(r.to.id),
    );
    this.#world.retiredIds.push(...removed.keys());
  }
}
