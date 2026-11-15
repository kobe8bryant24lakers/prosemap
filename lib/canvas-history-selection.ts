export type CanvasHistorySelection = { kind: 'node' | 'edge'; id: string; ids?: string[] } | null;

type CanvasObjects = { nodes: readonly { id: string }[]; edges: readonly { id: string }[] };

/** History restores data, while the user's current valid selection stays put.
 * A null selection stays null; restoring a deleted object does not select it. */
export function reconcileCanvasHistorySelection(selection: CanvasHistorySelection, graph: CanvasObjects): CanvasHistorySelection {
  if (!selection) return null;
  if (selection.kind === 'edge') {
    return graph.edges.some(edge => edge.id === selection.id) ? selection : null;
  }
  const present = new Set(graph.nodes.map(node => node.id));
  const ids = [...new Set(selection.ids ?? [selection.id])].filter(id => present.has(id));
  if (!ids.length) return null;
  const id = ids.includes(selection.id) ? selection.id : ids[0];
  return ids.length === 1 ? { kind: 'node', id } : { kind: 'node', id, ids };
}
