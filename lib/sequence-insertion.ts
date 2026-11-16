import type { MermaidFlowEdge, MermaidFlowGraph } from './mermaid-workbench.ts';
import type { CanvasEdgeGeometry } from './canvas-edge-geometry.ts';

/** The preview arrow is horizontal at the drag origin. Use that same timeline
 * coordinate, including the rendered layout's compressed rows and self loops. */
export function sequenceInsertionIndex(graph: MermaidFlowGraph, geometry: Map<string, CanvasEdgeGeometry | null>, y: number) {
  const index = graph.edges.findIndex(edge => {
    const row = geometry.get(edge.id);
    return row && y < row.label.y + (edge.from === edge.to ? 9 : 10);
  });
  return index < 0 ? graph.edges.length : index;
}

/** Insert immediately before the following message in its existing block.
 * The canvas displays message rows, not directive rows; after the last message
 * means append outside any closed block, as with the existing add action. */
export function insertSequenceMessage(graph: MermaidFlowGraph, edge: MermaidFlowEdge, index: number): MermaidFlowGraph {
  const at = Math.max(0, Math.min(graph.edges.length, index));
  const edges = [...graph.edges];
  edges.splice(at, 0, edge);
  if (!graph.data?.sequenceItems) return { ...graph, edges };
  // Reordering uses message slots. Materialize their current IDs first so an
  // insertion after a previous reorder still refers to the visible message.
  let messageIndex = 0;
  const existingIds = new Set(graph.data.sequenceItems.filter(item => item.kind === 'message').map(item => item.id));
  const ordered = graph.edges.filter(item => existingIds.has(item.id));
  const liveIds = new Set(graph.edges.map(item => item.id));
  const items = graph.data.sequenceItems.filter(item => item.kind !== 'message' || liveIds.has(item.id))
    .map(item => item.kind === 'message'
    ? { kind: 'message' as const, id: ordered[messageIndex++]?.id ?? item.id } : item);
  for (const message of graph.edges) if (!existingIds.has(message.id)) items.push({ kind: 'message', id: message.id });
  const nextId = graph.edges[at]?.id;
  const slot = items.findIndex(item => item.kind === 'message' && item.id === nextId);
  items.splice(slot < 0 ? items.length : slot, 0, { kind: 'message', id: edge.id });
  return { ...graph, edges, data: { ...graph.data, sequenceItems: items } };
}
