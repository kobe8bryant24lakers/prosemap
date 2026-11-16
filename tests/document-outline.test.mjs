import assert from 'node:assert/strict';
import test from 'node:test';
import { documentOutline, activeOutlineHeading } from '../lib/document-outline.ts';

test('synthetic outline follows Markdown structure, skipping code and supporting skipped levels', () => {
  const source = '# Synthetic **root**\n\n```md\n# Not a heading\n```\n\n### Child [link](https://example.com)\n\nSibling\n-------\n\n> #### Nested `code`\n\n# Synthetic **root**\n';
  const outline = documentOutline(source);
  assert.equal(outline.length, 2);
  assert.deepEqual(outline.map(({ id, title, line }) => ({ id, title, line })), [
    { id: 'synthetic-root', title: 'Synthetic root', line: 1 },
    { id: 'synthetic-root-1', title: 'Synthetic root', line: 14 },
  ]);
  assert.deepEqual(outline[0].children.map(h => [h.title, h.level, h.line]), [['Child link', 3, 7], ['Sibling', 2, 9]]);
  assert.equal(outline[0].children[1].children[0].title, 'Nested code');
  assert.equal(activeOutlineHeading(outline, 12), 'nested-code');
  assert.equal(activeOutlineHeading(outline, 0), null);
});

test('synthetic HTML headings and rich labels match sanitized preview IDs', () => {
  const outline = documentOutline('<h2 id="forged">HTML &amp; 中文<br>title</h2>\n\n# ![Alt](synthetic.png) `code`\n\n#\n\n#\n\n<script><h1>Unsafe</h1></script>');
  assert.deepEqual(outline.map(h => h.title), ['HTML & 中文 title', 'Alt code', '', '']);
  assert.equal(outline[0].id, 'html--中文title');
  assert.deepEqual(outline.slice(2).map(h => h.id), ['', '-1']);
});

test('synthetic CRLF source has correct heading lines and empty documents have no headings', () => {
  assert.deepEqual(documentOutline(''), []);
  assert.deepEqual(documentOutline('Plain text\n\n    # Code'), []);
  assert.equal(documentOutline('Text\r\n\r\n## Heading')[0].line, 3);
});


test('synthetic local attachment labels use the same link recovery as preview', () => {
  const [heading] = documentOutline('## [Synthetic report](./synthetic report.csv)');
  assert.equal(heading.title, 'Synthetic report');
  assert.equal(heading.id, 'synthetic-report');
});
