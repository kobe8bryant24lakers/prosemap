import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMermaidVisualSource, serializeMermaidVisualGraph } from '../lib/mermaid-workbench.ts';
import { insertSequenceMessage, sequenceInsertionIndex } from '../lib/sequence-insertion.ts';
import { preserveMermaidSource, MermaidSourceHistory } from '../lib/mermaid-source-preservation.ts';
import { canvasEdgeGeometries } from '../lib/canvas-edge-geometry.ts';
import { layoutMermaidGraph } from '../lib/mermaid-canvas-layout.ts';

const source = 'sequenceDiagram\n  participant A as Synthetic A\n  participant B as Synthetic B\n  A->>B: Synthetic first\n  loop Synthetic loop\n    A->>B: Synthetic second\n    %% SYNTHETIC keep\n    alt Synthetic branch\n      B-->>A: Synthetic third\n    else Synthetic fallback\n      B-->>A: Synthetic fourth\n    end\n  end\n  B-->>A: Synthetic last\n';
const edge = { id: 'new', from: 'A', to: 'B', label: 'Synthetic inserted', style: 'arrow', data: { token: '->>' } };
for (const eol of ['\n', '\r\n']) for (const slot of [0, 1, 2, 3, 4, 5]) {
  test(`sequence insertion slot ${slot} preserves source (${JSON.stringify(eol)}) and history`, () => {
    const original = source.replaceAll('\n', eol);
    const before = parseMermaidVisualSource(original);
    const after = insertSequenceMessage(before, edge, slot);
    const target = ['  A->>B: Synthetic first', '    A->>B: Synthetic second', '      B-->>A: Synthetic third', '      B-->>A: Synthetic fourth', '  B-->>A: Synthetic last'][slot];
    const expected = target ? original.replace(target, target.match(/^\s*/)[0] + 'A->>B: Synthetic inserted' + eol + target) : original + '  A->>B: Synthetic inserted' + eol;
    assert.equal(preserveMermaidSource(original, before, after), expected);
    assert.equal(serializeMermaidVisualGraph(parseMermaidVisualSource(expected)), serializeMermaidVisualGraph(after));
    const history = new MermaidSourceHistory();
    assert.equal(history.commit(original, before, after), expected);
    assert.equal(history.commit(expected, after, before), original);
  });
}
test('sequence insertion follows rendered geometry including compressed rows', () => {
  const graph = parseMermaidVisualSource(source);
  const layout = layoutMermaidGraph(graph);
  const geometry = canvasEdgeGeometries(graph, layout.positions, layout.routes, 400);
  const rows = graph.edges.map(edge => geometry.get(edge.id).label.y + 10);
  assert.equal(sequenceInsertionIndex(graph, geometry, rows[0] - 10), 0);
  for (let i = 1; i < rows.length; i++) assert.equal(sequenceInsertionIndex(graph, geometry, (rows[i - 1] + rows[i]) / 2), i);
  assert.equal(sequenceInsertionIndex(graph, geometry, rows.at(-1) + 10), rows.length);
});
test('insert after message reorder materializes current slots without moving directives', () => {
  const graph = parseMermaidVisualSource(source);
  [graph.edges[1], graph.edges[2]] = [graph.edges[2], graph.edges[1]];
  const after = insertSequenceMessage(graph, edge, 2);
  const serialized = serializeMermaidVisualGraph(after);
  assert.ok(serialized.indexOf('Synthetic third') < serialized.indexOf('Synthetic branch'));
  assert.ok(serialized.indexOf('Synthetic inserted') > serialized.indexOf('Synthetic branch'));
  assert.deepEqual(parseMermaidVisualSource(serialized).edges.map(edge => edge.label), after.edges.map(edge => edge.label));
});

test('insert after deleting a message does not revive its slot or duplicate IDs', () => {
  const graph = parseMermaidVisualSource(source);
  graph.edges.splice(1, 1);
  const after = insertSequenceMessage(graph, edge, 1);
  const serialized = serializeMermaidVisualGraph(after);
  assert.deepEqual(parseMermaidVisualSource(serialized).edges.map(edge => edge.label), after.edges.map(edge => edge.label));
  assert.equal(after.data.sequenceItems.filter(item => item.kind === 'message').length, after.edges.length);
});

test('duplicate messages, self messages and no final newline retain exact old source', () => {
  const source = 'sequenceDiagram\n\tA->>A: Synthetic duplicate\n\tA->>A: Synthetic duplicate';
  const graph = parseMermaidVisualSource(source);
  const edge = { id: 'new', from: 'A', to: 'A', label: 'Synthetic self', style: 'arrow', data: { token: '->>' } };
  const after = insertSequenceMessage(graph, edge, 1);
  assert.equal(preserveMermaidSource(source, graph, after), 'sequenceDiagram\n\tA->>A: Synthetic duplicate\n\tA->>A: Synthetic self\n\tA->>A: Synthetic duplicate');
});

test('an empty timeline can create its first message', () => {
  const source = 'sequenceDiagram\n  participant A as Synthetic A\n  participant B as Synthetic B';
  const graph = parseMermaidVisualSource(source);
  assert.equal(sequenceInsertionIndex(graph, new Map(), 200), 0);
  const after = insertSequenceMessage(graph, edge, 0);
  assert.equal(preserveMermaidSource(source, graph, after), source + '\n  A->>B: Synthetic inserted');
});
