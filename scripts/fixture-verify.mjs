// Read-only fixture and Markdown-pipeline checks; does not render Mermaid or access the network.
// node --experimental-strip-types scripts/fixture-verify.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { createMermaidTarget, findMermaidTarget, formatMermaidFence } from '../lib/editor.ts';
import { previewHeadingIds } from '../lib/preview-links.ts';
import { previewHtmlSanitize } from '../lib/preview-html.ts';
import { previewLineBreaks } from '../lib/markdown-preview.ts';
import { relativeFileLinks } from '../lib/relative-file-links.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
for (const entry of manifest.files) {
  const data = readFileSync(resolve(root, entry.path));
  assert.equal(data.length, entry.bytes, `${entry.path}: size changed`);
  assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256, `${entry.path}: hash changed`);
}

const markdown = readFileSync(resolve(root, 'full-coverage.md'), 'utf8');
const html = renderToStaticMarkup(createElement(ReactMarkdown, {
  remarkPlugins: [remarkGfm, relativeFileLinks, previewLineBreaks],
  rehypePlugins: [rehypeRaw, previewHtmlSanitize, previewHeadingIds],
}, markdown));
assert.equal([...html.matchAll(/class="language-mermaid"/g)].length, 11);
for (const id of ['重复标题', '重复标题-1', '特殊--标题--emoji-', '文档尾部']) {
  assert.ok(html.includes(`id="${id}"`), `missing heading ID ${id}`);
}
assert.ok(html.includes('data-footnotes'), 'footnotes missing');
assert.ok(html.includes('type="checkbox"'), 'task list missing');
assert.ok(html.includes('<table>'), 'table missing');
assert.ok(['left', 'center', 'right'].every((align) => html.includes(`style="text-align:${align}"`)), 'table alignment missing');
assert.ok(html.includes('<details>') && html.includes('<summary>'), 'safe HTML missing');
assert.ok(!/<script(?:\s|>)/i.test(html), 'script survived sanitization');
assert.ok(!/\s(?:onclick|onerror)=/i.test(html), 'event handler survived sanitization');
assert.ok(!/style="[^"]*position/i.test(html), 'position style survived sanitization');
assert.ok(html.includes('color:#0a6640;background-color:#edf6f0'), 'safe colors missing');
assert.ok(html.includes('$E = mc^2$'), 'math observation text changed');

const relativeLinks = [...html.matchAll(/<(?:a|img)\b[^>]*?(?:href|src)="([^"#][^"]*)"/g)]
  .map((match) => match[1]).filter((url) => url.startsWith('./'));
let presentResources = 0;
let intentionalMissing = 0;
for (const url of relativeLinks) {
  const path = decodeURIComponent(url).replaceAll('&amp;', '&');
  if (/does-not-exist\.csv|missing-image\.png/.test(path)) {
    assert.equal(existsSync(resolve(root, path)), false, `${path}: should remain missing`);
    intentionalMissing++;
  } else {
    assert.ok(existsSync(resolve(root, path)), `${path}: expected local resource is missing`);
    presentResources++;
  }
}
assert.ok(presentResources >= 7 && intentionalMissing === 2, 'relative resources were not all recognized');

for (const ending of ['lf', 'crlf']) {
  const text = readFileSync(resolve(root, `targeting-${ending}.md`), 'utf8');
  const positions = [...text.matchAll(/```mermaid/g)].map((match) => match.index);
  assert.equal(positions.length, 4);
  const second = findMermaidTarget(text, positions[1] + 12);
  assert.ok(second);
  assert.equal(second.from, positions[1]);
  const replacement = formatMermaidFence('flowchart LR\n  A[只改第二张] --> B[保留其他]', second);
  const updated = text.slice(0, second.from) + replacement + text.slice(second.to);
  assert.equal(updated.slice(0, second.from), text.slice(0, second.from));
  assert.equal(updated.slice(second.from + replacement.length), text.slice(second.to));
  if (ending === 'crlf') assert.equal(updated.replaceAll('\r\n', '').includes('\n'), false);
  for (const [index, prefix] of [[2, '> '], [3, '   ']]) {
    const from = positions[index];
    const to = text.indexOf('```', from + 3) + 3;
    const target = createMermaidTarget(text, from, to, 'flowchart LR\n  A[相同节点] --> B[相同结果]');
    assert.ok(target, `${ending}: container target ${index}`);
    assert.equal(target.linePrefix, prefix);
  }
}

const long = readFileSync(resolve(root, 'long-document-600-sections.md'), 'utf8');
assert.equal([...long.matchAll(/^## 长文段落 /gm)].length, 600);
assert.equal([...long.matchAll(/定位标记 SECTION-\d{4}/g)].length, 600);
assert.ok(long.split('\n').length > 6000 && long.endsWith('END-OF-LONG-DOCUMENT\n'));
assert.equal(readFileSync(resolve(root, 'empty-document.md')).length, 0);
console.log(JSON.stringify({ manifestHashes: manifest.files.length, markdownMermaidBlocks: 11, relativeResourceReferences: presentResources, intentionalMissingReferences: intentionalMissing, targetLineEndings: 2, longDocumentLines: long.split('\n').length, mermaidRendering: 'not-run', nativeInteraction: 'not-run' }));
