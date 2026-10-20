// Warm CPU helper benchmark. This excludes React, DOM, paint and input latency;
// these timings are not frame rates or an end-to-end smoothness measurement.
import { performance } from 'node:perf_hooks';
import { canvasEdgeGeometries } from '../lib/canvas-edge-geometry.ts';

function measure(run) {
  for (let i = 0; i < 8; i++) run();
  const samples = [];
  for (let i = 0; i < 40; i++) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { medianMs: +samples[20].toFixed(3), p95Ms: +samples[38].toFixed(3) };
}

for (const count of [100, 300, 1000]) {
  const nodes = Array.from({ length: count }, (_, i) => ({ id: `N${i}`, label: `Node ${i}`, shape: 'rectangle' }));
  const edges = Array.from({ length: count - 1 }, (_, i) => ({ id: `E${i}`, from: `N${Math.floor(i / 2)}`, to: `N${i + 1}`, label: '', style: 'arrow' }));
  const positions = Object.fromEntries(nodes.map((node, i) => [node.id, { x: 70 + i % 20 * 250, y: 70 + Math.floor(i / 20) * 130 }]));
  for (const kind of ['flowchart', 'sequence']) {
    const graph = { kind, direction: 'LR', nodes, edges };
    console.log(JSON.stringify({ nodes: count, edges: edges.length, kind, ...measure(() => canvasEdgeGeometries(graph, positions, {}, 8000)) }));
  }
}
