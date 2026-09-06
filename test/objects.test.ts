import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineObject, defineRelation, WorldEditor, WorldQuery, worldParser, parse, type World } from '../src/index.js';
const pet = defineObject('pet', '1', input => { const v = parse.object(input, ['hp']); return { hp: parse.integer(v.hp, 0, 10) }; });
const mark = defineObject('mark', '1', input => { const v = parse.object(input, ['stacks']); return { stacks: parse.integer(v.stacks, 1, 9) }; });
const attached = defineRelation({ id: 'attached', version: '1', from: 'mark', to: 'pet', cardinality: 'one', required: true, acyclic: true, onTargetDelete: 'cascade' });
const parseWorld = worldParser([pet, mark], [attached]);
function fixture(): World { return { sessionId: 'one', entities: [{ ref: pet.ref('one', 'p'), value: { hp: 5 } }, { ref: mark.ref('one', 'm'), value: { stacks: 1 } }],
  relations: [{ id: 'link', type: 'attached', from: mark.ref('one', 'm'), to: pet.ref('one', 'p') }], retiredIds: [] }; }
test('object types, session identity, field schema and relation cardinality are enforced', () => {
  const w = parseWorld(fixture()); const q = new WorldQuery(w);
  assert.deepEqual(q.get(pet, pet.ref('one', 'p')), { hp: 5 });
  assert.throws(() => q.get(pet, pet.ref('other', 'p')));
  assert.throws(() => pet.parseRef(mark.ref('one', 'm')));
  assert.throws(() => parseWorld({ ...w, relations: [] }));
  assert.throws(() => parseWorld({ ...w, relations: [...w.relations, { id: 'second', type: 'attached', from: mark.ref('one', 'm'), to: pet.ref('one', 'p') }] }));
  const writer = new WorldEditor(w, { objects: ['mark'], relations: ['attached'] }, [attached]);
  assert.throws(() => writer.set(pet, pet.ref('one', 'p'), { hp: 8 }));
  const read = q.get(pet, pet.ref('one', 'p')); read.hp = 0;
  assert.equal(q.get(pet, pet.ref('one', 'p')).hp, 5);
});
test('target deletion cascades attachments, retires identities and denies resurrection', () => {
  const w = parseWorld(fixture()); const editor = new WorldEditor(w, { objects: ['pet', 'mark'], relations: ['attached'] }, [attached]);
  editor.remove(pet.ref('one', 'p'));
  assert.equal(parseWorld(w).entities.length, 0); assert.equal(w.relations.length, 0);
  assert.throws(() => editor.create(pet, pet.ref('one', 'p'), { hp: 4 }));
});
test('relation cycles and restricted deletion reject', () => {
  const parent = defineRelation({ id: 'parent', version: '1', from: 'pet', to: 'pet', cardinality: 'one', required: false, acyclic: true, onTargetDelete: 'restrict' });
  const world: World = { sessionId: 'one', entities: [{ ref: pet.ref('one', 'a'), value: { hp: 1 } }, { ref: pet.ref('one', 'b'), value: { hp: 2 } }], relations: [{ id: 'ab', type: 'parent', from: pet.ref('one', 'a'), to: pet.ref('one', 'b') }], retiredIds: [] };
  const validate = worldParser([pet], [parent]); validate(world);
  assert.throws(() => new WorldEditor(world, { objects: ['pet'], relations: ['parent'] }, [parent]).remove(pet.ref('one', 'b')));
  world.relations.push({ id: 'ba', type: 'parent', from: pet.ref('one', 'b'), to: pet.ref('one', 'a') });
  assert.throws(() => validate(world), /cycle/);
});
// @ts-expect-error A mark reference cannot be read as a pet.
const invalid = () => new WorldQuery(fixture()).get(pet, mark.ref('one', 'm'));
void invalid;
