import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyTextEdits, createTextEditPrompts } from '../lib/ai-text-edits.ts';

const response = (...edits) => JSON.stringify({ edits });
const edit = (oldText, newText) => ({ oldText, newText });

test('a short edit response preserves every unmentioned byte in a long document', () => {
  const prefix = '# SYNTHETIC fixture\r\n\r\n' + 'Synthetic unchanged paragraph.  \r\n'.repeat(2_000);
  const middle = '## Synthetic target\r\n\r\nValue: 10 🧭\r\n';
  const suffix = '\r\n| Synthetic | table |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\n```mermaid\r\nflowchart LR\r\n A-->B\r\n```\r\n\r\nSynthetic tail.  \r\n';
  const original = prefix + middle + suffix;
  assert.equal(applyTextEdits(original, response(edit('Value: 10 🧭', 'Value: 20 🧭'))),
    prefix + middle.replace('10', '20') + suffix);
});

test('all edits refer to the same original, regardless of output order or replacement text', () => {
  assert.equal(applyTextEdits('Synthetic A / Synthetic B / Synthetic C', response(
    edit('Synthetic C', 'Synthetic A'), edit('Synthetic A', 'Synthetic C'),
  )), 'Synthetic C / Synthetic B / Synthetic A');
});

test('anchors support insertions and explicit deletions without touching neighbors', () => {
  assert.equal(applyTextEdits('Synthetic first\nSynthetic second\nSynthetic last\n', response(
    edit('Synthetic second\n', ''), edit('Synthetic last', 'Synthetic new\nSynthetic last'),
  )), 'Synthetic first\nSynthetic new\nSynthetic last\n');
  assert.equal(applyTextEdits('', response(edit('', '# Synthetic new document\n'))), '# Synthetic new document\n');
  assert.equal(applyTextEdits('Synthetic selected deletion', response(edit('Synthetic selected deletion', ''))), '');
  assert.equal(applyTextEdits('Synthetic unchanged  \n', response()), 'Synthetic unchanged  \n');
});

test('JSON fences do not affect exact whitespace, code fences, quotes or Unicode in edits', () => {
  const original = 'Synthetic "quote" 🧭\n\n```js\nconst synthetic = 1;\n```\n';
  const payload = response(edit('const synthetic = 1;', 'const synthetic = 2;'));
  assert.equal(applyTextEdits(original, '```json\n' + payload + '\n```'), original.replace('= 1;', '= 2;'));
});

test('invalid and truncated outputs never fall back to replacing the document', () => {
  for (const payload of [
    'Synthetic changed paragraph only', '{"edits":[',
    JSON.stringify([]), JSON.stringify(null), '{}', '{"edits":{}}',
    '{"edits":[],"document":"Synthetic replacement"}',
    response({ oldText: 'Synthetic', newText: 1 }),
    response({ oldText: 'Synthetic', newText: 'Changed', extra: 'ignored?' }),
    response(null), response(...Array.from({ length: 257 }, () => edit('Synthetic', 'Changed'))),
  ]) assert.throws(() => applyTextEdits('Synthetic original', payload), /局部修改格式无效/);
});

test('missing or ambiguous anchors, including overlapping occurrences, reject the entire batch', () => {
  for (const [original, oldText] of [
    ['Synthetic original', 'synthetic original'],
    ['Synthetic original', 'Synthetic reference-only text'],
    ['Synthetic original', ''],
    ['Synthetic repeat / Synthetic repeat', 'Synthetic repeat'],
    ['Synthetic aaaa', 'aa'],
  ]) assert.throws(() => applyTextEdits(original, response(edit(oldText, 'Changed'))), /无法唯一匹配原文/);
  assert.throws(() => applyTextEdits('', response(edit('', 'First'), edit('', 'Second'))), /无法唯一匹配原文/);
  assert.throws(() => applyTextEdits('Synthetic original', response(
    edit('original', 'changed'), edit('changed', 'later'),
  )), /无法唯一匹配原文/);
});

test('overlapping and duplicate ranges reject the entire batch while adjacent edits work', () => {
  const original = 'Synthetic ABCDEF';
  for (const edits of [
    [edit('ABC', '1'), edit('CDE', '2')],
    [edit('ABCDEF', '1'), edit('BCD', '2')],
    [edit('ABC', '1'), edit('ABC', '2')],
  ]) assert.throws(() => applyTextEdits(original, response(...edits)), /修改范围重叠/);
  assert.equal(applyTextEdits(original, response(edit('ABC', '1'), edit('DEF', '2'))), 'Synthetic 12');
});

test('custom prompts distinguish visible source from authorized scope and require local edits', () => {
  for (const selected of [false, true]) {
    const prompts = createTextEditPrompts('Synthetic original  \n', '只改指定标题', selected);
    assert.ok(prompts.prompt.endsWith('Synthetic original  \n'));
    assert.match(prompts.prompt, /只改指定标题/);
    assert.match(prompts.prompt, selected ? /用户选区/ : /只修改指令明确指定的部分/);
    assert.match(prompts.system, /oldText/);
    assert.match(prompts.system, /未列入 edits 的内容由应用原样保留/);
    assert.match(prompts.system, /不要删除请求范围之外/);
  }
});
