import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RulesetBuilder, registration, content, parse } from '../src/index.js';
test('registration rejects duplicates, missing dependencies and forged tokens; manifests ignore registration order', () => {
  const operation = registration('operation', 'heal', '1', { target: 'pet' });
  const behavior = registration('behavior', 'medic', '1', { operation: 'heal' }, ['operation:heal']);
  assert.throws(() => new RulesetBuilder().add(operation).add(operation), /Duplicate/);
  assert.throws(() => new RulesetBuilder().add(behavior).build('game', '1'), /Missing/);
  const builder = new RulesetBuilder().add(operation).add(behavior);
  const rules = builder.build('game', '1');
  assert.equal(rules.id, new RulesetBuilder().add(behavior).add(operation).build('game', '1').id);
  assert.equal(rules.resolve(operation).target, 'pet');
  assert.throws(() => rules.resolve(registration('operation', 'heal', '1', { target: 'mark' })));
  assert.throws(() => builder.add(registration('operation', 'other', '1', {})));
});
test('content is schema checked and its hash changes when values change', () => {
  const a = content('cost', 10, parse.integer); const b = content('cost', 11, parse.integer);
  assert.notEqual(a.version, b.version);
  assert.throws(() => content('cost', 'invalid', parse.integer));
});

test('registered definition values and manifest dependencies are frozen', () => {
  const token = registration('content', 'data', '1', { nested: { value: 1 } });
  const rules = new RulesetBuilder().add(token).build('test', '1');
  assert.throws(() => { token.value.nested.value = 2; });
  assert.equal(rules.resolve(token).nested.value, 1);
});
