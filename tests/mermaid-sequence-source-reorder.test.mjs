import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMermaidVisualSource, serializeMermaidVisualGraph } from '../lib/mermaid-workbench.ts';
import { MermaidSourceHistory, preserveMermaidSource } from '../lib/mermaid-source-preservation.ts';

// Synthetic fixture: directive positions and message identities are authored
// independently of the source-preservation implementation.
const lines = [
  'sequenceDiagram',
  '  actor A as Synthetic Actor',
  '  participant B as Synthetic App',
  '  participant C as Synthetic API',
  '  A->>B: M1 request',
  '  Note over A: Synthetic note',
  '  activate B',
  '  loop Synthetic loop',
  '    B->>C: M2 query  ',
  '\t  %% SYNTHETIC comment stays in this slot',
  '    alt Synthetic success\t',
  '      C-->>B: M3 success\t',
  '    else Synthetic retry  ',
  '      C-->>B: M4 retry',
  '    end',
  '  end',
  '  deactivate B',
  '  B-->>A: M5 complete',
  '',
  '  %% SYNTHETIC final comment',
  '',
];

function reordered(graph, from, to) {
  const edges = [...graph.edges];
  [edges[from], edges[to]] = [edges[to], edges[from]];
  return { ...graph, edges };
}

function assertSemantics(actual, expected) {
  const parsed = parseMermaidVisualSource(actual);
  assert.ok(parsed);
  assert.equal(serializeMermaidVisualGraph(parsed), serializeMermaidVisualGraph(expected));
}

for (const endings of ['LF', 'CRLF', 'mixed']) {
  const source = lines.map((line, index) => line + (index === lines.length - 1 ? ''
    : endings === 'LF' ? '\n' : endings === 'CRLF' ? '\r\n' : index % 2 ? '\n' : '\r\n')).join('');
  for (const direction of ['earlier', 'later']) {
    test(`sequence reorder ${direction}: ${endings} keeps directive bytes, message-slot whitespace and exact history`, () => {
      const before = parseMermaidVisualSource(source);
      const after = reordered(before, 2, direction === 'earlier' ? 1 : 3);
      const expected = direction === 'earlier'
        ? source.replace('    B->>C: M2 query  ', '    C-->>B: M3 success  ')
          .replace('      C-->>B: M3 success\t', '      B->>C: M2 query\t')
        : source.replace('      C-->>B: M3 success\t', '      C-->>B: M4 retry\t')
          .replace('      C-->>B: M4 retry' + (endings === 'LF' || endings === 'mixed' ? '\n' : '\r\n'),
            '      C-->>B: M3 success' + (endings === 'LF' || endings === 'mixed' ? '\n' : '\r\n'));
      assertSemantics(expected, after);
      assert.equal(preserveMermaidSource(source, before, after), expected);
      const history = new MermaidSourceHistory();
      history.reset(before, source);
      assert.equal(history.commit(source, before, after), expected);
      assert.equal(history.commit(expected, after, before), source);
      assert.equal(history.commit(source, before, after), expected);
    });
  }
}

test('sequence reorder identifies equal labels by the complete message, including endpoint and type', () => {
  const source = lines.join('\n').replace('M2 query', 'Synthetic shared').replace('M3 success', 'Synthetic shared');
  const before = parseMermaidVisualSource(source);
  const after = reordered(before, 2, 1);
  const expected = source.replace('    B->>C: Synthetic shared  ', '    C-->>B: Synthetic shared  ')
    .replace('      C-->>B: Synthetic shared\t', '      B->>C: Synthetic shared\t');
  assert.equal(preserveMermaidSource(source, before, after), expected);
  assertSemantics(expected, after);
});

test('sequence reorder does not guess which identical message occurrence to move', () => {
  const source = ['sequenceDiagram', '  participant A as Synthetic A', '  participant B as Synthetic B',
    '  loop Synthetic loop', '    A->>B: Synthetic same', '    alt Synthetic branch',
    '      B-->>A: Synthetic other', '    else Synthetic alternate',
    '      A->>B: Synthetic same', '    end', '  end'].join('\r\n');
  const before = parseMermaidVisualSource(source);
  const after = reordered(before, 1, 0);
  const actual = preserveMermaidSource(source, before, after);
  assert.equal(actual, serializeMermaidVisualGraph(after), 'ambiguous raw occurrences retain the canonical fallback');
  assertSemantics(actual, after);
  const history = new MermaidSourceHistory();
  assert.equal(history.commit(source, before, after), actual);
  assert.equal(history.commit(actual, after, before), source, 'fallback still has exact undo');
});

test('swapping indistinguishable messages retains original source without normalization', () => {
  const source = ['sequenceDiagram', '\tparticipant A as Synthetic A', '\tparticipant B as Synthetic B',
    '\tloop Synthetic loop', '    A->>B: Synthetic same', '    A->>B: Synthetic same', '\tend', ''].join('\r\n');
  const before = parseMermaidVisualSource(source);
  assert.equal(preserveMermaidSource(source, before, reordered(before, 0, 1)), source);
});

test('sequence reorder keeps CR-only endings and an absent final newline', () => {
  const source = lines.slice(0, -1).join('\r');
  const before = parseMermaidVisualSource(source);
  const after = reordered(before, 2, 1);
  const expected = source.replace('    B->>C: M2 query  ', '    C-->>B: M3 success  ')
    .replace('      C-->>B: M3 success\t', '      B->>C: M2 query\t');
  assert.equal(preserveMermaidSource(source, before, after), expected);
});

test('sequence reorder combined with label and participant changes still applies every edit', () => {
  const source = lines.join('\n');
  const before = parseMermaidVisualSource(source);
  const moved = reordered(before, 2, 1);
  const after = { ...moved,
    nodes: moved.nodes.map(node => node.id === 'B' ? { ...node, label: 'Synthetic updated app' } : node),
    edges: moved.edges.map(edge => edge.id === 'edge-3' ? { ...edge, label: 'Synthetic updated reply' } : edge),
  };
  const actual = preserveMermaidSource(source, before, after);
  assertSemantics(actual, after);
  assert.ok(actual.includes('Synthetic updated app'));
  assert.ok(actual.includes('Synthetic updated reply'));
});

test('sequence reorder retains Unicode whitespace around each destination slot', () => {
  const source = 'sequenceDiagram\n  participant A as Synthetic A\n  participant B as Synthetic B\n\u00a0A->>B: First\u3000\n\u3000B-->>A: Second\u00a0';
  const before = parseMermaidVisualSource(source);
  const after = reordered(before, 0, 1);
  const expected = 'sequenceDiagram\n  participant A as Synthetic A\n  participant B as Synthetic B\n\u00a0B-->>A: Second\u3000\n\u3000A->>B: First\u00a0';
  assert.equal(preserveMermaidSource(source, before, after), expected);
});
