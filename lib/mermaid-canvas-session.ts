import type { MermaidVisualGraph } from './mermaid-workbench.ts';

/** Draft parsing and the mounted canvas have different lifetimes. Incomplete
 * source must not destroy the canvas's manual positions or edit history. */
export type MermaidCanvasSession = {
  graph: MermaidVisualGraph | null;
  canvasGraph: MermaidVisualGraph | null;
  externalRevision: number;
};

export function createMermaidCanvasSession(graph: MermaidVisualGraph | null): MermaidCanvasSession {
  return { graph, canvasGraph: graph, externalRevision: 0 };
}

export function updateMermaidCanvasDraft(session: MermaidCanvasSession, graph: MermaidVisualGraph | null): MermaidCanvasSession {
  return { ...session, graph };
}

/** Publish external edits only when returning to the canvas. A partly typed
 * but temporarily valid diagram should not prune existing node positions. */
export function activateMermaidCanvasDraft(session: MermaidCanvasSession): MermaidCanvasSession {
  if (!session.graph || JSON.stringify(session.graph) === JSON.stringify(session.canvasGraph)) return session;
  return {
    ...session,
    canvasGraph: session.graph,
    externalRevision: session.externalRevision + 1,
  };
}

/** Canvas-originated edits stay in the canvas's own undo transaction. */
export function commitMermaidCanvasGraph(session: MermaidCanvasSession, graph: MermaidVisualGraph): MermaidCanvasSession {
  return { ...session, graph, canvasGraph: graph };
}
