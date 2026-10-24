import assert from 'node:assert/strict';
import test from 'node:test';
import { createMermaidTarget, findMermaidTarget, formatMermaidFence } from '../lib/editor.ts';
import { parseMermaidVisualSource } from '../lib/mermaid-workbench.ts';

const cases = [
  { name: 'tilde fences, info case and long closing fence', text: '~~~MeRmAiD extra-info\n\n  flowchart LR\n    A[入口] --> B[结果]\n\n~~~~~  ' },
  { name: 'backticks and indented first source line', text: '````mermaid\n  flowchart LR\n    A[入口] --> B[结果]\n`````' },
  { name: 'nested quotation with differently spaced blank prefixes', text: '> > ~~~Mermaid\n> >\n> >   flowchart LR\n> >     A[入口] --> B[结果]\n> > \n> > ~~~~' },
  { name: 'list in quote with CRLF', text: '> 1. ````MERMAID\r\n>    \r\n>      flowchart LR\r\n>        A[入口] --> B[结果]\r\n>    \r\n>    `````' },
  { name: 'standalone fence indentation', text: '  ~~~mermaid\n    flowchart LR\n      A[入口] --> B[结果]\n  ~~~~' },
  { name: 'mixed line endings and whitespace', text: '~~~mermaid\r\n\n  flowchart LR\r\n    A[入口] --> B[结果]\n\n~~~~' },
];

for (const entry of cases) {
  test(`${entry.name}: no-op and localized label edit retain all surrounding fence bytes`, () => {
    const markdown = `Before\n\n${entry.text}\n\nAfter`;
    const target = findMermaidTarget(markdown, markdown.indexOf('入口'));
    assert.ok(target);
    assert.equal(formatMermaidFence(target.source, target), target.fenced);
    const updated = markdown.slice(0, target.from)
      + formatMermaidFence(target.source.replace('入口', '改名🧭'), target)
      + markdown.slice(target.to);
    assert.equal(updated, markdown.replace('入口', '改名🧭'));
    // Preview parsers may trim code-edge whitespace or normalize line endings.
    // Both entry points must recover the same source from the document bytes.
    const preview = createMermaidTarget(markdown, target.from, target.to, target.source.trim().replace(/\r\n?/g, '\n'));
    assert.deepEqual(preview, target);
  });
}

test('source edits can deliberately add/remove blank lines without changing the original fence', () => {
  const markdown = '> ~~~~Mermaid\n>\n> flowchart LR\n>   A-->B\n> \n> ~~~~~';
  const target = findMermaidTarget(markdown, markdown.indexOf('A-->B'));
  assert.ok(target);
  assert.equal(target.source, '\nflowchart LR\n  A-->B\n');
  assert.equal(formatMermaidFence('flowchart LR\n  A-->B', target), '~~~~Mermaid\n> flowchart LR\n>   A-->B\n> ~~~~~');
  assert.equal(formatMermaidFence('\nflowchart LR\n  A-->B\n\n', target), '~~~~Mermaid\n>\n> flowchart LR\n>   A-->B\n> \n> \n> ~~~~~');
});

test('inserted and removed source lines retain container syntax and unchanged line endings', () => {
  const markdown = '> ~~~mermaid\r\n> flowchart LR\n>   A-->B\r\n>   B-->C\n> ~~~~';
  const target = findMermaidTarget(markdown, markdown.indexOf('A-->B'));
  assert.ok(target);
  const source = target.source.replace('  A-->B', '  A-->B\n  A-->C').replace(/\r?\n  B-->C/, '');
  const result = formatMermaidFence(source, target);
  assert.equal(result, '~~~mermaid\r\n> flowchart LR\n>   A-->B\r\n>   A-->C\n> ~~~~');
  assert.equal(findMermaidTarget('> ' + result, result.indexOf('A-->C'))?.source.replaceAll('\r\n', '\n'), 'flowchart LR\n  A-->B\n  A-->C');
});

test('new diagrams retain the default canonical fence', () => {
  assert.equal(formatMermaidFence('\nflowchart LR\n  A-->B\n'), '```mermaid\nflowchart LR\n  A-->B\n```');
});

for (const [name, markdown, expectedPrefixes] of [
  ['closing fence indentation', '```mermaid\nmindmap\n  root((Root))\n    Child\n      Grandchild\n   ```', ['', '', '', '']],
  ['per-line quotation indentation', '> ```mermaid\n> mindmap\n>   root((Root))\n >     Child\n>       Grandchild\n> ```', ['> ', '> ', ' > ', '> ']],
]) {
  test(`${name}: AST prefixes retain valid mindmap hierarchy and exact edit bytes`, () => {
    const expectedSource = 'mindmap\n  root((Root))\n    Child\n      Grandchild';
    const target = findMermaidTarget(markdown, markdown.indexOf('Child'));
    assert.ok(target);
    assert.equal(target.source, expectedSource);
    assert.deepEqual(target.contentPrefixes, expectedPrefixes);
    const graph = parseMermaidVisualSource(target.source);
    assert.ok(graph, 'the valid original mindmap must stay visually editable');
    assert.equal(graph.nodes.length, 3);
    assert.deepEqual(createMermaidTarget(markdown, target.from, target.to, expectedSource.trim()), target);
    assert.equal(formatMermaidFence(target.source, target), target.fenced);
    const updated = markdown.slice(0, target.from) + formatMermaidFence(target.source.replace('Child', 'Updated'), target) + markdown.slice(target.to);
    assert.equal(updated, markdown.replace('Child', 'Updated'));
    const updatedTarget = findMermaidTarget(updated, updated.indexOf('Updated'));
    assert.ok(updatedTarget);
    assert.equal(updatedTarget.source, expectedSource.replace('Child', 'Updated'));
    assert.ok(parseMermaidVisualSource(updatedTarget.source));
  });
}
