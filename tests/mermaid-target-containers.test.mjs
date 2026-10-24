import assert from 'node:assert/strict';
import test from 'node:test';
import { findMermaidTarget, formatMermaidFence } from '../lib/editor.ts';

for (const ending of ['\n', '\r\n']) {
  for (const { name, opener, prefix } of [
    { name: 'blockquote', opener: '> ```mermaid', prefix: '> ' },
    { name: 'ordered list', opener: '1. ```mermaid', prefix: '   ' },
    { name: 'nested blockquote', opener: '> > ```mermaid', prefix: '> > ' },
    { name: 'list inside blockquote', opener: '> 1. ```mermaid', prefix: '>    ' },
  ]) {
    test(`cursor identifies ${name} Mermaid and preserves ${ending === '\n' ? 'LF' : 'CRLF'} container on apply`, () => {
      const source = ['flowchart LR', '  A[原始] --> B[结果]'].join(ending);
      const markdown = ['Before', '', opener, `${prefix}flowchart LR`, `${prefix}  A[原始] --> B[结果]`, `${prefix}\`\`\``, '', 'After'].join(ending);
      const from = markdown.indexOf('```mermaid');
      const to = markdown.indexOf('```', from + 3) + 3;
      const target = findMermaidTarget(markdown, markdown.indexOf('原始') + 1);
      assert.ok(target);
      assert.deepEqual(target, { from, to, source, fenced: markdown.slice(from, to), linePrefix: prefix, lineEnding: ending, contentPrefixes: [prefix, prefix] });
      const replacement = formatMermaidFence('flowchart LR\n  A[更新] --> C[保留容器]', target);
      const updated = markdown.slice(0, from) + replacement + markdown.slice(to);
      const expected = ['Before', '', opener, `${prefix}flowchart LR`, `${prefix}  A[更新] --> C[保留容器]`, `${prefix}\`\`\``, '', 'After'].join(ending);
      assert.equal(updated, expected);
      assert.equal(findMermaidTarget(markdown, markdown.indexOf('Before')), null);
      assert.equal(findMermaidTarget(markdown, markdown.indexOf('After') + 1), null);
      if (ending === '\r\n') assert.equal(updated.replaceAll('\r\n', '').includes('\n'), false);
    });
  }
}

test('identical container diagrams are selected by cursor and leave the first diagram untouched', () => {
  const block = '> ```mermaid\n> flowchart LR\n>   A[Same] --> B[Same]\n> ```';
  const markdown = `Before\n\n${block}\n\nBetween\n\n${block}\n\nAfter`;
  const first = markdown.indexOf('Same');
  const second = markdown.indexOf('Same', markdown.indexOf('Between'));
  const a = findMermaidTarget(markdown, first);
  const b = findMermaidTarget(markdown, second);
  assert.ok(a && b);
  assert.notEqual(a.from, b.from);
  assert.equal(a.source, b.source);
  const replacement = formatMermaidFence('flowchart TD\n  A[Only second] --> B', b);
  const updated = markdown.slice(0, b.from) + replacement + markdown.slice(b.to);
  assert.equal(updated.slice(0, b.from), markdown.slice(0, b.from));
  assert.ok(updated.includes(block));
  assert.equal(findMermaidTarget(markdown, markdown.indexOf('Between')), null);
});

test('Mermaid-looking text inside another code fence or inline code is not an editable diagram', () => {
  const markdown = [
    '````text',
    '```mermaid',
    'flowchart LR',
    '  Fake --> Diagram',
    '```',
    '````',
    '',
    '`literal ```mermaid`',
    '',
    '> ```text',
    '> mermaid',
    '> flowchart LR',
    '> ```',
    '',
    '```mermaid',
    'flowchart LR',
    '  Real --> Diagram',
    '```',
  ].join('\n');
  assert.equal(findMermaidTarget(markdown, markdown.indexOf('Fake')), null);
  assert.equal(findMermaidTarget(markdown, markdown.indexOf('literal')), null);
  assert.equal(findMermaidTarget(markdown, markdown.indexOf('> mermaid') + 3), null);
  assert.ok(findMermaidTarget(markdown, markdown.indexOf('Real')));
});

test('indented code containing Mermaid fences is not a diagram', () => {
  const markdown = '    ```mermaid\n    flowchart LR\n      A --> B\n    ```\n';
  assert.equal(findMermaidTarget(markdown, markdown.indexOf('A --> B')), null);
});

test('blank quoted lines and a longer closing fence preserve source and exact replacement range', () => {
  const markdown = '> ````mermaid\n>\n> flowchart LR\n>\n>   A --> B\n>\n> `````\n\nAfter';
  const target = findMermaidTarget(markdown, markdown.indexOf('A --> B'));
  assert.ok(target);
  assert.equal(target.source, '\nflowchart LR\n\n  A --> B\n');
  assert.equal(target.linePrefix, '> ');
  assert.equal(target.fenced, markdown.slice(2, markdown.indexOf('\n\nAfter')));
  assert.equal(findMermaidTarget(markdown, target.from)?.from, target.from);
  assert.equal(findMermaidTarget(markdown, target.to)?.to, target.to);
});

test('tilde Mermaid fences are recognized while incomplete fences stay unselected', () => {
  const markdown = 'Before\n\n> ~~~mermaid\n> flowchart LR\n>   A --> B\n> ~~~\n\nAfter';
  const target = findMermaidTarget(markdown, markdown.indexOf('A --> B'));
  assert.ok(target);
  assert.equal(target.source, 'flowchart LR\n  A --> B');
  assert.equal(target.linePrefix, '> ');
  for (const incomplete of ['```mermaid\nflowchart LR\nA-->B', '> ```mermaid\n> flowchart LR\n> A-->B']) {
    assert.equal(findMermaidTarget(incomplete, incomplete.indexOf('A-->B')), null);
  }
  for (const position of [-1, 1.5, NaN, markdown.length + 1]) assert.equal(findMermaidTarget(markdown, position), null);
});
