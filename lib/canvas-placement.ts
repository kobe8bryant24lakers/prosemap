import type { MermaidFlowGraph, MermaidFlowNode } from './mermaid-workbench.ts';
import { mermaidCanvasNodeSize, type MermaidCanvasNodePositions, type MermaidCanvasPoint } from './mermaid-canvas-layout.ts';

/** Place a duplicate selection as one unit, preserving relative coordinates. */
export function placeCanvasCopies(
  graph: MermaidFlowGraph,
  positions: MermaidCanvasNodePositions,
  copies: Array<{ node: MermaidFlowNode; sourceId: string }>,
): MermaidCanvasNodePositions {
  const next = Object.assign(Object.create(null), positions) as MermaidCanvasNodePositions;
  const objects = copies.filter(({ sourceId }) => positions[sourceId]).map(({ node, sourceId }) => ({
    node, ...positions[sourceId], ...mermaidCanvasNodeSize(node, graph.kind),
  }));
  if (!objects.length) return next;
  const occupied = graph.nodes.filter((node) => positions[node.id]).map((node) => ({
    ...positions[node.id], ...mermaidCanvasNodeSize(node, graph.kind),
  }));
  const left = Math.min(...objects.map((object) => object.x));
  const top = Math.min(...objects.map((object) => object.y));
  const width = Math.max(...objects.map((object) => object.x + object.width)) - left;
  const height = Math.max(...objects.map((object) => object.y + object.height)) - top;
  const sequence = graph.kind === 'sequence';
  const free = (delta: MermaidCanvasPoint) => objects.every((object) => {
    const x = object.x + delta.x, y = object.y + delta.y;
    return x >= 18 && y >= 18 && occupied.every((other) =>
      x + object.width + 24 <= other.x || x >= other.x + other.width + 24
      || (!sequence && (y + object.height + 24 <= other.y || y >= other.y + other.height + 24)));
  });
  let delta = { x: 40, y: sequence ? 0 : 40 };
  if (!free(delta)) {
    let found: MermaidCanvasPoint | undefined;
    for (let ring = 1; ring <= 12 && !found; ring++) {
      const dx = (width + 32) * ring, dy = (height + 32) * ring;
      const candidates = sequence ? [{ x: dx, y: 0 }, { x: -dx, y: 0 }] : [
        { x: dx, y: 0 }, { x: 0, y: dy }, { x: -dx, y: 0 }, { x: 0, y: -dy },
        { x: dx, y: dy }, { x: -dx, y: dy }, { x: dx, y: -dy }, { x: -dx, y: -dy },
      ];
      found = candidates.find(free);
    }
    delta = found ?? { x: Math.max(...occupied.map((object) => object.x + object.width), left) + 32 - left, y: 0 };
  }
  for (const object of objects) next[object.node.id] = { x: object.x + delta.x, y: object.y + delta.y };
  return next;
}
