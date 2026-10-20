import type { MermaidFlowEdge, MermaidFlowGraph } from './mermaid-workbench.ts';

export const CANVAS_CONNECTION_MESSAGES = {
  'missing-node': '连接对象已不存在，请重新选择',
  'mindmap-self': '主题不能连接到自身，请选择其他主题',
  'gantt-self': '任务不能依赖自身，请选择其他任务',
  'mindmap-cycle': '思维导图不能包含循环关系',
  'gantt-cycle': '甘特图任务依赖不能形成循环',
  'gantt-duplicate': '同一任务依赖不能重复',
  'state-end-source': '结束状态不能作为连线起点',
  'state-start-target': '开始状态不能作为连线终点',
  'state-start-connected': '该开始状态已有连线，请先删除原连线',
  'state-end-connected': '该结束状态已有连线，请先删除原连线',
} as const;

export type CanvasConnectionIssue = keyof typeof CANVAS_CONNECTION_MESSAGES;

export function connectionWouldCycle(edges: MermaidFlowEdge[], from: string, to: string) {
  const children = new Map<string, string[]>();
  for (const edge of edges) children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  const pending = [to];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === from) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(children.get(current) ?? []));
  }
  return false;
}

/** The same rules govern target highlighting and committing a new connection. */
export function canvasConnectionIssue(graph: MermaidFlowGraph, from: string, to: string): CanvasConnectionIssue | null {
  const fromNode = graph.nodes.find((node) => node.id === from);
  const toNode = graph.nodes.find((node) => node.id === to);
  if (!fromNode || !toNode) return 'missing-node';
  if (graph.kind === 'mindmap' || graph.kind === 'gantt') {
    if (from === to) return graph.kind === 'mindmap' ? 'mindmap-self' : 'gantt-self';
    if (connectionWouldCycle(graph.edges, from, to)) return graph.kind === 'mindmap' ? 'mindmap-cycle' : 'gantt-cycle';
  }
  if (graph.kind === 'gantt' && graph.edges.some((edge) => edge.from === from && edge.to === to)) return 'gantt-duplicate';
  if (graph.kind === 'state') {
    if (fromNode.data?.stateRole === 'end') return 'state-end-source';
    if (toNode.data?.stateRole === 'start') return 'state-start-target';
    if (fromNode.data?.stateRole === 'start' && graph.edges.some((edge) => edge.from === from)) return 'state-start-connected';
    if (toNode.data?.stateRole === 'end' && graph.edges.some((edge) => edge.to === to)) return 'state-end-connected';
  }
  return null;
}

export function validCanvasConnectionTarget(graph: MermaidFlowGraph, from: string, target: string | null) {
  return target && !canvasConnectionIssue(graph, from, target) ? target : null;
}
