import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { compactJsonPreviewIndentation, previewLineBreaks } from '../lib/markdown-preview.ts';

const renderPreview = (markdown) => renderToStaticMarkup(createElement(
  ReactMarkdown, { remarkPlugins: [remarkGfm, previewLineBreaks] }, markdown,
));

test('preview preserves single line endings including Windows line endings', () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    assert.equal(renderPreview(`第一行${ending}第二行`), '<p>第一行<br/>\n第二行</p>');
  }
});

test('preview preserves breaks inside formatted text, list items and quotes', () => {
  assert.equal(renderPreview('**第一行\n第二行**'), '<p><strong>第一行<br/>\n第二行</strong></p>');
  assert.equal(renderPreview('- 第一行\n  第二行'), '<ul>\n<li>第一行<br/>\n第二行</li>\n</ul>');
  assert.equal(renderPreview('> 第一行\n> 第二行'), '<blockquote>\n<p>第一行<br/>\n第二行</p>\n</blockquote>');
});

test('preview keeps paragraph boundaries and existing hard breaks', () => {
  assert.equal(renderPreview('第一段\n\n第二段'), '<p>第一段</p>\n<p>第二段</p>');
  for (const suffix of ['  ', '\\']) {
    assert.equal(renderPreview(`第一行${suffix}\n第二行`), '<p>第一行<br/>\n第二行</p>');
  }
});

test('preview leaves code and Mermaid contents unchanged', () => {
  for (const language of ['text', 'mermaid', 'json']) {
    assert.equal(renderPreview(`\`\`\`${language}\nfirst\nsecond\n\`\`\``),
      `<pre><code class="language-${language}">first\nsecond\n</code></pre>`);
  }
  assert.equal(renderPreview('`first\nsecond`'), '<p><code>first second</code></p>');
});

test('JSON preview compacts common four-space indentation to two spaces', () => {
  const source = [
    '{',
    '    "nested": {',
    '        "items": [',
    '            1',
    '        ]',
    '    }',
    '}',
  ].join('\n');
  const expected = [
    '{',
    '  "nested": {',
    '    "items": [',
    '      1',
    '    ]',
    '  }',
    '}',
  ].join('\n');

  assert.equal(compactJsonPreviewIndentation(source), expected);
});

test('JSON preview preserves two-space indentation and exact value syntax', () => {
  const source = [
    '{',
    '  "id": 9007199254740993,',
    '  "id": 1e3',
    '}',
    '',
  ].join('\r\n');

  assert.equal(compactJsonPreviewIndentation(source), source);
});

test('JSON preview displays tab indentation as two spaces', () => {
  const source = '{\n\t"nested": {\n\t\t"ready": true\n\t}\n}';
  const expected = '{\n  "nested": {\n    "ready": true\n  }\n}';

  assert.equal(compactJsonPreviewIndentation(source), expected);
});

test('JSON preview keeps equivalent tab and two-space indentation aligned', () => {
  const source = '{\n\t"fromTab": true,\n  "fromSpaces": true\n}';
  const expected = '{\n  "fromTab": true,\n  "fromSpaces": true\n}';

  assert.equal(compactJsonPreviewIndentation(source), expected);
});

test('invalid JSON preview remains byte-for-byte unchanged', () => {
  const source = '{\n    // JSONC stays untouched\n    "ready": true,\n}';

  assert.equal(compactJsonPreviewIndentation(source), source);
});
