import assert from 'node:assert/strict';
import test from 'node:test';
import { nodesInCanvasRect, moveCanvasSelection, arrangeCanvasSelection } from '../lib/canvas-selection.ts';
import { mermaidCanvasNodeSize } from '../lib/mermaid-canvas-layout.ts';
const graph = { kind: 'flowchart', direction: 'LR', nodes: ['A','B','C'].map(id => ({ id, label: id, shape: 'rectangle' })), edges: [] };
const positions = { A: { x: 100, y: 100 }, B: { x: 400, y: 200 }, C: { x: 800, y: 300 } };

test('reverse marquee selects enclosed nodes but not partially covered nodes', () => {
  assert.deepEqual(nodesInCanvasRect(graph, positions, { x: 700, y: 400 }, { x: 90, y: 90 }), ['A','B']);
  assert.deepEqual(nodesInCanvasRect(graph, positions, { x: 90, y: 90 }, { x: 110, y: 110 }), []);
});

test('group movement preserves spacing at edges without mutating its snapshot', () => {
  const moved = moveCanvasSelection(graph, positions, ['A','B'], -500, -500, { width: 1200, height: 800 });
  assert.deepEqual(moved.A, { x: 16, y: 16 });
  assert.equal(moved.B.x - moved.A.x, 300);
  assert.equal(moved.B.y - moved.A.y, 100);
  assert.deepEqual(positions.A, { x: 100, y: 100 });
  assert.deepEqual(moved.C, positions.C);
});

test('alignment and distribution respect node bounds', () => {
  const aligned = arrangeCanvasSelection(graph, positions, ['A','B'], 'left');
  assert.equal(aligned.A.x, aligned.B.x);
  assert.deepEqual(aligned.C, positions.C);
  const distributed = arrangeCanvasSelection(graph, positions, ['A','B','C'], 'horizontal');
  const size = mermaidCanvasNodeSize(graph.nodes[0], graph.kind).width;
  assert.equal(distributed.B.x - distributed.A.x - size, distributed.C.x - distributed.B.x - size);
  assert.equal(distributed.A.x, positions.A.x);
  assert.equal(distributed.C.x, positions.C.x);
});
