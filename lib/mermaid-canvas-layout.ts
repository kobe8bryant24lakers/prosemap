import { layout as runDagreLayout } from 'dagre-d3-es/src/dagre/index.js';
import { Graph } from 'dagre-d3-es/src/graphlib/graph.js';
import type {
  MermaidFlowEdge,
  MermaidFlowGraph,
  MermaidFlowNode,
} from './mermaid-workbench.ts';

export type MermaidCanvasPoint = { x: number; y: number };
export type MermaidCanvasNodePositions = Record<string, MermaidCanvasPoint>;
export type MermaidCanvasEdgeRoute = {
  points: MermaidCanvasPoint[];
  label: MermaidCanvasPoint;
};
export type MermaidCanvasLayout = {
  positions: MermaidCanvasNodePositions;
  routes: Record<string, MermaidCanvasEdgeRoute>;
  width: number;
  height: number;
};
export type MermaidCanvasBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export const MIN_MERMAID_STAGE_WIDTH = 1440;
export const MIN_MERMAID_STAGE_HEIGHT = 780;
export const MIN_MERMAID_SEQUENCE_STAGE_HEIGHT = 460;
export const MERMAID_STAGE_PADDING = 70;
export const MIN_MERMAID_CANVAS_ZOOM = 0.02;

export type MermaidSequenceMessageMarker = 'none' | 'arrow' | 'cross' | 'async';
export type MermaidSequenceMessageVisual = {
  dashed: boolean;
  startMarker: MermaidSequenceMessageMarker;
  endMarker: MermaidSequenceMessageMarker;
};

/**
 * Keeps the canvas representation aligned with Mermaid v11 sequence message
 * semantics. Unknown or missing tokens use the editor's default `->>` style.
 */
export function mermaidSequenceMessageVisual(token?: string): MermaidSequenceMessageVisual {
  switch (token) {
    case '->':
      return { dashed: false, startMarker: 'none', endMarker: 'none' };
    case '-->':
      return { dashed: true, startMarker: 'none', endMarker: 'none' };
    case '-->>':
      return { dashed: true, startMarker: 'none', endMarker: 'arrow' };
    case '-x':
      return { dashed: false, startMarker: 'none', endMarker: 'cross' };
    case '--x':
      return { dashed: true, startMarker: 'none', endMarker: 'cross' };
    case '-)':
      return { dashed: false, startMarker: 'none', endMarker: 'async' };
    case '--)':
      return { dashed: true, startMarker: 'none', endMarker: 'async' };
    case '<<->>':
      return { dashed: false, startMarker: 'arrow', endMarker: 'arrow' };
    case '<<-->>':
      return { dashed: true, startMarker: 'arrow', endMarker: 'arrow' };
    case '->>':
    default:
      return { dashed: false, startMarker: 'none', endMarker: 'arrow' };
  }
}

type Size = { width: number; height: number };
type DagreGraphLabel = {
  rankdir: 'TB' | 'BT' | 'LR' | 'RL';
  ranker: 'network-simplex';
  acyclicer: 'greedy';
  nodesep: number;
  edgesep: number;
  ranksep: number;
  marginx: number;
  marginy: number;
  width?: number;
  height?: number;
};
type DagreNodeLabel = Size & { x?: number; y?: number };
type DagreEdgeLabel = Size & {
  labelpos: 'c';
  minlen?: number;
  weight?: number;
  points?: MermaidCanvasPoint[];
  x?: number;
  y?: number;
};

function roundCoordinate(value: number) {
  return Math.round(value * 10) / 10;
}

function createSafeRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function mermaidCanvasNodeSize(node: MermaidFlowNode, kind: MermaidFlowGraph['kind']): Size {
  if (kind === 'sequence') return { width: 174, height: 66 };
  if (kind === 'state' && (node.data?.stateRole === 'start' || node.data?.stateRole === 'end')) return { width: 58, height: 58 };
  if (kind === 'class' || kind === 'er') {
    const detailCount = Math.min(6, node.data?.details?.length ?? 0);
    return { width: 214, height: Math.max(78, 58 + detailCount * 18) };
  }
  if (kind === 'mindmap') return node.data?.mindRoot ? { width: 210, height: 70 } : { width: 176, height: 58 };
  if (kind === 'gantt') return { width: 222, height: 92 };
  if (node.shape === 'circle') return { width: 92, height: 92 };
  if (node.shape === 'decision') return { width: 112, height: 92 };
  if (node.shape === 'terminal') return { width: 166, height: 64 };
  return { width: 176, height: 72 };
}

function edgeLayoutText(edge: MermaidFlowEdge, kind: MermaidFlowGraph['kind']) {
  if (edge.label) return edge.label;
  if (kind === 'class' || kind === 'er') return edge.data?.token || '关系';
  if (kind === 'gantt') return '依赖';
  return '';
}

function edgeLabelSize(edge: MermaidFlowEdge, kind: MermaidFlowGraph['kind']): Size {
  const text = edgeLayoutText(edge, kind);
  if (!text) return { width: 0, height: 0 };
  return {
    width: Math.min(180, Math.max(52, Array.from(text).length * 12 + 24)),
    height: 30,
  };
}

/**
 * Captures topology and node geometry. Text changes deliberately do not force a
 * live rearrangement while somebody is editing; “自动排列” still recalculates
 * label-aware routes from the current graph.
 */
export function graphLayoutSignature(graph: MermaidFlowGraph) {
  return JSON.stringify({
    kind: graph.kind,
    direction: graph.direction,
    nodes: graph.nodes.map((node) => [
      node.id,
      node.shape,
      node.data?.stateRole ?? '',
      node.data?.mindRoot ? 1 : 0,
      Math.min(6, node.data?.details?.length ?? 0),
    ]),
    edges: graph.edges.map((edge) => [
      edge.id,
      edge.from,
      edge.to,
    ]),
  });
}

export function graphNodeGeometrySignature(graph: MermaidFlowGraph) {
  return JSON.stringify(graph.nodes.map((node) => {
    const size = mermaidCanvasNodeSize(node, graph.kind);
    return [node.id, size.width, size.height];
  }));
}

export function mermaidCanvasLayoutBounds(
  graph: MermaidFlowGraph,
  layout: MermaidCanvasLayout,
  padding = 86,
): MermaidCanvasBounds {
  if (!graph.nodes.length || graph.kind === 'sequence') {
    return { minX: 0, minY: 0, maxX: layout.width, maxY: layout.height };
  }

  const xs: number[] = [];
  const ys: number[] = [];
  for (const node of graph.nodes) {
    const position = layout.positions[node.id];
    if (!position) continue;
    const size = mermaidCanvasNodeSize(node, graph.kind);
    xs.push(position.x, position.x + size.width);
    ys.push(position.y, position.y + size.height);
  }
  for (const edge of graph.edges) {
    const route = layout.routes[edge.id];
    if (!route) continue;
    for (const point of route.points) {
      xs.push(point.x);
      ys.push(point.y);
    }
    const labelSize = edgeLabelSize(edge, graph.kind);
    xs.push(route.label.x - labelSize.width / 2, route.label.x + labelSize.width / 2);
    ys.push(route.label.y - labelSize.height / 2, route.label.y + labelSize.height / 2);
  }

  if (!xs.length || !ys.length) {
    return { minX: 0, minY: 0, maxX: layout.width, maxY: layout.height };
  }
  return {
    minX: Math.max(0, Math.min(...xs) - padding),
    minY: Math.max(0, Math.min(...ys) - padding),
    maxX: Math.min(layout.width, Math.max(...xs) + padding),
    maxY: Math.min(layout.height, Math.max(...ys) + padding),
  };
}

export function mermaidCanvasFitZoom(
  bounds: MermaidCanvasBounds,
  viewportWidth: number,
  viewportHeight: number,
  maxZoom = 2,
) {
  const availableWidth = Math.max(120, viewportWidth - 34);
  const availableHeight = Math.max(100, viewportHeight - 34);
  const zoom = Math.min(
    maxZoom,
    availableWidth / Math.max(1, bounds.maxX - bounds.minX),
    availableHeight / Math.max(1, bounds.maxY - bounds.minY),
  );
  return Math.max(MIN_MERMAID_CANVAS_ZOOM, Math.min(maxZoom, Math.floor(zoom * 1000) / 1000));
}

function sequenceLayout(graph: MermaidFlowGraph): MermaidCanvasLayout {
  const gap = 76;
  const sizes = graph.nodes.map((node) => mermaidCanvasNodeSize(node, graph.kind));
  const contentWidth = sizes.reduce((total, size) => total + size.width, 0)
    + Math.max(0, graph.nodes.length - 1) * gap;
  const width = Math.max(MIN_MERMAID_STAGE_WIDTH, Math.ceil(contentWidth + MERMAID_STAGE_PADDING * 2));
  const firstMessageY = 190;
  const lastMessageY = graph.edges.length
    ? firstMessageY + (graph.edges.length - 1) * 62
    : firstMessageY;
  const height = Math.max(MIN_MERMAID_SEQUENCE_STAGE_HEIGHT, lastMessageY + 82);
  let x = (width - contentWidth) / 2;
  const positions = createSafeRecord<MermaidCanvasPoint>();
  graph.nodes.forEach((node, index) => {
    positions[node.id] = { x: roundCoordinate(x), y: 58 };
    x += sizes[index].width + gap;
  });
  return { positions, routes: createSafeRecord<MermaidCanvasEdgeRoute>(), width, height };
}

function fallbackGridLayout(graph: MermaidFlowGraph): MermaidCanvasLayout {
  if (!graph.nodes.length) {
    return {
      positions: createSafeRecord<MermaidCanvasPoint>(),
      routes: createSafeRecord<MermaidCanvasEdgeRoute>(),
      width: MIN_MERMAID_STAGE_WIDTH,
      height: MIN_MERMAID_STAGE_HEIGHT,
    };
  }
  const horizontal = graph.kind === 'mindmap' || graph.direction === 'LR' || graph.direction === 'RL';
  const reverse = graph.kind !== 'mindmap' && (graph.direction === 'BT' || graph.direction === 'RL');
  const laneCount = Math.ceil(Math.sqrt(graph.nodes.length));
  const rows = horizontal ? laneCount : Math.ceil(graph.nodes.length / laneCount);
  const columns = horizontal ? Math.ceil(graph.nodes.length / laneCount) : laneCount;
  const sizes = graph.nodes.map((node) => mermaidCanvasNodeSize(node, graph.kind));
  const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(0, ...sizes
    .filter((_, index) => index % columns === column)
    .map((size) => size.width)));
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(0, ...sizes
    .slice(row * columns, (row + 1) * columns)
    .map((size) => size.height)));
  const columnGap = 84;
  const rowGap = 70;
  const contentWidth = columnWidths.reduce((total, value) => total + value, 0) + Math.max(0, columns - 1) * columnGap;
  const contentHeight = rowHeights.reduce((total, value) => total + value, 0) + Math.max(0, rows - 1) * rowGap;
  const width = Math.max(MIN_MERMAID_STAGE_WIDTH, Math.ceil(contentWidth + MERMAID_STAGE_PADDING * 2));
  const height = Math.max(MIN_MERMAID_STAGE_HEIGHT, Math.ceil(contentHeight + MERMAID_STAGE_PADDING * 2));
  const columnStarts: number[] = [];
  const rowStarts: number[] = [];
  columnWidths.reduce((cursor, value, index) => {
    columnStarts[index] = cursor;
    return cursor + value + columnGap;
  }, (width - contentWidth) / 2);
  rowHeights.reduce((cursor, value, index) => {
    rowStarts[index] = cursor;
    return cursor + value + rowGap;
  }, (height - contentHeight) / 2);
  const positions = createSafeRecord<MermaidCanvasPoint>();
  graph.nodes.forEach((node, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const visualRow = reverse && !horizontal ? rows - row - 1 : row;
    const visualColumn = reverse && horizontal ? columns - column - 1 : column;
    const size = sizes[index];
    positions[node.id] = {
      x: roundCoordinate(columnStarts[visualColumn] + (columnWidths[visualColumn] - size.width) / 2),
      y: roundCoordinate(rowStarts[visualRow] + (rowHeights[visualRow] - size.height) / 2),
    };
  });
  return { positions, routes: createSafeRecord<MermaidCanvasEdgeRoute>(), width, height };
}

function feedbackEdgeIds(graph: MermaidFlowGraph) {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as MermaidFlowEdge[]]));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    outgoing.get(edge.from)?.push(edge);
  }
  const state = new Map<string, 0 | 1 | 2>();
  const feedback = new Set<string>();
  function visit(nodeId: string) {
    state.set(nodeId, 1);
    for (const edge of outgoing.get(nodeId) ?? []) {
      const targetState = state.get(edge.to) ?? 0;
      if (edge.from === edge.to || targetState === 1) feedback.add(edge.id);
      else if (targetState === 0) visit(edge.to);
    }
    state.set(nodeId, 2);
  }
  for (const node of graph.nodes) {
    if ((state.get(node.id) ?? 0) === 0) visit(node.id);
  }
  return feedback;
}

function feedbackRoute(
  edge: MermaidFlowEdge,
  graph: MermaidFlowGraph,
  positions: MermaidCanvasNodePositions,
  stage: Size,
  laneIndex: number,
): MermaidCanvasEdgeRoute | null {
  const fromNode = graph.nodes.find((node) => node.id === edge.from);
  const toNode = graph.nodes.find((node) => node.id === edge.to);
  const fromPosition = positions[edge.from];
  const toPosition = positions[edge.to];
  if (!fromNode || !toNode || !fromPosition || !toPosition) return null;
  const fromSize = mermaidCanvasNodeSize(fromNode, graph.kind);
  const toSize = mermaidCanvasNodeSize(toNode, graph.kind);
  const fromCenter = { x: fromPosition.x + fromSize.width / 2, y: fromPosition.y + fromSize.height / 2 };
  const toCenter = { x: toPosition.x + toSize.width / 2, y: toPosition.y + toSize.height / 2 };

  if (edge.from === edge.to) {
    const x = Math.min(stage.width - 20, fromPosition.x + fromSize.width + 54 + laneIndex * 18);
    const start = { x: fromPosition.x + fromSize.width, y: fromCenter.y - 14 };
    const end = { x: fromPosition.x + fromSize.width, y: fromCenter.y + 14 };
    return {
      points: [start, { x, y: start.y }, { x, y: end.y }, end],
      label: { x, y: fromCenter.y },
    };
  }

  const horizontal = graph.kind === 'mindmap' || graph.direction === 'LR' || graph.direction === 'RL';
  const lane = Math.floor(laneIndex / 2);
  const useLeadingSide = laneIndex % 2 === 0;
  if (horizontal) {
    const direction = toCenter.x < fromCenter.x ? -1 : 1;
    const start = {
      x: direction < 0 ? fromPosition.x : fromPosition.x + fromSize.width,
      y: fromCenter.y,
    };
    const end = {
      x: direction < 0 ? toPosition.x + toSize.width : toPosition.x,
      y: toCenter.y,
    };
    const nodeMinY = Math.min(...graph.nodes.map((node) => positions[node.id]?.y ?? stage.height));
    const nodeMaxY = Math.max(...graph.nodes.map((node) => {
      const position = positions[node.id];
      return position ? position.y + mermaidCanvasNodeSize(node, graph.kind).height : 0;
    }));
    const routeY = useLeadingSide
      ? Math.max(18, nodeMinY - 42 - lane * 24)
      : Math.min(stage.height - 18, nodeMaxY + 42 + lane * 24);
    const startOuterX = start.x + direction * 34;
    const endOuterX = end.x - direction * 34;
    return {
      points: [
        start,
        { x: startOuterX, y: start.y },
        { x: startOuterX, y: routeY },
        { x: endOuterX, y: routeY },
        { x: endOuterX, y: end.y },
        end,
      ],
      label: { x: (startOuterX + endOuterX) / 2, y: routeY },
    };
  }

  const direction = toCenter.y < fromCenter.y ? -1 : 1;
  const start = {
    x: fromCenter.x,
    y: direction < 0 ? fromPosition.y : fromPosition.y + fromSize.height,
  };
  const end = {
    x: toCenter.x,
    y: direction < 0 ? toPosition.y + toSize.height : toPosition.y,
  };
  const nodeMinX = Math.min(...graph.nodes.map((node) => positions[node.id]?.x ?? stage.width));
  const nodeMaxX = Math.max(...graph.nodes.map((node) => {
    const position = positions[node.id];
    return position ? position.x + mermaidCanvasNodeSize(node, graph.kind).width : 0;
  }));
  const routeX = useLeadingSide
    ? Math.max(18, nodeMinX - 42 - lane * 24)
    : Math.min(stage.width - 18, nodeMaxX + 42 + lane * 24);
  const startOuterY = start.y + direction * 34;
  const endOuterY = end.y - direction * 34;
  return {
    points: [
      start,
      { x: start.x, y: startOuterY },
      { x: routeX, y: startOuterY },
      { x: routeX, y: endOuterY },
      { x: end.x, y: endOuterY },
      end,
    ],
    label: { x: routeX, y: (startOuterY + endOuterY) / 2 },
  };
}

/**
 * Runs Dagre's cycle-aware layered layout. Dagre internally reverses a minimal
 * set of edges for ranking, performs crossing minimisation, and restores routed
 * edge direction afterwards. Node dimensions are real canvas dimensions, so
 * neither ranks nor siblings need to be compressed to fit a fixed stage.
 */
export function layoutMermaidGraph(graph: MermaidFlowGraph): MermaidCanvasLayout {
  if (!graph.nodes.length) {
    return {
      positions: createSafeRecord<MermaidCanvasPoint>(),
      routes: createSafeRecord<MermaidCanvasEdgeRoute>(),
      width: MIN_MERMAID_STAGE_WIDTH,
      height: MIN_MERMAID_STAGE_HEIGHT,
    };
  }
  if (graph.kind === 'sequence') return sequenceLayout(graph);

  const direction = graph.kind === 'mindmap' ? 'LR' : graph.direction === 'TD' ? 'TB' : graph.direction;
  const horizontal = direction === 'LR' || direction === 'RL';
  const dagreGraph = new Graph<DagreGraphLabel, DagreNodeLabel, DagreEdgeLabel>({ multigraph: true })
    .setGraph({
      rankdir: direction,
      ranker: 'network-simplex',
      acyclicer: 'greedy',
      nodesep: horizontal ? 62 : 76,
      edgesep: 28,
      ranksep: horizontal ? 116 : 98,
      marginx: 0,
      marginy: 0,
    })
    .setDefaultEdgeLabel(() => ({ width: 0, height: 0, labelpos: 'c' }));

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const nodeOrder = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const feedbackEdges = feedbackEdgeIds(graph);
  const dagreNodeIds = new Map<string, string>();
  graph.nodes.forEach((node, index) => {
    const dagreNodeId = `node:${index}`;
    dagreNodeIds.set(node.id, dagreNodeId);
    dagreGraph.setNode(dagreNodeId, mermaidCanvasNodeSize(node, graph.kind));
  });
  const edgeNames = new Map<string, string>();
  graph.edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return;
    if (feedbackEdges.has(edge.id)) return;
    const fromId = dagreNodeIds.get(edge.from);
    const toId = dagreNodeIds.get(edge.to);
    if (!fromId || !toId) return;
    const name = `edge:${index}`;
    edgeNames.set(name, edge.id);
    const sourceOrder = nodeOrder.get(edge.from) ?? index;
    const targetOrder = nodeOrder.get(edge.to) ?? index;
    dagreGraph.setEdge(fromId, toId, {
      ...edgeLabelSize(edge, graph.kind),
      labelpos: 'c',
      minlen: 1,
      // Mermaid declarations normally follow reading order. In a cycle, make
      // an explicit backwards declaration cheap to reverse so rejection/retry
      // paths wrap around the main flow instead of turning the main flow back.
      weight: sourceOrder <= targetOrder ? 8 : 1,
    }, name);
  });

  try {
    runDagreLayout(dagreGraph, {});
  } catch {
    return fallbackGridLayout(graph);
  }

  const graphLabel = dagreGraph.graph();
  const rawWidth = Math.max(1, graphLabel?.width ?? 0);
  const rawHeight = Math.max(1, graphLabel?.height ?? 0);
  const width = Math.max(MIN_MERMAID_STAGE_WIDTH, Math.ceil(rawWidth + MERMAID_STAGE_PADDING * 2));
  const height = Math.max(MIN_MERMAID_STAGE_HEIGHT, Math.ceil(rawHeight + MERMAID_STAGE_PADDING * 2));
  const offsetX = (width - rawWidth) / 2;
  const offsetY = (height - rawHeight) / 2;
  const positions = createSafeRecord<MermaidCanvasPoint>();
  graph.nodes.forEach((node) => {
    const dagreNodeId = dagreNodeIds.get(node.id);
    const layout = dagreNodeId ? dagreGraph.node(dagreNodeId) : undefined;
    const size = mermaidCanvasNodeSize(node, graph.kind);
    if (layout?.x === undefined || layout.y === undefined) return;
    positions[node.id] = {
      x: roundCoordinate(layout.x - size.width / 2 + offsetX),
      y: roundCoordinate(layout.y - size.height / 2 + offsetY),
    };
  });

  const routes = createSafeRecord<MermaidCanvasEdgeRoute>();
  dagreGraph.edges().forEach((edgeObject) => {
    const edgeId = edgeObject.name === undefined ? undefined : edgeNames.get(String(edgeObject.name));
    const route = dagreGraph.edge(edgeObject);
    if (!edgeId || !route?.points?.length) return;
    const points = route.points.map((point) => ({
      x: roundCoordinate(point.x + offsetX),
      y: roundCoordinate(point.y + offsetY),
    }));
    const middle = points[Math.floor(points.length / 2)];
    routes[edgeId] = {
      points,
      label: {
        x: roundCoordinate((route.x ?? middle.x - offsetX) + offsetX),
        y: roundCoordinate((route.y ?? middle.y - offsetY) + offsetY),
      },
    };
  });

  let feedbackIndex = 0;
  for (const edge of graph.edges) {
    if (!feedbackEdges.has(edge.id)) continue;
    const route = feedbackRoute(edge, graph, positions, { width, height }, feedbackIndex);
    if (route) routes[edge.id] = route;
    feedbackIndex += 1;
  }

  return { positions, routes, width, height };
}
