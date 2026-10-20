import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasEdgeGeometries } from '../lib/canvas-edge-geometry.ts';
import { layoutMermaidGraph } from '../lib/mermaid-canvas-layout.ts';
import { MERMAID_TEMPLATES, parseMermaidVisualSource } from '../lib/mermaid-workbench.ts';

const graph = {
  kind: 'flowchart', direction: 'LR',
  nodes: ['A', 'B', 'C'].map(id => ({ id, label: id, shape: 'rectangle' })),
  edges: [
    { id: 'ab1', from: 'A', to: 'B' }, { id: 'ab2', from: 'A', to: 'B' },
    { id: 'ba', from: 'B', to: 'A' }, { id: 'ac', from: 'A', to: 'C' },
    { id: 'aa', from: 'A', to: 'A' },
  ],
};
const positions = { A: { x: 100, y: 100 }, B: { x: 500, y: 100 }, C: { x: 100, y: 400 } };

test('parallel and reverse edges retain their distinct curves and labels', () => {
  const result = canvasEdgeGeometries(graph, positions, {}, 800);
  assert.deepEqual(result.get('ab1'), { path: 'M 276 136 C 388 108, 388 108, 500 136', label: { x: 388, y: 108 } });
  assert.deepEqual(result.get('ab2'), { path: 'M 276 136 C 388 136, 388 136, 500 136', label: { x: 388, y: 136 } });
  assert.deepEqual(result.get('ba'), { path: 'M 500 136 C 388 164, 388 164, 276 136', label: { x: 388, y: 164 } });
  assert.deepEqual(result.get('ac'), { path: 'M 188 172 C 188 286, 188 286, 188 400', label: { x: 188, y: 286 } });
  assert.deepEqual(result.get('aa'), { path: 'M 226.72 100 C 311.2 35.2, 311.2 164.8, 226.72 104', label: { x: 292.6144, y: 88 } });
});

test('Dagre routes retain quadratic corners and route label positions', () => {
  const route = { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }, { x: 7, y: 8 }], label: { x: 15, y: 20 } };
  const result = canvasEdgeGeometries(graph, positions, { ab1: route }, 800);
  assert.deepEqual(result.get('ab1'), { path: 'M 1 2 Q 3 4 4 5 Q 5 6 6 7 L 7 8', label: { x: 15, y: 20 } });
  assert.equal(result.get('ab2').label.y, 136);
});

test('sequence rows follow the tallest participant and preserve self-message geometry', () => {
  const sequence = { ...graph, kind: 'sequence' };
  const placed = { A: { x: 100, y: 58 }, B: { x: 500, y: 58 }, C: { x: 100, y: 120 } };
  const result = canvasEdgeGeometries(sequence, placed, {}, 700);
  assert.deepEqual(result.get('ab1'), { path: 'M 187 244 L 587 244', label: { x: 387, y: 234 } });
  assert.deepEqual(result.get('ab2'), { path: 'M 187 306 L 587 306', label: { x: 387, y: 296 } });
  assert.deepEqual(result.get('ba'), { path: 'M 587 368 L 187 368', label: { x: 387, y: 358 } });
  assert.deepEqual(result.get('aa'), { path: 'M 187 492 C 259 492, 259 526, 187 526', label: { x: 238.84, y: 483 } });
  const compact = canvasEdgeGeometries(sequence, placed, {}, 400);
  assert.equal(compact.get('ab2').label.y, 258.4);
});

test('missing endpoint positions do not generate invalid paths', () => {
  const result = canvasEdgeGeometries(graph, { A: positions.A }, {}, 800);
  assert.equal(result.get('ab1'), null);
  assert.equal(result.get('ac'), null);
  assert.ok(result.get('aa'));
});

test('imported IDs containing delimiters cannot merge unrelated parallel groups', () => {
  const nodes = ['A|B', 'C', 'A', 'B|C'].map(id => ({ id, label: id, shape: 'rectangle' }));
  const edges = [{ id: 'first', from: 'A|B', to: 'C' }, { id: 'second', from: 'A', to: 'B|C' }];
  const placed = Object.fromEntries(nodes.map((node, index) => [node.id, { x: index % 2 * 400, y: Math.floor(index / 2) * 300 }]));
  const result = canvasEdgeGeometries({ ...graph, nodes, edges }, placed, {}, 800);
  assert.equal(result.get('first').label.y, 36);
  assert.equal(result.get('second').label.y, 336);
});

test('all templates render finite geometry for every supported edge', () => {
  for (const template of MERMAID_TEMPLATES) {
    const parsed = parseMermaidVisualSource(template.source);
    const layout = layoutMermaidGraph(parsed);
    const result = canvasEdgeGeometries(parsed, layout.positions, layout.routes, layout.height);
    assert.equal(result.size, parsed.edges.length, template.id);
    for (const value of result.values()) {
      assert.ok(value, template.id);
      assert.ok(!/NaN|Infinity/.test(value.path), template.id);
      assert.ok(Number.isFinite(value.label.x) && Number.isFinite(value.label.y), template.id);
    }
  }
});

test('a thousand edges index nodes and parallel groups in linear work', () => {
  const count = 1000;
  let idReads = 0, endpointReads = 0;
  const nodes = Array.from({ length: count }, (_, i) => ({ get id() { idReads++; return `N${i}`; }, label: `N${i}`, shape: 'rectangle' }));
  const edges = Array.from({ length: count - 1 }, (_, i) => ({ id: `E${i}`, get from() { endpointReads++; return `N${i}`; }, to: `N${i + 1}` }));
  const placed = Object.fromEntries(Array.from({ length: count }, (_, i) => [`N${i}`, { x: i * 220, y: 60 }]));
  const result = canvasEdgeGeometries({ ...graph, nodes, edges }, placed, {}, 800);
  assert.equal(result.size, count - 1);
  assert.ok(idReads < count * 10, `node lookup work: ${idReads}`);
  assert.ok(endpointReads < count * 10, `parallel grouping work: ${endpointReads}`);
});
