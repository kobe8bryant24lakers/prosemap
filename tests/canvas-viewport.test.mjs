import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasEdgeScroll, initialCanvasView } from '../lib/canvas-viewport.ts';
import { nodesInCanvasRect, toggleCanvasSelection, moveCanvasSelection } from '../lib/canvas-selection.ts';

test('tall diagrams open at a readable scale at the beginning of the content', () => {
  const view = initialCanvasView({ minX: 600, maxX: 900, minY: 0, maxY: 2000 }, 1200, 330);
  assert.equal(view.zoom, 0.75);
  assert.equal(view.x, 750);
  assert.equal(view.y, 220);
});
test('small diagrams center without oversized initial zoom', () => {
  assert.deepEqual(initialCanvasView({ minX: 100, maxX: 300, minY: 50, maxY: 150 }, 800, 600), { zoom: 0.9, x: 200, y: 100 });
});
test('edge scrolling is symmetric, time bounded and inactive in the viewport center', () => {
  const viewport = { width: 800, height: 500 };
  assert.deepEqual(canvasEdgeScroll({ x: 400, y: 250 }, viewport), { x: 0, y: 0 });
  const a = canvasEdgeScroll({ x: 0, y: 0 }, viewport, 16);
  const b = canvasEdgeScroll({ x: 800, y: 500 }, viewport, 16);
  assert.equal(a.x, -b.x); assert.equal(a.y, -b.y);
  assert.ok(b.x > canvasEdgeScroll({ x: 775, y: 480 }, viewport, 16).x);
  assert.ok(canvasEdgeScroll({ x: 900, y: 600 }, viewport, 10000).x <= 22);
});
test('intersection selection, toggle removal and growing-stage moves preserve user intent', () => {
  const graph = { kind: 'flowchart', direction: 'LR', nodes: ['A','B'].map(id=>({id,label:id,shape:'rectangle'})), edges: [] };
  const positions = { A: { x: 100, y: 100 }, B: { x: 300, y: 200 } };
  assert.deepEqual(nodesInCanvasRect(graph, positions, { x: 95, y: 95 }, { x: 110, y: 110 }), []);
  assert.deepEqual(nodesInCanvasRect(graph, positions, { x: 95, y: 95 }, { x: 110, y: 110 }, true), ['A']);
  assert.deepEqual(toggleCanvasSelection(['A'], ['A','B']), ['B']);
  const moved = moveCanvasSelection(graph, positions, ['A','B'], 2000, 1800, { width: Infinity, height: Infinity });
  assert.deepEqual(moved.A, { x: 2100, y: 1900 });
  assert.equal(moved.B.x - moved.A.x, 200); assert.equal(moved.B.y - moved.A.y, 100);
});
