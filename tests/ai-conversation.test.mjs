import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendAiConversationTurn,
  createAiConversationHistory,
  MAX_AI_CONVERSATION_CHARACTERS,
} from '../lib/ai-conversation.ts';

const syntheticTurn = (id, status = 'proposed') => ({
  id: String(id),
  instruction: `Synthetic instruction ${id}`,
  output: `Synthetic generated Markdown ${id}`,
  status,
});

test('conversation preserves complete chronological user/assistant exchanges and application state', () => {
  const turns = ['proposed', 'applied', 'discarded'].map((status, index) => syntheticTurn(index, status));
  const history = createAiConversationHistory(turns);
  assert.equal(history.includedTurns, 3);
  assert.equal(history.omittedTurns, 0);
  assert.deepEqual(history.messages.map(message => message.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  assert.match(history.messages[0].content, /Do not assume it was applied/);
  assert.match(history.messages[2].content, /was applied at that time/);
  assert.match(history.messages[4].content, /was discarded/);
  assert.match(history.messages[4].content, /latest request is authoritative/);
  assert.deepEqual(history.messages.filter(message => message.role === 'assistant').map(message => message.content), turns.map(turn => turn.output));
  assert.equal(history.includedCharacters, history.messages.reduce((total, message) => total + message.content.length, 0));
});

test('conversation trims only whole oldest exchanges and reports omissions', () => {
  const turns = Array.from({ length: 8 }, (_, index) => syntheticTurn(index));
  const history = createAiConversationHistory(turns);
  assert.equal(history.includedTurns, 6);
  assert.equal(history.omittedTurns, 2);
  assert.match(history.messages[0].content, /Synthetic instruction 2/);
  assert.equal(history.messages.at(-1).content, turns.at(-1).output);
  const lastPair = createAiConversationHistory(turns.slice(-1));
  const exact = createAiConversationHistory(turns, lastPair.includedCharacters);
  assert.deepEqual(exact.messages, lastPair.messages);
  assert.equal(exact.omittedTurns, 7);
  assert.deepEqual(createAiConversationHistory(turns, lastPair.includedCharacters - 1).messages, []);
});

test('large or unfinished latest turns do not resurrect older exchanges', () => {
  const turns = [syntheticTurn(1), { ...syntheticTurn(2), output: 'x'.repeat(MAX_AI_CONVERSATION_CHARACTERS) }];
  assert.equal(createAiConversationHistory(turns).includedTurns, 0);
  assert.equal(createAiConversationHistory(turns).omittedTurns, 2);
  assert.equal(createAiConversationHistory([syntheticTurn(1), { ...syntheticTurn(2), output: ' ' }]).includedTurns, 0);
});

test('caller budgets are bounded and zero budget omits every turn', () => {
  const turns = Array.from({ length: 8 }, (_, index) => syntheticTurn(index));
  assert.equal(createAiConversationHistory(turns, Infinity, Infinity).includedTurns, 6);
  for (const budget of [0, -1, NaN]) {
    const history = createAiConversationHistory(turns, budget);
    assert.deepEqual(history.messages, []);
    assert.equal(history.omittedTurns, 8);
  }
  assert.equal(createAiConversationHistory(turns, 20_000, 2).includedTurns, 2);
});

test('session memory is bounded and only retains complete turns without mutating input', () => {
  const original = [syntheticTurn(1)];
  const before = structuredClone(original);
  let turns = original;
  for (let index = 2; index <= 40; index += 1) turns = appendAiConversationTurn(turns, syntheticTurn(index));
  assert.deepEqual(original, before);
  assert.equal(turns.length, 30);
  assert.equal(turns[0].id, '11');
  assert.equal(turns.at(-1).id, '40');
  const bounded = appendAiConversationTurn(turns, { ...syntheticTurn(41), output: 'x'.repeat(199_900) });
  assert.equal(bounded.at(-1).id, '41');
  assert.ok(bounded.reduce((sum, turn) => sum + turn.instruction.length + turn.output.length, 0) <= 200_000);
  assert.equal(appendAiConversationTurn(turns, { ...syntheticTurn(42), output: '' }), turns);
});

test('replacing a turn id does not duplicate it', () => {
  const turns = [syntheticTurn(1)];
  const result = appendAiConversationTurn(turns, syntheticTurn(1, 'applied'));
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'applied');
  assert.equal(turns[0].status, 'proposed');
});
