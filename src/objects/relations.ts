import { detached } from '../validation/json.js';
import { text } from '../validation/parse.js';
import { refKey, sameRef, type Ref } from './types.js';
export interface RelationDefinition {
  readonly id: string;
  readonly version: string;
  readonly from: string;
  readonly to: string;
  readonly cardinality: 'one' | 'many';
  readonly required: boolean;
  readonly acyclic: boolean;
  readonly onTargetDelete: 'restrict' | 'detach' | 'cascade';
}
export interface Relation { id: string; type: string; from: Ref; to: Ref }
export function defineRelation(definition: RelationDefinition): RelationDefinition {
  text(definition.id); text(definition.version);
  return Object.freeze(detached(definition));
}
export function validateRelations(refs: readonly Ref[], relations: readonly Relation[], definitions: readonly RelationDefinition[]): void {
  const byId = new Map(definitions.map(d => [d.id, d]));
  const ids = new Set<string>();
  for (const relation of relations) {
    if (ids.has(relation.id)) throw Error('Duplicate relation ID');
    ids.add(relation.id);
    const definition = byId.get(relation.type);
    if (!definition || relation.from.kind !== definition.from || relation.to.kind !== definition.to ||
      !refs.some(ref => sameRef(ref, relation.from)) || !refs.some(ref => sameRef(ref, relation.to))) throw Error('Invalid relation endpoints');
  }
  for (const definition of definitions) {
    const edges = relations.filter(r => r.type === definition.id);
    for (const ref of refs.filter(r => r.kind === definition.from)) {
      const count = edges.filter(r => sameRef(r.from, ref)).length;
      if ((definition.required && count === 0) || (definition.cardinality === 'one' && count > 1)) throw Error('Relation cardinality violation');
    }
    if (definition.acyclic) {
      const visit = (ref: Ref, path: Set<string>): void => {
        const key = refKey(ref);
        if (path.has(key)) throw Error(`Relation cycle: ${definition.id}`);
        const next = new Set(path).add(key);
        for (const edge of edges.filter(r => sameRef(r.from, ref))) visit(edge.to, next);
      };
      for (const edge of edges) visit(edge.from, new Set());
    }
  }
}
