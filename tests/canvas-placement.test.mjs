import assert from 'node:assert/strict';
import test from 'node:test';
import { placeCanvasCopies } from '../lib/canvas-placement.ts';
import { MERMAID_TEMPLATES, parseMermaidVisualSource } from '../lib/mermaid-workbench.ts';
import { expandedMermaidCanvasStage, layoutMermaidGraph, mermaidCanvasNodeSize } from '../lib/mermaid-canvas-layout.ts';

const node = (id, data) => ({ id, label: id, shape: 'rectangle', data });

function assertCopiesClearOfOriginals(graph, positions, copies, next) {
  for (const copy of copies) {
    const position = next[copy.node.id], size = mermaidCanvasNodeSize(copy.node, graph.kind);
    assert.ok(position.x >= 18 && position.y >= 18);
    for (const original of graph.nodes) {
      const other = positions[original.id], otherSize = mermaidCanvasNodeSize(original, graph.kind);
      assert.ok(position.x + size.width + 24 <= other.x || position.x >= other.x + otherSize.width + 24
        || (graph.kind !== 'sequence' && (position.y + size.height + 24 <= other.y || position.y >= other.y + otherSize.height + 24)),
      `${graph.kind}: ${copy.node.id} overlaps ${original.id}`);
    }
  }
}

test('all template kinds duplicate into free space without disturbing originals', () => {
  for (const template of MERMAID_TEMPLATES) {
    const graph = parseMermaidVisualSource(template.source);
    const layout = layoutMermaidGraph(graph);
    const source = graph.nodes.find((entry) => !entry.data?.stateRole || entry.data.stateRole === 'state');
    const copies = [{ node: { ...source, id: 'Duplicate' }, sourceId: source.id }];
    const originalPositions = structuredClone(layout.positions);
    const next = placeCanvasCopies(graph, layout.positions, copies);
    assertCopiesClearOfOriginals(graph, layout.positions, copies, next);
    assert.deepEqual({ ...layout.positions }, originalPositions, template.id);
    for (const original of graph.nodes) assert.deepEqual(next[original.id], originalPositions[original.id], template.id);
  }
});

test('multi-object duplication retains relative spacing and avoids every existing object', () => {
  const graph = { kind: 'class', direction: 'LR', nodes: [node('A'), node('B'), node('C')], edges: [] };
  const positions = { A: { x: 30, y: 30 }, B: { x: 320, y: 140 }, C: { x: 700, y: 30 } };
  const copies = ['A', 'B'].map((sourceId) => ({ node: node(`${sourceId}2`), sourceId }));
  const next = placeCanvasCopies(graph, positions, copies);
  assert.equal(next.B2.x - next.A2.x, positions.B.x - positions.A.x);
  assert.equal(next.B2.y - next.A2.y, positions.B.y - positions.A.y);
  assertCopiesClearOfOriginals(graph, positions, copies, next);
});

test('repeated duplication near a stage edge expands rather than clamping onto the source', () => {
  let graph = { kind: 'flowchart', direction: 'LR', nodes: [node('N0')], edges: [] };
  let positions = { N0: { x: 1246, y: 690 } };
  for (let index = 1; index <= 20; index++) {
    const copy = { node: node(`N${index}`), sourceId: `N${index - 1}` };
    const next = placeCanvasCopies(graph, positions, [copy]);
    assertCopiesClearOfOriginals(graph, positions, [copy], next);
    graph = { ...graph, nodes: [...graph.nodes, copy.node] };
    positions = next;
  }
  const stage = expandedMermaidCanvasStage(graph, positions, { width: 1440, height: 780 });
  assert.ok(stage.width > 1440 || stage.height > 780);
  for (const item of graph.nodes) {
    const size = mermaidCanvasNodeSize(item, graph.kind);
    assert.ok(positions[item.id].x + size.width <= stage.width);
    assert.ok(positions[item.id].y + size.height <= stage.height);
  }
});

test('sequence duplicates stay on the participant row and respect resized widths', () => {
  const graph = { kind: 'sequence', direction: 'LR', nodes: [node('A', { canvasWidth: 500 }), node('B')], edges: [] };
  const positions = { A: { x: 100, y: 58 }, B: { x: 700, y: 58 } };
  const copies = [{ node: node('A2', { canvasWidth: 500 }), sourceId: 'A' }];
  const next = placeCanvasCopies(graph, positions, copies);
  assert.equal(next.A2.y, 58);
  assertCopiesClearOfOriginals(graph, positions, copies, next);
});

test('placement supports prototype-like IDs without mutating the supplied record', () => {
  const graph = { kind: 'er', direction: 'LR', nodes: [node('constructor')], edges: [] };
  const positions = Object.assign(Object.create(null), { constructor: { x: 18, y: 18 } });
  const copies = [{ node: node('__proto__'), sourceId: 'constructor' }];
  const next = placeCanvasCopies(graph, positions, copies);
  assert.equal(Object.getPrototypeOf(next), null);
  assert.equal(Object.hasOwn(next, '__proto__'), true);
  assert.equal(Object.hasOwn(positions, '__proto__'), false);
  assertCopiesClearOfOriginals(graph, positions, copies, next);
});
