import type { MermaidFlowGraph } from './mermaid-workbench.ts';
import {
  mermaidCanvasNodeSize,
  type MermaidCanvasEdgeRoute,
  type MermaidCanvasNodePositions,
  type MermaidCanvasPoint,
} from './mermaid-canvas-layout.ts';

export type CanvasEdgeGeometry = { path: string; label: MermaidCanvasPoint };

function routePath(points: MermaidCanvasPoint[]) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (index === points.length - 1) {
      path += ` L ${point.x} ${point.y}`;
    } else {
      const next = points[index + 1];
      path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
    }
  }
  return path;
}

/** Compute shared geometry once per frame, rather than scanning the graph for every edge. */
export function canvasEdgeGeometries(
  graph: MermaidFlowGraph,
  positions: MermaidCanvasNodePositions,
  routes: Record<string, MermaidCanvasEdgeRoute>,
  stageHeight: number,
): Map<string, CanvasEdgeGeometry | null> {
  const nodes = new Map(graph.nodes.map((node) => {
    const position = positions[node.id];
    const size = mermaidCanvasNodeSize(node, graph.kind);
    return [node.id, position ? {
      position,
      size,
      center: { x: position.x + size.width / 2, y: position.y + size.height / 2 },
    } : null] as const;
  }));

  let participantBottom = 0;
  if (graph.kind === 'sequence') {
    for (const node of nodes.values()) {
      if (node) participantBottom = Math.max(participantBottom, node.position.y + node.size.height);
    }
  }
  const firstRow = Math.max(190, participantBottom + 58);
  const step = Math.min(62, Math.max(80, stageHeight - firstRow - 34) / Math.max(1, graph.edges.length));

  const offsets = new Map<string, number>();
  if (graph.kind !== 'sequence') {
    const parallelGroups = new Map<string, string[]>();
    for (const edge of graph.edges) {
      // JSON tuples avoid collisions for imported IDs containing delimiters.
      const key = JSON.stringify(edge.from < edge.to ? [edge.from, edge.to] : [edge.to, edge.from]);
      const group = parallelGroups.get(key);
      if (group) group.push(edge.id);
      else parallelGroups.set(key, [edge.id]);
    }
    for (const group of parallelGroups.values()) {
      group.forEach((id, index) => offsets.set(id, (index - (group.length - 1) / 2) * 28));
    }
  }

  return new Map(graph.edges.map((edge, edgeIndex): [string, CanvasEdgeGeometry | null] => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) return [edge.id, null];
    const { position: fromPosition, size: fromSize, center: fromCenter } = from;
    const { size: toSize, center: toCenter } = to;

    if (graph.kind === 'sequence') {
      const y = firstRow + edgeIndex * step;
      if (edge.from === edge.to) {
        const loopWidth = 72;
        const loopHeight = Math.min(34, Math.max(22, step * 0.62));
        return [edge.id, {
          path: `M ${fromCenter.x} ${y} C ${fromCenter.x + loopWidth} ${y}, ${fromCenter.x + loopWidth} ${y + loopHeight}, ${fromCenter.x} ${y + loopHeight}`,
          label: { x: fromCenter.x + loopWidth * 0.72, y: y - 9 },
        }];
      }
      return [edge.id, {
        path: `M ${fromCenter.x} ${y} L ${toCenter.x} ${y}`,
        label: { x: (fromCenter.x + toCenter.x) / 2, y: y - 10 },
      }];
    }
    const routed = routes[edge.id];
    if (routed?.points.length) return [edge.id, { path: routePath(routed.points), label: routed.label }];
    if (edge.from === edge.to) {
      const loopWidth = Math.max(70, fromSize.width * 0.48);
      const loopHeight = Math.max(62, fromSize.height * 0.9);
      const startX = fromPosition.x + fromSize.width * 0.72;
      const startY = fromPosition.y;
      return [edge.id, {
        path: `M ${startX} ${startY} C ${startX + loopWidth} ${startY - loopHeight}, ${startX + loopWidth} ${startY + loopHeight}, ${startX} ${startY + 4}`,
        label: { x: startX + loopWidth * 0.78, y: startY - 12 },
      }];
    }
    const dx = toCenter.x - fromCenter.x;
    const dy = toCenter.y - fromCenter.y;
    const fromFactor = 1 / Math.max(Math.abs(dx) / (fromSize.width / 2), Math.abs(dy) / (fromSize.height / 2), 1);
    const toFactor = 1 / Math.max(Math.abs(dx) / (toSize.width / 2), Math.abs(dy) / (toSize.height / 2), 1);
    const start = { x: fromCenter.x + dx * fromFactor, y: fromCenter.y + dy * fromFactor };
    const end = { x: toCenter.x - dx * toFactor, y: toCenter.y - dy * toFactor };
    const parallelOffset = offsets.get(edge.id) ?? 0;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    return [edge.id, {
      path: horizontal
        ? `M ${start.x} ${start.y} C ${(start.x + end.x) / 2} ${start.y + parallelOffset}, ${(start.x + end.x) / 2} ${end.y + parallelOffset}, ${end.x} ${end.y}`
        : `M ${start.x} ${start.y} C ${start.x + parallelOffset} ${(start.y + end.y) / 2}, ${end.x + parallelOffset} ${(start.y + end.y) / 2}, ${end.x} ${end.y}`,
      label: horizontal
        ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 + parallelOffset }
        : { x: (start.x + end.x) / 2 + parallelOffset, y: (start.y + end.y) / 2 },
    }];
  }));
}
