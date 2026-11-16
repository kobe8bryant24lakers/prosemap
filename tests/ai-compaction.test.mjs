import assert from 'node:assert/strict';
import test from 'node:test';
import { appendPendingAiConversationTurn, MAX_AI_SUMMARY_CHARACTERS, prepareAiConversation } from '../lib/ai-compaction.ts';

const config = { provider: 'openai', baseUrl: 'https://synthetic.invalid/v1', model: 'synthetic-model', apiKey: 'SYNTHETIC-NOT-A-REAL-KEY' };
const turn = (id, output = `SYNTHETIC output ${id}`, status = 'proposed') => ({ id: String(id), instruction: `SYNTHETIC instruction ${id}`, output, status });
const options = (overrides = {}) => ({ turns: [], memory: null, budget: 20_000, config, signal: new AbortController().signal, ...overrides });
const summary = 'SYNTHETIC SUMMARY\nGoal: write project docs.\nConstraint: preserve public APIs.\nRejected: renaming the service.';

function recorder(output = summary) {
  const requests = [];
  return {
    requests,
    stream: async (input, delta, signal) => {
      requests.push(input);
      assert.equal(signal.aborted, false);
      delta(output);
    },
  };
}

test('short conversations preserve exact complete turns without calling a summarizer', async () => {
  const turns = [turn(1), turn(2, 'SYNTHETIC accepted content', 'applied')];
  const fake = recorder();
  const result = await prepareAiConversation(options({ turns, stream: fake.stream }));
  assert.equal(fake.requests.length, 0);
  assert.equal(result.didCompact, false);
  assert.equal(result.memory, null);
  assert.deepEqual(result.turns, turns);
  assert.equal(result.history.messages.length, 4);
  assert.equal(result.history.messages[3].content, turns[1].output);
  assert.equal(result.history.omittedTurns, 0);
});

test('seven raw turns compact the oldest four and preserve the latest three with application states', async () => {
  const turns = Array.from({ length: 7 }, (_, index) => turn(index, `SYNTHETIC document ${index}`, ['applied', 'discarded', 'proposed'][index % 3]));
  const before = structuredClone(turns);
  const fake = recorder();
  const progress = [];
  const result = await prepareAiConversation(options({ turns, stream: fake.stream, onProgress: value => progress.push(value) }));
  assert.equal(fake.requests.length, 1);
  const request = fake.requests[0];
  assert.match(request.system, /PROSEMAP_CONVERSATION_COMPACTION/);
  assert.match(request.system, /untrusted data/);
  assert.match(request.system, /latest document.*authoritative/);
  assert.match(request.prompt, /"status":"applied"/);
  assert.match(request.prompt, /"status":"discarded"/);
  assert.match(request.prompt, /"status":"proposed"/);
  for (let index = 0; index < 4; index++) assert.match(request.prompt, new RegExp(`SYNTHETIC document ${index}`));
  assert.doesNotMatch(request.prompt, /SYNTHETIC document 4/);
  assert.deepEqual(result.memory, { summary, compactedTurns: 4 });
  assert.deepEqual(result.turns, turns.slice(4));
  assert.match(result.history.messages[0].content, /\[Compressed conversation memory\]/);
  assert.equal(result.history.messages[1].content, summary);
  assert.deepEqual(result.history.messages.filter((_, index) => index > 1 && index % 2 === 1).map(message => message.content), turns.slice(4).map(item => item.output));
  assert.equal(result.history.omittedTurns, 0);
  assert.equal(result.history.includedTurns, 4);
  assert.deepEqual(progress, [{ completedBatches: 0, totalBatches: 1 }, { completedBatches: 1, totalBatches: 1 }]);
  assert.deepEqual(turns, before);
});

test('a long latest turn is summarized without resurrecting or losing earlier requirements', async () => {
  const turns = [turn(1, 'SYNTHETIC rejected option', 'discarded'), turn(2, 'SYNTHETIC long output '.repeat(1_500), 'applied')];
  const fake = recorder();
  const result = await prepareAiConversation(options({ turns, stream: fake.stream }));
  assert.equal(result.memory.compactedTurns, 2);
  assert.deepEqual(result.turns, []);
  assert.equal(result.history.messages.length, 2);
  assert.match(fake.requests[0].prompt, /SYNTHETIC rejected option/);
  assert.match(fake.requests[0].prompt, /"status":"discarded"/);
  assert.match(fake.requests[0].prompt, /SYNTHETIC long output/);
});

test('repeated compaction updates prior memory cumulatively while retaining new recent turns', async () => {
  const memory = { summary: 'SYNTHETIC OLD MEMORY: never rename the public API', compactedTurns: 9 };
  const turns = Array.from({ length: 6 }, (_, index) => turn(index));
  const before = structuredClone({ memory, turns });
  const fake = recorder('SYNTHETIC UPDATED MEMORY: preserve old constraint; new decision recorded');
  const result = await prepareAiConversation(options({ turns, memory, stream: fake.stream }));
  assert.match(fake.requests[0].prompt, /SYNTHETIC OLD MEMORY: never rename the public API/);
  assert.equal(result.memory.compactedTurns, 12);
  assert.equal(result.turns.length, 3);
  assert.deepEqual({ memory, turns }, before);
  const followUp = recorder();
  const unchanged = await prepareAiConversation(options({ turns: result.turns, memory: result.memory, stream: followUp.stream }));
  assert.equal(unchanged.didCompact, false);
  assert.equal(followUp.requests.length, 0);
  assert.deepEqual(unchanged.memory, result.memory);
});

test('summary and complete recent exchanges obey the exact supplied history character budget', async () => {
  const turns = Array.from({ length: 8 }, (_, index) => turn(index, 'SYNTHETIC output '.repeat(50)));
  const budget = 2_000;
  const fake = recorder();
  const result = await prepareAiConversation(options({ turns, budget, stream: fake.stream }));
  assert.ok(result.history.includedCharacters <= budget);
  assert.equal(result.history.includedCharacters, result.history.messages.reduce((sum, message) => sum + message.content.length, 0));
  assert.ok(result.history.messages.length <= 12);
  assert.deepEqual(result.history.messages.map(message => message.role), Array.from({ length: result.history.messages.length }, (_, index) => index % 2 ? 'assistant' : 'user'));
  assert.equal(result.history.omittedTurns, 0);
  const exact = await prepareAiConversation(options({ turns: result.turns, memory: result.memory, budget: result.history.includedCharacters, stream: async () => assert.fail('exact memory should fit') }));
  assert.equal(exact.didCompact, false);
});

test('a tighter request budget can recompress existing memory without incrementing its covered turn count', async () => {
  const memory = { summary: 'SYNTHETIC historical constraints '.repeat(100), compactedTurns: 23 };
  const before = structuredClone(memory);
  const fake = recorder();
  const result = await prepareAiConversation(options({ memory, budget: 1_500, stream: fake.stream }));
  assert.equal(result.didCompact, true);
  assert.equal(result.memory.compactedTurns, 23);
  assert.equal(result.memory.summary, summary);
  assert.match(fake.requests[0].prompt, /No new exchanges; shorten the existing memory/);
  assert.ok(result.history.includedCharacters <= 1_500);
  assert.deepEqual(memory, before);
});

test('oversized exchanges use bounded sequential fragments and merge previous batch summaries', async () => {
  const turns = [turn(1, 'SYNTHETIC large output '.repeat(10_000), 'discarded')];
  const before = structuredClone(turns);
  const requests = [];
  const result = await prepareAiConversation(options({ turns, stream: async (input, delta) => {
    requests.push(input);
    if (requests.length > 1) assert.match(input.prompt, new RegExp(`SYNTHETIC memory after batch ${requests.length - 1}`));
    assert.ok(input.prompt.length < 100_000);
    assert.ok(input.system.length < 12_000);
    delta(`SYNTHETIC memory after batch ${requests.length}`);
  } }));
  assert.ok(requests.length > 1);
  for (const request of requests) assert.match(request.prompt, /status="discarded" fragment="\d+\/4"/);
  assert.equal(result.memory.compactedTurns, 1);
  assert.equal(result.memory.summary, `SYNTHETIC memory after batch ${requests.length}`);
  assert.deepEqual(turns, before);
});

test('failed later compression batches leave all original raw exchanges and prior memory untouched', async () => {
  const turns = [turn(1, 'SYNTHETIC long fragment '.repeat(8_000))];
  const memory = { summary: 'SYNTHETIC previous accepted memory', compactedTurns: 5 };
  const before = structuredClone({ turns, memory });
  let requests = 0;
  await assert.rejects(prepareAiConversation(options({ turns, memory, stream: async (_input, delta) => {
    requests++;
    if (requests === 2) throw new Error('SYNTHETIC connection failure');
    delta('SYNTHETIC intermediate summary that must not commit');
  } })), /SYNTHETIC connection failure/);
  assert.equal(requests, 2);
  assert.deepEqual({ turns, memory }, before);
});

test('oversized Unicode exchanges keep surrogate pairs intact across summary fragments', async () => {
  const empty = turn(1, '');
  const prefix = JSON.stringify({ instruction: empty.instruction, output: '', status: empty.status });
  const outputStart = prefix.indexOf('"output":"') + '"output":"'.length;
  const output = 'x'.repeat(60_000 - outputStart - 1) + '🧭' + 'SYNTHETIC continuation';
  const input = turn(1, output);
  const chunks = [];
  await prepareAiConversation(options({ turns: [input], stream: async (request, delta) => {
    for (const match of request.prompt.matchAll(/<historical_exchange status="[^"]+" fragment="[^"]+">\n([\s\S]*?)\n<\/historical_exchange>/g)) {
      chunks.push(match[1]);
      assert.doesNotMatch(match[1], /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    delta(summary);
  } }));
  assert.equal(chunks.length, 2);
  assert.deepEqual(JSON.parse(chunks.join('')), { instruction: input.instruction, output, status: input.status });
});

test('empty or oversized summaries fail explicitly without truncation or aborting the caller', async () => {
  for (const output of ['', ' \n\t', 'X'.repeat(MAX_AI_SUMMARY_CHARACTERS + 1), 'X'.repeat(20_000)]) {
    const controller = new AbortController();
    const turns = [turn(1, 'SYNTHETIC output '.repeat(2_000))];
    const before = structuredClone(turns);
    await assert.rejects(prepareAiConversation(options({ turns, signal: controller.signal, stream: recorder(output).stream })), /压缩摘要/);
    assert.equal(controller.signal.aborted, false);
    assert.deepEqual(turns, before);
  }
});

test('cancellation and stale sessions cannot return new compressed state', async () => {
  const turns = [turn(1, 'SYNTHETIC output '.repeat(2_000))];
  const controller = new AbortController();
  await assert.rejects(prepareAiConversation(options({ turns, signal: controller.signal, stream: async (_input, delta, signal) => {
    delta('SYNTHETIC partial memory');
    controller.abort();
    assert.equal(signal.aborted, true);
    delta('SYNTHETIC late content');
  } })), { name: 'AbortError' });
  let current = true;
  await assert.rejects(prepareAiConversation(options({ turns, isCurrent: () => current, stream: async (_input, delta) => {
    delta(summary);
    current = false;
  } })), { name: 'AbortError' });
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(prepareAiConversation(options({ turns, signal: aborted.signal, stream: async () => assert.fail('aborted preparation must not call model') })), { name: 'AbortError' });
});

test('extreme input and impossible budgets fail before calling the model rather than dropping history', async () => {
  const stream = async () => assert.fail('unsafe compression must not start a model request');
  await assert.rejects(prepareAiConversation(options({ turns: [turn(1, 'X'.repeat(800_000))], stream })), /会话内容过大/);
  for (const budget of [0, NaN, 200]) {
    await assert.rejects(prepareAiConversation(options({ turns: [turn(1)], budget, stream })), /剩余上下文空间不足/);
  }
});

test('pending append never silently loses exchanges before semantic compression', () => {
  const turns = Array.from({ length: 40 }, (_, index) => turn(index, 'SYNTHETIC long output '.repeat(1_000)));
  const before = structuredClone(turns);
  const result = appendPendingAiConversationTurn(turns, turn(41));
  assert.equal(result.length, 41);
  assert.deepEqual(result.slice(0, 40), before);
  assert.deepEqual(turns, before);
  const replaced = appendPendingAiConversationTurn(result, turn(41, 'SYNTHETIC accepted replacement', 'applied'));
  assert.equal(replaced.length, 41);
  assert.equal(replaced.at(-1).status, 'applied');
});
