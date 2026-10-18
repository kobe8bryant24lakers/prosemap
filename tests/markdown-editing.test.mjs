import assert from 'node:assert/strict';
import test from 'node:test';
import { inlineMarkdownEdit, lineMarkdownEdit } from '../lib/markdown-editing.ts';
const apply = (doc, edit) => doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);

test('inline toolbar toggles formatting with the retained inner selection', () => {
  let doc = '前文 hello 后文';
  const bold = inlineMarkdownEdit(doc, 3, 8, '**');
  doc = apply(doc, bold);
  assert.equal(doc, '前文 **hello** 后文');
  const plain = inlineMarkdownEdit(doc, bold.anchor, bold.head, '**');
  assert.equal(apply(doc, plain), '前文 hello 后文');
  assert.equal(apply('**中文**', inlineMarkdownEdit('**中文**', 6, 0, '**')), '中文');
});

test('empty caret receives a selected placeholder and no surrounding text is lost', () => {
  const edit = inlineMarkdownEdit('ab', 1, 1, '*', '*', '文字');
  assert.equal(apply('ab', edit), 'a*文字*b');
  assert.equal(apply('ab', edit).slice(edit.anchor, edit.head), '文字');
});

test('list formatting covers full lines, preserves nesting, excludes trailing line', () => {
  const doc = 'alpha\n  beta\ngamma';
  const edit = lineMarkdownEdit(doc, 2, 13, 'list');
  assert.equal(apply(doc, edit), '- alpha\n  - beta\ngamma');
  const next = apply(doc, edit);
  assert.equal(apply(next, lineMarkdownEdit(next, edit.anchor, edit.head, 'list')), doc);
});

test('headings replace existing level, toggle off and do not split a line at caret', () => {
  assert.equal(apply('### title', lineMarkdownEdit('### title', 7, 7, 'heading')), '## title');
  assert.equal(apply('## title', lineMarkdownEdit('## title', 5, 5, 'heading')), 'title');
  assert.equal(apply('some text', lineMarkdownEdit('some text', 4, 4, 'heading')), '## some text');
});

test('mixed numbered lists become tasks and blank lines remain blank', () => {
  const doc = '1. first\n\n  - second';
  assert.equal(apply(doc, lineMarkdownEdit(doc, 0, doc.length, 'task')), '- [ ] first\n\n  - [ ] second');
});

test('italic nests inside bold instead of removing half of the bold markers', () => {
  const edit = inlineMarkdownEdit('**hello**', 2, 7, '*');
  assert.equal(apply('**hello**', edit), '***hello***');
  assert.equal(apply('***hello***', inlineMarkdownEdit('***hello***', edit.anchor, edit.head, '*')), '**hello**');
});

test('formatting the first empty line selects the placeholder without consuming the next line', () => {
  const edit = lineMarkdownEdit('\nnext', 0, 0, 'heading', '标题');
  const result = apply('\nnext', edit);
  assert.equal(result, '## 标题\nnext');
  assert.equal(result.slice(edit.anchor, edit.head), '标题');
});
