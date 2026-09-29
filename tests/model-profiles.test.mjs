import assert from 'node:assert/strict';
import test from 'node:test';
import { activeModelProfile, removeModelProfile, normalizeModelProfiles } from '../lib/model-profiles.ts';

const first = { id: 'one', name: 'Writing', provider: 'openai', model: 'writer', baseUrl: 'https://one.example/v1', apiKey: 'first-key' };
const second = { id: 'two', name: 'Diagrams', provider: 'anthropic', model: 'diagram', baseUrl: 'https://two.example', apiKey: 'second-key' };
const settings = { profiles: [first, second], activeId: 'one' };

test('switching profiles selects the entire matching connection, not just the model name', () => {
  assert.deepEqual(activeModelProfile(settings), first);
  assert.deepEqual(activeModelProfile({ ...settings, activeId: 'two' }), second);
  assert.equal(activeModelProfile({ ...settings, activeId: 'missing' }), undefined);
});

test('deleting the active profile selects a remaining profile and removing the last clears selection', () => {
  assert.deepEqual(removeModelProfile(settings, 'one'), { profiles: [second], activeId: 'two' });
  assert.deepEqual(removeModelProfile(settings, 'two'), { profiles: [first], activeId: 'one' });
  assert.deepEqual(removeModelProfile({ profiles: [first], activeId: 'one' }, 'one'), { profiles: [], activeId: null });
  assert.equal(settings.profiles.length, 2);
});

test('normalizing drafts trims credentials and uses the model as an optional profile-name fallback', () => {
  const result = normalizeModelProfiles({ profiles: [{ ...first, name: ' ', model: ' writer ', baseUrl: ' https://one.example/v1/// ', apiKey: ' first-key ' }], activeId: 'one' });
  assert.deepEqual(result, { profiles: [{ ...first, name: 'writer' }], activeId: 'one' });
});
