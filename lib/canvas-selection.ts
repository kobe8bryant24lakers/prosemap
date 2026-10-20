import type { MermaidFlowGraph } from './mermaid-workbench.ts';
import { mermaidCanvasNodeSize, type MermaidCanvasNodePositions, type MermaidCanvasPoint } from './mermaid-canvas-layout.ts';

export function nodesInCanvasRect(graph: MermaidFlowGraph, positions: MermaidCanvasNodePositions, start: MermaidCanvasPoint, end: MermaidCanvasPoint, intersect = false): string[] {
  const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
  return graph.nodes.filter((node) => {
    const p = positions[node.id], size = mermaidCanvasNodeSize(node, graph.kind);
    return p && (intersect
      ? p.x <= right && p.y <= bottom && p.x + size.width >= left && p.y + size.height >= top
      : p.x >= left && p.y >= top && p.x + size.width <= right && p.y + size.height <= bottom);
  }).map((node) => node.id);
}

export function toggleCanvasSelection(initial: string[], hits: string[]): string[] {
  const result = new Set(initial);
  for (const id of new Set(hits)) {
    if (result.has(id)) result.delete(id);
    else result.add(id);
  }
  return [...result];
}

/** Clamp one shared delta so a selection keeps its spacing at stage edges. */
export function moveCanvasSelection(graph: MermaidFlowGraph, positions: MermaidCanvasNodePositions, ids: string[], dx: number, dy: number, stage: { width: number; height: number }): MermaidCanvasNodePositions {
  const selected = graph.nodes.filter((node) => ids.includes(node.id) && positions[node.id]);
  if (!selected.length) return positions;
  const left = Math.min(...selected.map((node) => positions[node.id].x));
  const top = Math.min(...selected.map((node) => positions[node.id].y));
  const right = Math.max(...selected.map((node) => positions[node.id].x + mermaidCanvasNodeSize(node, graph.kind).width));
  const bottom = Math.max(...selected.map((node) => positions[node.id].y + mermaidCanvasNodeSize(node, graph.kind).height));
  dx = Math.max(16 - left, Math.min(stage.width - 16 - right, dx));
  dy = Math.max(16 - top, Math.min(stage.height - 16 - bottom, dy));
  const next = Object.assign(Object.create(null), positions) as MermaidCanvasNodePositions;
  for (const node of selected) next[node.id] = { x: positions[node.id].x + dx, y: positions[node.id].y + dy };
  return next;
}

export type CanvasArrangement = 'left' | 'center' | 'top' | 'middle' | 'horizontal' | 'vertical';
export function arrangeCanvasSelection(graph: MermaidFlowGraph, positions: MermaidCanvasNodePositions, ids: string[], mode: CanvasArrangement): MermaidCanvasNodePositions {
  const nodes = graph.nodes.filter((node) => ids.includes(node.id) && positions[node.id]);
  const distribute = mode === 'horizontal' || mode === 'vertical';
  if (nodes.length < (distribute ? 3 : 2)) return positions;
  const axis = mode === 'left' || mode === 'center' || mode === 'horizontal' ? 'x' : 'y';
  const dimension = axis === 'x' ? 'width' : 'height';
  const size = (node: typeof nodes[number]) => mermaidCanvasNodeSize(node, graph.kind)[dimension];
  const min = Math.min(...nodes.map((node) => positions[node.id][axis]));
  const max = Math.max(...nodes.map((node) => positions[node.id][axis] + size(node)));
  const next = Object.assign(Object.create(null), positions) as MermaidCanvasNodePositions;
  if (distribute) {
    nodes.sort((a, b) => positions[a.id][axis] - positions[b.id][axis]);
    const gap = (max - min - nodes.reduce((sum, node) => sum + size(node), 0)) / (nodes.length - 1);
    let cursor = min;
    for (const node of nodes) { next[node.id] = { ...positions[node.id], [axis]: cursor }; cursor += size(node) + gap; }
  } else {
    for (const node of nodes) next[node.id] = { ...positions[node.id], [axis]: mode === 'left' || mode === 'top' ? min : (min + max - size(node)) / 2 };
  }
  return next;
}
