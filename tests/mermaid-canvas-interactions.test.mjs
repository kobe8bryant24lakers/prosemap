import assert from 'node:assert/strict';
import test from 'node:test';
import { MERMAID_TEMPLATES, parseMermaidVisualSource } from '../lib/mermaid-workbench.ts';
import {
  expandedMermaidCanvasStage, layoutMermaidGraph, mermaidCanvasNodeSize,
  placeMermaidCanvasNode, reconcileMermaidCanvasNodes, snapMermaidCanvasNode,
} from '../lib/mermaid-canvas-layout.ts';

for (const template of MERMAID_TEMPLATES) {
  test(`${template.id}: insertion, deletion and declaration reordering retain manual positions`, () => {
    const graph = parseMermaidVisualSource(template.source);
    const layout = layoutMermaidGraph(graph);
    // A manual move must survive the next topology change, including sequence and grouped views.
    const first = graph.nodes[0];
    layout.positions[first.id] = { x: layout.positions[first.id].x + 37, y: layout.positions[first.id].y };
    const original = structuredClone(layout.positions);
    const node = { ...first, id: 'AddedForRegression' };
    const point = placeMermaidCanvasNode(graph, layout.positions, node, layout.positions[first.id]);
    const size = mermaidCanvasNodeSize(node, graph.kind);
    for (const other of graph.nodes) {
      const p = layout.positions[other.id], s = mermaidCanvasNodeSize(other, graph.kind);
      assert.ok(point.x + size.width <= p.x || point.x >= p.x + s.width ||
        (graph.kind !== 'sequence' && (point.y + size.height <= p.y || point.y >= p.y + s.height)), `${other.id}: new object overlaps`);
    }
    assert.deepEqual({ ...layout.positions }, original);
    const next = { ...graph, nodes: [...graph.nodes, node] };
    const inserted = reconcileMermaidCanvasNodes(next, { ...layout, positions: { ...layout.positions, [node.id]: point } });
    for (const existing of graph.nodes) assert.deepEqual(inserted.positions[existing.id], original[existing.id]);
    assert.deepEqual(inserted.positions[node.id], point);
    const reordered = reconcileMermaidCanvasNodes({ ...next, nodes: [...next.nodes].reverse() }, inserted);
    assert.deepEqual(reordered.positions, inserted.positions);
    const removed = reconcileMermaidCanvasNodes(graph, reordered);
    assert.equal(removed.positions[node.id], undefined);
    for (const existing of graph.nodes) assert.deepEqual(removed.positions[existing.id], original[existing.id]);
  });
}

test('source-added nodes receive free positions without moving existing nodes', () => {
  const graph = parseMermaidVisualSource('sequenceDiagram\nparticipant A\nparticipant B\nA->>B: message');
  const layout = layoutMermaidGraph(graph);
  layout.positions.A.x = 900;
  const result = reconcileMermaidCanvasNodes({ ...graph, nodes: [...graph.nodes, { id: 'C', label: 'C', shape: 'rectangle' }] }, layout);
  assert.equal(result.positions.A.x, 900);
  assert.deepEqual(result.positions.B, layout.positions.B);
  assert.equal(result.positions.C.y, 58);
  assert.ok(Math.abs(result.positions.C.x - result.positions.A.x) >= 174);
});

test('implicit sequence lifelines do not recursively grow the stage during geometry updates', () => {
  const graph = parseMermaidVisualSource('sequenceDiagram\nparticipant A\nparticipant B\nA->>B: message');
  const layout = layoutMermaidGraph(graph);
  let stage = { width: layout.width, height: layout.height };
  for (let i = 0; i < 100; i++) stage = expandedMermaidCanvasStage(graph, layout.positions, stage);
  assert.equal(stage.height, layout.height);
  graph.nodes[0].data = { ...graph.nodes[0].data, canvasLifelineHeight: 1100 };
  stage = expandedMermaidCanvasStage(graph, layout.positions, stage);
  assert.ok(stage.height >= layout.positions.A.y + 1100);
  assert.deepEqual(expandedMermaidCanvasStage(graph, layout.positions, stage), stage);
});

test('new objects preserve precise placement in free space and can extend beyond stage bounds', () => {
  const graph = { kind: 'flowchart', direction: 'LR', nodes: [], edges: [] };
  const node = { id: 'N', label: 'N', shape: 'rectangle' };
  assert.deepEqual(placeMermaidCanvasNode(graph, {}, node, { x: 2222.5, y: 1111.25 }), { x: 2222.5, y: 1111.25 });
  assert.deepEqual(placeMermaidCanvasNode(graph, {}, node, { x: -50, y: -1 }), { x: 18, y: 18 });
});

test('alignment tolerance scales in screen pixels instead of becoming sticky at high zoom', () => {
  const nodes = ['A', 'B'].map(id => ({ id, label: id, shape: 'rectangle' }));
  const graph = { kind: 'flowchart', direction: 'LR', nodes, edges: [] };
  const positions = { A: { x: 100, y: 100 }, B: { x: 400, y: 400 } };
  assert.equal(snapMermaidCanvasNode(graph, positions, nodes[1], { x: 105, y: 400 }, false, 3).point.x, 105);
  assert.equal(snapMermaidCanvasNode(graph, positions, nodes[1], { x: 105, y: 400 }, false, 12).point.x, 100);
});

test('sequence fit frames participants and lifelines instead of unused stage margins', async () => {
  const { mermaidCanvasLayoutBounds, mermaidCanvasFitZoom } = await import('../lib/mermaid-canvas-layout.ts');
  const graph = parseMermaidVisualSource('sequenceDiagram\nparticipant A\nparticipant B\nA->>B: message');
  const layout = layoutMermaidGraph(graph);
  const bounds = mermaidCanvasLayoutBounds(graph, layout);
  assert.ok(bounds.maxX - bounds.minX < layout.width / 2);
  assert.ok(bounds.maxY >= layout.height - 25);
  assert.equal(mermaidCanvasFitZoom(bounds, 820, 500, 0.9), 0.9);
});
