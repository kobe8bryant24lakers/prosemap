import assert from 'node:assert/strict';
import test from 'node:test';
import { findCodeBlock, formatCode, highlightCode } from '../lib/code-blocks.ts';
import { headingSlug, isExternalPreviewLink, previewHeadingIds } from '../lib/preview-links.ts';

test('formatting preserves exact JSON numeric tokens, duplicate keys and escaped strings', async () => {
  const formatted = await formatCode('{"id":9007199254740993,"id":1e3,"name":"a\\nb"}', 'json');
  assert.match(formatted, /9007199254740993/);
  assert.match(formatted, /1e3/);
  assert.equal((formatted.match(/"id"/g) ?? []).length, 2);
  assert.match(formatted, /\n  "name"/);
});
test('code edits leave fences and surrounding prose intact', async () => {
  for (const fence of ['```', '~~~~']) {
    const doc = `Before\n\n${fence}json\n{"ok":true}\n${fence}\n\nAfter`;
    const block = findCodeBlock(doc, doc.indexOf('"ok"'));
    assert.ok(block);
    const edited = doc.slice(0, block.from) + await formatCode(block.source, block.language) + doc.slice(block.to);
    assert.ok(edited.startsWith(`Before\n\n${fence}json\n`));
    assert.ok(edited.endsWith(`\n${fence}\n\nAfter`));
    assert.equal(findCodeBlock(doc, 0), null);
  }
});
test('invalid JSON and unsupported formatters reject without replacing source', async () => {
  await assert.rejects(formatCode('{"ready":}', 'json'));
  await assert.rejects(formatCode('print(1)', 'python'));
  assert.match(await formatCode('{// comment\n"ready":true,}', 'jsonc'), /\/\/ comment/);
  assert.match(await formatCode('const x={ready:true}', 'ts'), /const x =/);
});
test('highlighter retains source and distinguishes JSON properties, strings and literals', async () => {
  const source = '{"name":"ProseMap","ready":true,"count":3}';
  const tokens = await highlightCode(source, 'json');
  assert.equal(tokens.map(token => token.text).join(''), source);
  for (const kind of ['propertyName', 'string', 'bool', 'number']) assert.ok(tokens.some(token => token.className.includes(kind)), kind);
  assert.deepEqual(await highlightCode('hello', 'unknown-lang'), [{ text: 'hello', className: '' }]);
});
test('links permit web and mail schemes, with deterministic duplicate heading IDs', () => {
  for (const href of ['https://example.com', 'http://localhost', 'mailto:a@example.com']) assert.equal(isExternalPreviewLink(href), true);
  for (const href of ['javascript:alert(1)', 'file:///tmp/a', 'data:text/html,a', 'relative.md']) assert.equal(isExternalPreviewLink(href), false);
  assert.equal(headingSlug('Hello 世界!'), 'hello-世界');
  const tree = { type: 'root', children: ['Hello', 'Hello', 'Hello-1', 'Hello'].map(value => ({ type: 'element', tagName: 'h2', properties: {}, children: [{ type: 'text', value }] })) };
  previewHeadingIds()(tree);
  assert.deepEqual(tree.children.map(node => node.properties.id), ['hello', 'hello-1', 'hello-1-1', 'hello-2']);
  previewHeadingIds()(tree);
  assert.equal(tree.children[0].properties.id, 'hello');
});

test('formatting does not rewrite list or blockquote container prefixes', () => {
  for (const doc of ['> ```json\n> {"ok":true}\n> ```', '- item\n\n  ```json\n  {"ok":true}\n  ```']) {
    assert.equal(findCodeBlock(doc, doc.indexOf('"ok"')), null);
  }
});
