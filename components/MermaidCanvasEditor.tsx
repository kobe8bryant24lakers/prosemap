'use client';

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Circle,
  Database,
  Diamond,
  Link2,
  MousePointer2,
  Pencil,
  Plus,
  RefreshCcw,
  Square,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  nextMermaidNodeId,
  suggestGanttStart,
  type MermaidEdgeStyle,
  type MermaidFlowDirection,
  type MermaidFlowEdge,
  type MermaidFlowGraph,
  type MermaidFlowNode,
  type MermaidNodeShape,
} from '@/lib/mermaid-workbench';

type MermaidCanvasEditorProps = {
  active?: boolean;
  graph: MermaidFlowGraph;
  onChange: (graph: MermaidFlowGraph) => void;
};

type Point = { x: number; y: number };
type NodePositions = Record<string, Point>;
type Selection = { kind: 'node' | 'edge'; id: string } | null;
type DragState = { id: string; offsetX: number; offsetY: number };
type ConnectionDrag = { from: string; pointer: Point };
type NodeData = NonNullable<MermaidFlowNode['data']>;

const STAGE_WIDTH = 1440;
const STAGE_HEIGHT = 780;
const STAGE_PADDING = 70;

const SHAPE_OPTIONS: Array<{ value: MermaidNodeShape; label: string; icon: typeof Square }> = [
  { value: 'rectangle', label: '矩形', icon: Square },
  { value: 'rounded', label: '圆角', icon: Square },
  { value: 'terminal', label: '起止', icon: Circle },
  { value: 'decision', label: '判断', icon: Diamond },
  { value: 'circle', label: '圆形', icon: Circle },
  { value: 'database', label: '数据', icon: Database },
];

const EDGE_OPTIONS: Array<{ value: MermaidEdgeStyle; label: string }> = [
  { value: 'arrow', label: '箭头' },
  { value: 'line', label: '直线' },
  { value: 'dotted', label: '虚线' },
  { value: 'thick', label: '强调' },
];

const DIRECTION_OPTIONS: Array<{ value: MermaidFlowDirection; label: string; icon: typeof ArrowDown }> = [
  { value: 'TD', label: '向下', icon: ArrowDown },
  { value: 'LR', label: '向右', icon: ArrowRight },
  { value: 'BT', label: '向上', icon: ArrowUp },
  { value: 'RL', label: '向左', icon: ArrowLeft },
];

const KIND_COPY: Record<MermaidFlowGraph['kind'], {
  node: string;
  nodes: string;
  edge: string;
  edges: string;
  add: string;
  connect: string;
  empty: string;
  newLabel: string;
}> = {
  flowchart: { node: '节点', nodes: '节点', edge: '连线', edges: '连线', add: '节点', connect: '连线模式', empty: '添加第一个节点', newLabel: '新节点' },
  sequence: { node: '参与者', nodes: '参与者', edge: '消息', edges: '消息', add: '参与者', connect: '发送消息', empty: '添加第一个参与者', newLabel: '新参与者' },
  state: { node: '状态', nodes: '状态', edge: '转换', edges: '转换', add: '状态', connect: '添加转换', empty: '添加第一个状态', newLabel: '新状态' },
  class: { node: '类', nodes: '类', edge: '关系', edges: '关系', add: '类', connect: '添加关系', empty: '添加第一个类', newLabel: '新类' },
  er: { node: '实体', nodes: '实体', edge: '关系', edges: '关系', add: '实体', connect: '添加关系', empty: '添加第一个实体', newLabel: '新实体' },
  mindmap: { node: '主题', nodes: '主题', edge: '父子关系', edges: '父子关系', add: '主题', connect: '设置父子', empty: '添加根主题', newLabel: '新主题' },
  gantt: { node: '任务', nodes: '任务', edge: '依赖', edges: '依赖', add: '任务', connect: '添加依赖', empty: '添加第一个任务', newLabel: '新任务' },
};

const SEQUENCE_MESSAGE_OPTIONS = [
  { value: '->>', label: '实线消息' },
  { value: '-->>', label: '返回消息' },
  { value: '->', label: '开放箭头' },
  { value: '-->', label: '虚线开放箭头' },
  { value: '-)', label: '异步消息' },
  { value: '--)', label: '异步返回' },
  { value: '-x', label: '失败消息' },
  { value: '--x', label: '虚线失败' },
  { value: '<<->>', label: '双向消息' },
  { value: '<<-->>', label: '虚线双向' },
] as const;

const CLASS_RELATION_OPTIONS = [
  { value: '-->', label: '关联' },
  { value: '--', label: '连接' },
  { value: '<|--', label: '继承' },
  { value: '*--', label: '组合' },
  { value: 'o--', label: '聚合' },
  { value: '..>', label: '依赖' },
  { value: '..|>', label: '实现' },
  { value: '..', label: '虚线连接' },
] as const;

const ER_CARDINALITIES = [
  { value: 'one', label: '一' },
  { value: 'zero-one', label: '零或一' },
  { value: 'one-many', label: '一或多' },
  { value: 'zero-many', label: '零或多' },
] as const;

type ErCardinality = typeof ER_CARDINALITIES[number]['value'];

const ER_LEFT_TOKEN: Record<ErCardinality, string> = {
  one: '||',
  'zero-one': '|o',
  'one-many': '}|',
  'zero-many': '}o',
};

const ER_RIGHT_TOKEN: Record<ErCardinality, string> = {
  one: '||',
  'zero-one': 'o|',
  'one-many': '|{',
  'zero-many': 'o{',
};

const GANTT_STATUS_OPTIONS = [
  { value: 'active', label: '进行中' },
  { value: 'done', label: '已完成' },
  { value: 'crit', label: '关键' },
  { value: 'milestone', label: '里程碑' },
] as const;

function nodeSize(node: MermaidFlowNode, kind: MermaidFlowGraph['kind']) {
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

function clampPosition(node: MermaidFlowNode, point: Point, kind: MermaidFlowGraph['kind']): Point {
  const size = nodeSize(node, kind);
  return {
    x: Math.max(18, Math.min(STAGE_WIDTH - size.width - 18, point.x)),
    y: Math.max(18, Math.min(STAGE_HEIGHT - size.height - 18, point.y)),
  };
}

function autoLayout(graph: MermaidFlowGraph): NodePositions {
  if (!graph.nodes.length) return {};

  if (graph.kind === 'sequence') {
    const available = STAGE_WIDTH - STAGE_PADDING * 2;
    const step = graph.nodes.length > 1 ? Math.min(250, available / (graph.nodes.length - 1)) : 0;
    const used = step * Math.max(0, graph.nodes.length - 1);
    const start = STAGE_PADDING + (available - used) / 2;
    return Object.fromEntries(graph.nodes.map((node, index) => {
      const size = nodeSize(node, graph.kind);
      const center = graph.nodes.length === 1 ? STAGE_WIDTH / 2 : start + index * step;
      return [node.id, clampPosition(node, { x: center - size.width / 2, y: 58 }, graph.kind)];
    }));
  }

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to) continue;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const ranks = new Map(graph.nodes.map((node) => [node.id, 0]));
  const remainingIncoming = new Map(incoming);
  const queue = graph.nodes.filter((node) => remainingIncoming.get(node.id) === 0).map((node) => node.id);
  const processed = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (processed.has(id)) continue;
    processed.add(id);
    for (const target of outgoing.get(id) ?? []) {
      ranks.set(target, Math.max(ranks.get(target) ?? 0, (ranks.get(id) ?? 0) + 1));
      const nextIncoming = (remainingIncoming.get(target) ?? 1) - 1;
      remainingIncoming.set(target, nextIncoming);
      if (nextIncoming === 0) queue.push(target);
    }
  }

  let fallbackRank = Math.max(0, ...ranks.values());
  for (const node of graph.nodes) {
    if (processed.has(node.id)) continue;
    ranks.set(node.id, fallbackRank);
    fallbackRank += 1;
  }

  const groups = new Map<number, MermaidFlowNode[]>();
  for (const node of graph.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    groups.set(rank, [...(groups.get(rank) ?? []), node]);
  }
  const orderedRanks = Array.from(groups.keys()).sort((a, b) => a - b);
  const horizontal = graph.kind === 'mindmap' || graph.direction === 'LR' || graph.direction === 'RL';
  const reverse = graph.kind !== 'mindmap' && (graph.direction === 'BT' || graph.direction === 'RL');
  const mainAvailable = (horizontal ? STAGE_WIDTH : STAGE_HEIGHT) - STAGE_PADDING * 2;
  const mainStep = orderedRanks.length > 1 ? Math.min(horizontal ? 270 : 165, mainAvailable / (orderedRanks.length - 1)) : 0;
  const mainStart = STAGE_PADDING + (mainAvailable - mainStep * Math.max(0, orderedRanks.length - 1)) / 2;
  const positions: NodePositions = {};

  orderedRanks.forEach((rank, rankIndex) => {
    const nodes = groups.get(rank) ?? [];
    const visualRank = reverse ? orderedRanks.length - rankIndex - 1 : rankIndex;
    const main = orderedRanks.length === 1 ? STAGE_PADDING + mainAvailable / 2 : mainStart + visualRank * mainStep;
    const crossAvailable = (horizontal ? STAGE_HEIGHT : STAGE_WIDTH) - STAGE_PADDING * 2;
    const crossStep = nodes.length > 1 ? Math.min(horizontal ? 145 : 240, crossAvailable / (nodes.length - 1)) : 0;
    const crossStart = STAGE_PADDING + (crossAvailable - crossStep * Math.max(0, nodes.length - 1)) / 2;
    nodes.forEach((node, crossIndex) => {
      const size = nodeSize(node, graph.kind);
      const cross = nodes.length === 1 ? STAGE_PADDING + crossAvailable / 2 : crossStart + crossIndex * crossStep;
      positions[node.id] = clampPosition(node, horizontal
        ? { x: main - size.width / 2, y: cross - size.height / 2 }
        : { x: cross - size.width / 2, y: main - size.height / 2 }, graph.kind);
    });
  });
  return positions;
}

function edgeGeometry(edge: MermaidFlowEdge, graph: MermaidFlowGraph, positions: NodePositions, edgeIndex: number) {
  const fromNode = graph.nodes.find((node) => node.id === edge.from);
  const toNode = graph.nodes.find((node) => node.id === edge.to);
  const fromPosition = positions[edge.from];
  const toPosition = positions[edge.to];
  if (!fromNode || !toNode || !fromPosition || !toPosition) return null;

  const fromSize = nodeSize(fromNode, graph.kind);
  const toSize = nodeSize(toNode, graph.kind);
  const fromCenter = { x: fromPosition.x + fromSize.width / 2, y: fromPosition.y + fromSize.height / 2 };
  const toCenter = { x: toPosition.x + toSize.width / 2, y: toPosition.y + toSize.height / 2 };

  if (graph.kind === 'sequence') {
    const participantBottom = Math.max(...graph.nodes.map((node) => {
      const position = positions[node.id];
      return position ? position.y + nodeSize(node, graph.kind).height : 0;
    }));
    const firstRow = Math.max(190, participantBottom + 58);
    const available = Math.max(80, STAGE_HEIGHT - firstRow - 34);
    const step = Math.min(62, available / Math.max(1, graph.edges.length));
    const y = firstRow + edgeIndex * step;
    if (edge.from === edge.to) {
      const loopWidth = 72;
      const loopHeight = Math.min(34, Math.max(22, step * 0.62));
      return {
        path: `M ${fromCenter.x} ${y} C ${fromCenter.x + loopWidth} ${y}, ${fromCenter.x + loopWidth} ${y + loopHeight}, ${fromCenter.x} ${y + loopHeight}`,
        label: { x: fromCenter.x + loopWidth * 0.72, y: y - 9 },
      };
    }
    return {
      path: `M ${fromCenter.x} ${y} L ${toCenter.x} ${y}`,
      label: { x: (fromCenter.x + toCenter.x) / 2, y: y - 10 },
    };
  }
  if (edge.from === edge.to) {
    const loopWidth = Math.max(70, fromSize.width * 0.48);
    const loopHeight = Math.max(62, fromSize.height * 0.9);
    const startX = fromPosition.x + fromSize.width * 0.72;
    const startY = fromPosition.y;
    return {
      path: `M ${startX} ${startY} C ${startX + loopWidth} ${startY - loopHeight}, ${startX + loopWidth} ${startY + loopHeight}, ${startX} ${startY + 4}`,
      label: { x: startX + loopWidth * 0.78, y: startY - 12 },
    };
  }
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const fromFactor = 1 / Math.max(Math.abs(dx) / (fromSize.width / 2), Math.abs(dy) / (fromSize.height / 2), 1);
  const toFactor = 1 / Math.max(Math.abs(dx) / (toSize.width / 2), Math.abs(dy) / (toSize.height / 2), 1);
  const start = { x: fromCenter.x + dx * fromFactor, y: fromCenter.y + dy * fromFactor };
  const end = { x: toCenter.x - dx * toFactor, y: toCenter.y - dy * toFactor };
  const parallelEdges = graph.edges.filter((candidate) => (
    candidate.from === edge.from && candidate.to === edge.to
  ) || (
    candidate.from === edge.to && candidate.to === edge.from
  ));
  const parallelIndex = parallelEdges.findIndex((candidate) => candidate.id === edge.id);
  const parallelOffset = (parallelIndex - (parallelEdges.length - 1) / 2) * 28;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const path = horizontal
    ? `M ${start.x} ${start.y} C ${(start.x + end.x) / 2} ${start.y + parallelOffset}, ${(start.x + end.x) / 2} ${end.y + parallelOffset}, ${end.x} ${end.y}`
    : `M ${start.x} ${start.y} C ${start.x + parallelOffset} ${(start.y + end.y) / 2}, ${end.x + parallelOffset} ${(start.y + end.y) / 2}, ${end.x} ${end.y}`;
  return {
    path,
    label: horizontal
      ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 + parallelOffset }
      : { x: (start.x + end.x) / 2 + parallelOffset, y: (start.y + end.y) / 2 },
  };
}

function nextEdgeId(edges: MermaidFlowEdge[]) {
  let index = edges.length + 1;
  const existing = new Set(edges.map((edge) => edge.id));
  while (existing.has(`edge-${index}`)) index += 1;
  return `edge-${index}`;
}

function defaultNode(kind: MermaidFlowGraph['kind'], id: string, graph: MermaidFlowGraph, selectedNode: MermaidFlowNode | null): MermaidFlowNode {
  const base: MermaidFlowNode = { id, label: KIND_COPY[kind].newLabel, shape: 'rectangle' };
  if (kind === 'sequence') return { ...base, data: { ref: id, sequenceType: 'participant' } };
  if (kind === 'state') return { ...base, shape: 'rounded', data: { ref: id, stateRole: 'state' } };
  if (kind === 'class' || kind === 'er') return { ...base, data: { ref: id, details: [] } };
  if (kind === 'mindmap') return { ...base, shape: 'rounded', data: { ref: id, mindRoot: graph.nodes.length === 0 } };
  if (kind === 'gantt') {
    const fallbackSection = selectedNode?.data?.ganttSection
      ?? [...graph.nodes].reverse().find((node) => node.data?.ganttSection)?.data?.ganttSection
      ?? '未分组';
    return {
      ...base,
      data: {
        ref: id,
        ganttSection: fallbackSection,
        ganttStatuses: [],
        ganttStart: graph.nodes.length ? '' : suggestGanttStart(graph),
        ganttTiming: ['1d'],
      },
    };
  }
  return base;
}

function defaultEdge(kind: MermaidFlowGraph['kind'], id: string, from: string, to: string): MermaidFlowEdge {
  if (kind === 'sequence') return { id, from, to, label: '新消息', style: 'arrow', data: { token: '->>' } };
  if (kind === 'state') return { id, from, to, label: '', style: 'arrow', data: { token: '-->' } };
  if (kind === 'class') return { id, from, to, label: '', style: 'arrow', data: { token: '-->' } };
  if (kind === 'er') return { id, from, to, label: '', style: 'line', data: { token: '||--o{' } };
  if (kind === 'mindmap') return { id, from, to, label: '', style: 'line', data: { token: 'child' } };
  if (kind === 'gantt') return { id, from, to, label: '', style: 'dotted', data: { token: 'after' } };
  return { id, from, to, label: '', style: 'arrow' };
}

function parseClassToken(token = '-->') {
  const match = token.match(/^(?:"([^"]*)"\s+)?(<\|--|\*--|o--|-->|--|\.\.\|>|\.\.>|\.\.)(?:\s+"([^"]*)")?$/);
  return {
    fromMultiplicity: match?.[1],
    relation: match?.[2] ?? '-->',
    toMultiplicity: match?.[3],
  };
}

function classRelationLabel(token = '-->') {
  const relation = parseClassToken(token).relation;
  return CLASS_RELATION_OPTIONS.find((option) => option.value === relation)?.label ?? relation;
}

function replaceClassRelation(token: string | undefined, relation: string) {
  const parsed = parseClassToken(token);
  return `${parsed.fromMultiplicity ? `"${parsed.fromMultiplicity}" ` : ''}${relation}${parsed.toMultiplicity ? ` "${parsed.toMultiplicity}"` : ''}`;
}

function reverseClassToken(token?: string) {
  const parsed = parseClassToken(token);
  return `${parsed.toMultiplicity ? `"${parsed.toMultiplicity}" ` : ''}${parsed.relation}${parsed.fromMultiplicity ? ` "${parsed.fromMultiplicity}"` : ''}`;
}

function parseErToken(token = '||--o{'): { from: ErCardinality; to: ErCardinality; identifying: boolean } {
  const match = token.match(/^(\|\||\|o|\}\||\}o)(--|\.\.)(\|\||o\||\|\{|o\{)$/);
  if (!match) return { from: 'one', to: 'zero-many', identifying: true };
  const from = (Object.entries(ER_LEFT_TOKEN).find(([, value]) => value === match[1])?.[0] ?? 'one') as ErCardinality;
  const to = (Object.entries(ER_RIGHT_TOKEN).find(([, value]) => value === match[3])?.[0] ?? 'zero-many') as ErCardinality;
  return { from, to, identifying: match[2] === '--' };
}

function makeErToken(from: ErCardinality, to: ErCardinality, identifying: boolean) {
  return `${ER_LEFT_TOKEN[from]}${identifying ? '--' : '..'}${ER_RIGHT_TOKEN[to]}`;
}

function reverseErToken(token?: string) {
  const parsed = parseErToken(token);
  return makeErToken(parsed.to, parsed.from, parsed.identifying);
}

function erRelationLabel(token?: string) {
  const parsed = parseErToken(token);
  const from = ER_CARDINALITIES.find((option) => option.value === parsed.from)?.label;
  const to = ER_CARDINALITIES.find((option) => option.value === parsed.to)?.label;
  return `${from} → ${to}`;
}

function nodeMeta(node: MermaidFlowNode, kind: MermaidFlowGraph['kind']) {
  if (kind === 'sequence') return node.data?.sequenceType === 'actor' ? '角色' : '参与者';
  if (kind === 'state') {
    if (node.data?.stateRole === 'start') return '开始状态';
    if (node.data?.stateRole === 'end') return '结束状态';
    return '状态';
  }
  if (kind === 'class') return `类 · ${node.data?.ref ?? node.id}`;
  if (kind === 'er') return `实体 · ${node.data?.ref ?? node.id}`;
  if (kind === 'mindmap') return node.data?.mindRoot ? '根主题' : '子主题';
  if (kind === 'gantt') {
    const statuses = node.data?.ganttStatuses ?? [];
    const status = statuses.includes('done') ? '已完成' : statuses.includes('active') ? '进行中' : statuses.includes('milestone') ? '里程碑' : '任务';
    return `${node.data?.ganttSection || '未分组'} · ${status}`;
  }
  return node.id;
}

function connectionWouldCycle(edges: MermaidFlowEdge[], from: string, to: string) {
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

function nextSemanticRef(nodes: MermaidFlowNode[], prefix: string) {
  const used = new Set(nodes.flatMap((node) => [node.id, node.data?.ref].filter((value): value is string => Boolean(value))));
  let index = nodes.length + 1;
  while (used.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

function ensureGanttStarts(graph: MermaidFlowGraph, nodes: MermaidFlowNode[], edges: MermaidFlowEdge[]) {
  const candidateGraph = { ...graph, nodes, edges };
  const fallbackStart = suggestGanttStart(candidateGraph) || suggestGanttStart(graph);
  if (!fallbackStart) return nodes;
  const dependentIds = new Set(edges.map((edge) => edge.to));
  return nodes.map((node) => dependentIds.has(node.id) || node.data?.ganttStart
    ? node
    : { ...node, data: { ...node.data, ganttStart: fallbackStart } });
}

export default function MermaidCanvasEditor({ active = true, graph, onChange }: MermaidCanvasEditorProps) {
  const markerId = `canvas-arrow-${useId().replace(/:/g, '')}`;
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<NodePositions>(() => autoLayout(graph));
  const [selection, setSelection] = useState<Selection>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDrag | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.9);
  const nodeSignature = graph.nodes.map((node) => node.id).join('|');
  const previousGraphShape = useRef({ kind: graph.kind, direction: graph.direction, nodeSignature });
  const shouldCenterViewport = useRef(true);
  const wasActive = useRef(active);
  const lastNodePointerAt = useRef(0);

  useEffect(() => {
    const previous = previousGraphShape.current;
    const kindChanged = previous.kind !== graph.kind;
    const directionChanged = previous.direction !== graph.direction;
    const nodesChanged = previous.nodeSignature !== nodeSignature;
    previousGraphShape.current = { kind: graph.kind, direction: graph.direction, nodeSignature };
    if (kindChanged || directionChanged || nodesChanged) {
      shouldCenterViewport.current = true;
    }
    if (kindChanged) {
      setSelection(null);
      setEditingNodeId(null);
      setEditingEdgeId(null);
      setDragging(null);
      setConnectionDrag(null);
      setConnectMode(false);
      setConnectingFrom(null);
    }
    setPositions((current) => {
      const laidOut = autoLayout(graph);
      if (kindChanged || directionChanged || !Object.keys(current).length) return laidOut;
      const next: NodePositions = {};
      for (const node of graph.nodes) next[node.id] = current[node.id] ?? laidOut[node.id];
      return next;
    });
    setSelection((current) => {
      if (!current) return null;
      if (current.kind === 'node' && !graph.nodes.some((node) => node.id === current.id)) return null;
      if (current.kind === 'edge' && !graph.edges.some((edge) => edge.id === current.id)) return null;
      return current;
    });
  }, [graph, nodeSignature]);

  useLayoutEffect(() => {
    if (active && !wasActive.current) shouldCenterViewport.current = true;
    wasActive.current = active;
    if (!active || !shouldCenterViewport.current) return;
    const viewport = viewportRef.current;
    if (!viewport || !viewport.clientWidth || !viewport.clientHeight) return;
    const visibleNodes = graph.nodes.filter((node) => positions[node.id]);
    if (!visibleNodes.length) {
      viewport.scrollLeft = Math.max(0, (STAGE_WIDTH * zoom - viewport.clientWidth) / 2);
      viewport.scrollTop = Math.max(0, (STAGE_HEIGHT * zoom - viewport.clientHeight) / 2);
      shouldCenterViewport.current = false;
      return;
    }
    const minX = Math.min(...visibleNodes.map((node) => positions[node.id].x));
    const minY = Math.min(...visibleNodes.map((node) => positions[node.id].y));
    const maxX = Math.max(...visibleNodes.map((node) => positions[node.id].x + nodeSize(node, graph.kind).width));
    const maxY = Math.max(...visibleNodes.map((node) => positions[node.id].y + nodeSize(node, graph.kind).height));
    const contentWidth = (maxX - minX) * zoom;
    const contentHeight = (maxY - minY) * zoom;
    viewport.scrollLeft = Math.max(0, contentWidth <= viewport.clientWidth - 40
      ? ((minX + maxX) / 2) * zoom - viewport.clientWidth / 2
      : minX * zoom - 32);
    viewport.scrollTop = Math.max(0, contentHeight <= viewport.clientHeight - 40
      ? ((minY + maxY) / 2) * zoom - viewport.clientHeight / 2
      : minY * zoom - 26);
    shouldCenterViewport.current = false;
  }, [active, graph.kind, graph.nodes, positions, zoom]);

  useEffect(() => {
    if (!dragging && !connectionDrag) return;

    function canvasPoint(clientX: number, clientY: number) {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
    }

    function handlePointerMove(event: PointerEvent) {
      const point = canvasPoint(event.clientX, event.clientY);
      if (dragging) {
        lastNodePointerAt.current = performance.now();
        const node = graph.nodes.find((candidate) => candidate.id === dragging.id);
        if (!node) return;
        setPositions((current) => ({
          ...current,
          [dragging.id]: clampPosition(node, { x: point.x - dragging.offsetX, y: point.y - dragging.offsetY }, graph.kind),
        }));
      }
      if (connectionDrag) setConnectionDrag((current) => current ? { ...current, pointer: point } : null);
    }

    function handlePointerUp(event: PointerEvent) {
      setDragging(null);
      if (!connectionDrag) return;
      const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const target = element?.closest<HTMLElement>('[data-mermaid-node-id]')?.dataset.mermaidNodeId;
      if (target && (target !== connectionDrag.from || (graph.kind !== 'mindmap' && graph.kind !== 'gantt'))) {
        addConnection(connectionDrag.from, target);
      }
      setConnectionDrag(null);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  });

  const selectedNode = selection?.kind === 'node' ? graph.nodes.find((node) => node.id === selection.id) ?? null : null;
  const selectedEdge = selection?.kind === 'edge' ? graph.edges.find((edge) => edge.id === selection.id) ?? null : null;
  const copy = KIND_COPY[graph.kind];
  const selectedErRelation = selectedEdge && graph.kind === 'er' ? parseErToken(selectedEdge.data?.token) : null;
  const selectedSequenceIndex = selectedEdge && graph.kind === 'sequence' ? graph.edges.findIndex((edge) => edge.id === selectedEdge.id) : -1;
  const selectedGanttHasDependency = Boolean(selectedNode && graph.kind === 'gantt'
    && graph.edges.some((edge) => edge.to === selectedNode.id));
  const selectedGanttStart = selectedNode && graph.kind === 'gantt' && !selectedGanttHasDependency
    ? selectedNode.data?.ganttStart || suggestGanttStart(graph)
    : selectedNode?.data?.ganttStart ?? '';
  const selectedNodeIncoming = selectedNode ? graph.edges.filter((edge) => edge.to === selectedNode.id).length : 0;
  const selectedNodeOutgoing = selectedNode ? graph.edges.filter((edge) => edge.from === selectedNode.id).length : 0;
  const selectedEdgeTouchesStatePseudo = Boolean(selectedEdge && graph.kind === 'state'
    && graph.nodes.some((node) => (node.id === selectedEdge.from || node.id === selectedEdge.to)
      && node.data?.stateRole !== 'state'));
  const mindmapRoot = graph.kind === 'mindmap' ? graph.nodes.find((node) => node.data?.mindRoot) : null;
  const canRenameSelectedNode = Boolean(selectedNode
    && !(graph.kind === 'state' && selectedNode.data?.stateRole !== 'state'));
  const canReverseSelectedEdge = Boolean(selectedEdge && graph.kind !== 'mindmap' && !selectedEdgeTouchesStatePseudo);
  const canRemoveSelectedEdge = Boolean(selectedEdge
    && !(graph.kind === 'mindmap' && selectedEdge.from === mindmapRoot?.id)
    && !selectedEdgeTouchesStatePseudo);
  const edgeSupportsLabel = graph.kind === 'flowchart' || graph.kind === 'sequence' || graph.kind === 'state' || graph.kind === 'class' || graph.kind === 'er';
  const edgeGeometries = useMemo(() => new Map(graph.edges.map((edge, index) => [edge.id, edgeGeometry(edge, graph, positions, index)])), [graph, positions]);

  function pointFromEvent(event: { clientX: number; clientY: number }): Point {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2 };
    return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
  }

  function addConnection(from: string, to: string) {
    const fromNode = graph.nodes.find((node) => node.id === from);
    const toNode = graph.nodes.find((node) => node.id === to);
    if (!fromNode || !toNode) return;
    if (from === to && (graph.kind === 'mindmap' || graph.kind === 'gantt')) return;
    if ((graph.kind === 'mindmap' || graph.kind === 'gantt') && connectionWouldCycle(graph.edges, from, to)) return;
    if (graph.kind === 'gantt' && graph.edges.some((edge) => edge.from === from && edge.to === to)) return;
    if (graph.kind === 'state') {
      if (fromNode.data?.stateRole === 'end' || toNode.data?.stateRole === 'start') return;
      if (fromNode.data?.stateRole === 'start' && graph.edges.some((edge) => edge.from === from)) return;
      if (toNode.data?.stateRole === 'end' && graph.edges.some((edge) => edge.to === to)) return;
    }
    const edge = defaultEdge(graph.kind, nextEdgeId(graph.edges), from, to);
    const edges = graph.kind === 'mindmap'
      ? [...graph.edges.filter((candidate) => candidate.to !== to), edge]
      : [...graph.edges, edge];
    const nodes = graph.kind === 'mindmap'
      ? graph.nodes.map((node) => node.id === to ? { ...node, data: { ...node.data, mindRoot: false } } : node)
      : graph.kind === 'gantt'
        ? graph.nodes.map((node) => node.id === to ? { ...node, data: { ...node.data, ganttStart: '' } } : node)
      : graph.nodes;
    onChange({ ...graph, nodes, edges });
    setSelection({ kind: 'edge', id: edge.id });
    setConnectingFrom(connectMode ? to : null);
  }

  function addNode(point?: Point, options?: { parentId?: string }) {
    const prefix = graph.kind === 'sequence' ? 'Participant'
      : graph.kind === 'state' ? 'State'
        : graph.kind === 'class' ? 'Class'
          : graph.kind === 'er' ? 'ENTITY'
            : graph.kind === 'mindmap' ? 'Mind'
              : graph.kind === 'gantt' ? 'Task' : 'N';
    const id = nextMermaidNodeId(graph.nodes, prefix);
    const node = defaultNode(graph.kind, id, graph, selectedNode);
    const automaticMindParent = graph.kind === 'mindmap' && graph.nodes.length
      ? selectedNode?.id ?? graph.nodes.find((candidate) => candidate.data?.mindRoot)?.id ?? graph.nodes[0].id
      : undefined;
    const automaticGanttParent = graph.kind === 'gantt' && graph.nodes.length
      ? selectedNode?.id ?? graph.nodes.at(-1)?.id
      : undefined;
    const parentId = options?.parentId ?? automaticMindParent ?? automaticGanttParent;
    const parentPosition = parentId ? positions[parentId] : undefined;
    const fallbackIndex = graph.nodes.length;
    const size = nodeSize(node, graph.kind);
    const fallback = parentPosition
      ? { x: parentPosition.x + 250, y: parentPosition.y + ((fallbackIndex % 3) - 1) * 92 }
      : { x: STAGE_WIDTH / 2 - size.width / 2 + (fallbackIndex % 4) * 18, y: STAGE_HEIGHT / 2 - size.height / 2 + (fallbackIndex % 4) * 18 };
    const nextGraph: MermaidFlowGraph = {
      ...graph,
      nodes: [...graph.nodes, node],
      edges: parentId ? [...graph.edges, defaultEdge(graph.kind, nextEdgeId(graph.edges), parentId, id)] : graph.edges,
    };
    setPositions((current) => graph.kind === 'sequence'
      ? autoLayout(nextGraph)
      : { ...current, [id]: clampPosition(node, point ? { x: point.x - size.width / 2, y: point.y - size.height / 2 } : fallback, graph.kind) });
    onChange(nextGraph);
    setSelection({ kind: 'node', id });
    setEditingNodeId(id);
    setEditingEdgeId(null);
  }

  function removeSelection() {
    if (!selection) return;
    if (selection.kind === 'node') {
      const removedNode = graph.nodes.find((node) => node.id === selection.id);
      if (!removedNode || ((graph.kind === 'mindmap' || graph.kind === 'gantt') && graph.nodes.length === 1)) return;
      let nodes = graph.nodes.filter((node) => node.id !== selection.id);
      let edges = graph.edges.filter((edge) => edge.from !== selection.id && edge.to !== selection.id);
      if (graph.kind === 'mindmap' && nodes.length) {
        const childIds = graph.edges.filter((edge) => edge.from === selection.id).map((edge) => edge.to);
        const previousParentId = graph.edges.find((edge) => edge.to === selection.id)?.from;
        let rootId = nodes.find((node) => node.data?.mindRoot)?.id;
        if (removedNode.data?.mindRoot || !rootId) {
          const incoming = new Set(edges.map((edge) => edge.to));
          rootId = childIds.find((id) => nodes.some((node) => node.id === id) && !incoming.has(id))
            ?? nodes.find((node) => !incoming.has(node.id))?.id
            ?? nodes[0].id;
          nodes = nodes.map((node) => ({ ...node, data: { ...node.data, mindRoot: node.id === rootId } }));
        }
        const attachTo = previousParentId && nodes.some((node) => node.id === previousParentId) ? previousParentId : rootId;
        if (attachTo) {
          const incoming = new Set(edges.map((edge) => edge.to));
          const rootsToAttach = removedNode.data?.mindRoot
            ? nodes.filter((node) => node.id !== rootId && !incoming.has(node.id)).map((node) => node.id)
            : childIds.filter((id) => id !== attachTo && nodes.some((node) => node.id === id) && !incoming.has(id));
          for (const childId of rootsToAttach) {
            const edge = defaultEdge('mindmap', nextEdgeId(edges), attachTo, childId);
            edges = [...edges, edge];
            incoming.add(childId);
          }
        }
      }
      if (graph.kind === 'state') {
        const validPseudoIds = new Set(nodes.filter((node) => {
          if (node.data?.stateRole === 'state') return true;
          const incoming = edges.filter((edge) => edge.to === node.id).length;
          const outgoing = edges.filter((edge) => edge.from === node.id).length;
          return node.data?.stateRole === 'start' ? incoming === 0 && outgoing === 1 : incoming === 1 && outgoing === 0;
        }).map((node) => node.id));
        nodes = nodes.filter((node) => validPseudoIds.has(node.id));
        edges = edges.filter((edge) => validPseudoIds.has(edge.from) && validPseudoIds.has(edge.to));
      }
      if (graph.kind === 'gantt') nodes = ensureGanttStarts(graph, nodes, edges);
      onChange({
        ...graph,
        nodes,
        edges,
      });
    } else {
      const edge = graph.edges.find((candidate) => candidate.id === selection.id);
      if (!edge) return;
      if (graph.kind === 'mindmap') {
        const root = graph.nodes.find((node) => node.data?.mindRoot);
        if (!root || edge.from === root.id) return;
        onChange({
          ...graph,
          edges: graph.edges.map((candidate) => candidate.id === edge.id ? { ...candidate, from: root.id } : candidate),
        });
      } else {
        if (graph.kind === 'state' && selectedEdgeTouchesStatePseudo) return;
        const edges = graph.edges.filter((candidate) => candidate.id !== edge.id);
        const nodes = graph.kind === 'gantt' ? ensureGanttStarts(graph, graph.nodes, edges) : graph.nodes;
        onChange({ ...graph, nodes, edges });
      }
    }
    setSelection(null);
    setEditingNodeId(null);
    setEditingEdgeId(null);
  }

  function updateNode(id: string, update: Partial<MermaidFlowNode>) {
    onChange({ ...graph, nodes: graph.nodes.map((node) => node.id === id ? { ...node, ...update } : node) });
  }

  function updateEdge(id: string, update: Partial<MermaidFlowEdge>) {
    onChange({ ...graph, edges: graph.edges.map((edge) => edge.id === id ? { ...edge, ...update } : edge) });
  }

  function updateNodeData(id: string, update: Partial<NodeData>) {
    onChange({
      ...graph,
      nodes: graph.nodes.map((node) => node.id === id ? { ...node, data: { ...node.data, ...update } } : node),
    });
  }

  function updateEdgeToken(id: string, token: string) {
    onChange({
      ...graph,
      edges: graph.edges.map((edge) => {
        if (edge.id !== id) return edge;
        const style: MermaidEdgeStyle = graph.kind === 'sequence'
          ? token.includes('--') ? 'dotted' : 'arrow'
          : graph.kind === 'class'
            ? parseClassToken(token).relation.startsWith('..')
              ? 'dotted'
              : parseClassToken(token).relation === '--' ? 'line' : 'arrow'
            : edge.style;
        return { ...edge, style, data: { ...edge.data, token } };
      }),
    });
  }

  function moveEdge(id: string, offset: -1 | 1) {
    const index = graph.edges.findIndex((edge) => edge.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= graph.edges.length) return;
    const edges = [...graph.edges];
    [edges[index], edges[target]] = [edges[target], edges[index]];
    onChange({ ...graph, edges });
  }

  function reverseSelectedEdge() {
    if (!selectedEdge) return;
    if (graph.kind === 'mindmap' || selectedEdgeTouchesStatePseudo) return;
    const otherEdges = graph.edges.filter((edge) => edge.id !== selectedEdge.id);
    if (graph.kind === 'gantt' && (
      otherEdges.some((edge) => edge.from === selectedEdge.to && edge.to === selectedEdge.from)
      || connectionWouldCycle(otherEdges, selectedEdge.to, selectedEdge.from)
    )) return;
    const token = graph.kind === 'er'
      ? reverseErToken(selectedEdge.data?.token)
      : graph.kind === 'class' ? reverseClassToken(selectedEdge.data?.token) : selectedEdge.data?.token;
    let nodes = graph.nodes;
    const edges = graph.edges.map((edge) => edge.id === selectedEdge.id
      ? { ...edge, from: edge.to, to: edge.from, data: token ? { ...edge.data, token } : edge.data }
      : edge);
    if (graph.kind === 'gantt') {
      nodes = nodes.map((node) => node.id === selectedEdge.from
        ? { ...node, data: { ...node.data, ganttStart: '' } }
        : node);
      nodes = ensureGanttStarts(graph, nodes, edges);
    }
    onChange({
      ...graph,
      nodes,
      edges,
    });
  }

  function toggleGanttStatus(id: string, status: string) {
    const node = graph.nodes.find((candidate) => candidate.id === id);
    const statuses = node?.data?.ganttStatuses ?? [];
    updateNodeData(id, { ganttStatuses: statuses.includes(status) ? statuses.filter((value) => value !== status) : [...statuses, status] });
  }

  function updateGanttTiming(id: string, index: number, value: string) {
    const node = graph.nodes.find((candidate) => candidate.id === id);
    const timing = [...(node?.data?.ganttTiming ?? [])];
    timing[index] = value;
    while (timing.length && !timing[timing.length - 1]) timing.pop();
    updateNodeData(id, { ganttTiming: timing });
  }

  function changeStateRole(id: string, role: 'start' | 'end' | 'state') {
    const node = graph.nodes.find((candidate) => candidate.id === id);
    if (!node || graph.kind !== 'state') return;
    const incoming = graph.edges.filter((edge) => edge.to === id).length;
    const outgoing = graph.edges.filter((edge) => edge.from === id).length;
    if (role === 'start' && (incoming !== 0 || outgoing !== 1)) return;
    if (role === 'end' && (incoming !== 1 || outgoing !== 0)) return;
    const wasPseudo = node.data?.stateRole === 'start' || node.data?.stateRole === 'end';
    const ref = role === 'state'
      ? wasPseudo ? nextSemanticRef(graph.nodes, 'State') : node.data?.ref ?? node.id
      : '[*]';
    setEditingNodeId(null);
    onChange({
      ...graph,
      nodes: graph.nodes.map((candidate) => candidate.id === id ? {
        ...candidate,
        label: role === 'start' ? '开始' : role === 'end' ? '结束' : candidate.label,
        shape: role === 'state' ? 'rounded' : 'circle',
        data: { ...candidate.data, ref, stateRole: role },
      } : candidate),
    });
  }

  function handleNodePointerDown(event: ReactPointerEvent<HTMLDivElement>, node: MermaidFlowNode) {
    if (event.button !== 0 || editingNodeId === node.id || connectMode) return;
    lastNodePointerAt.current = performance.now();
    event.stopPropagation();
    editorRef.current?.focus({ preventScroll: true });
    const point = pointFromEvent(event);
    const position = positions[node.id] ?? { x: 0, y: 0 };
    setSelection({ kind: 'node', id: node.id });
    setEditingEdgeId(null);
    setDragging({ id: node.id, offsetX: point.x - position.x, offsetY: point.y - position.y });
  }

  function handleNodeClick(event: ReactMouseEvent<HTMLDivElement>, node: MermaidFlowNode) {
    event.stopPropagation();
    if (connectMode) {
      if (connectingFrom && (connectingFrom !== node.id || (graph.kind !== 'mindmap' && graph.kind !== 'gantt'))) {
        addConnection(connectingFrom, node.id);
        return;
      }
      setConnectingFrom(node.id);
    }
    setSelection({ kind: 'node', id: node.id });
    setEditingEdgeId(null);
  }

  function handleCanvasDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (performance.now() - lastNodePointerAt.current < 750
      || target.closest('[data-mermaid-node-id], [data-mermaid-edge-id], .canvas-edge-label')) return;
    addNode(pointFromEvent(event));
  }

  function handleEditorKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const isControl = target.matches('input, textarea, select, button') || target.isContentEditable;
    if (event.key === 'Escape' && isControl) {
      const isFormControl = target.matches('input, textarea, select') || target.isContentEditable;
      const hasCanvasState = Boolean(connectionDrag || connectingFrom || connectMode || editingNodeId || editingEdgeId || selection);
      if (!isFormControl && !hasCanvasState) return;
      event.preventDefault();
      event.stopPropagation();
      target.blur();
      setEditingNodeId(null);
      setEditingEdgeId(null);
      return;
    }
    if (isControl) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && selection) {
      event.preventDefault();
      removeSelection();
    } else if (event.key === 'Enter' && selection?.kind === 'node'
      && !(graph.kind === 'state' && selectedNode?.data?.stateRole !== 'state')) {
      event.preventDefault();
      setEditingNodeId(selection.id);
    } else if (event.key === 'Enter' && selection?.kind === 'edge') {
      event.preventDefault();
      setEditingEdgeId(selection.id);
    } else if (event.key === 'Escape') {
      const hasCanvasState = Boolean(connectionDrag || connectingFrom || connectMode || editingNodeId || editingEdgeId || selection);
      if (!hasCanvasState) return;
      event.preventDefault();
      event.stopPropagation();
      setConnectionDrag(null);
      setConnectingFrom(null);
      setConnectMode(false);
      setEditingNodeId(null);
      setEditingEdgeId(null);
      setSelection(null);
    }
  }

  function startConnectionDrag(event: ReactPointerEvent<HTMLButtonElement>, nodeId: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelection({ kind: 'node', id: nodeId });
    setConnectionDrag({ from: nodeId, pointer: pointFromEvent(event) });
  }

  function changeZoom(nextZoom: number) {
    shouldCenterViewport.current = true;
    setZoom(Math.max(0.55, Math.min(1.4, Math.round(nextZoom * 10) / 10)));
  }

  return (
    <div className="mermaid-canvas-editor" ref={editorRef} tabIndex={0} onKeyDown={handleEditorKeyDown}>
      <div className="canvas-editor-toolbar">
        <div className="canvas-tool-group primary-tools">
          <button type="button" onClick={() => addNode()}><Plus size={15} /> {copy.add}</button>
          <button
            type="button"
            className={connectMode ? 'active' : ''}
            onClick={() => { setConnectMode((value) => !value); setConnectingFrom(null); }}
            aria-pressed={connectMode}
          >
            <Link2 size={15} /> {copy.connect}
          </button>
          <button type="button" onClick={() => { shouldCenterViewport.current = true; setPositions(autoLayout(graph)); }} title={`重新排列${copy.nodes}`}><RefreshCcw size={14} /> 自动排列</button>
        </div>

        {graph.kind === 'flowchart' || graph.kind === 'state' ? (
          <div className="canvas-direction-tools" role="group" aria-label="图表方向">
            {DIRECTION_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                type="button"
                key={value}
                className={graph.direction === value ? 'active' : ''}
                onClick={() => onChange({ ...graph, direction: value })}
                aria-label={label}
                title={label}
              >
                <Icon size={14} /><span>{label}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="canvas-zoom-tools">
          <button type="button" onClick={() => changeZoom(zoom - 0.1)} aria-label="缩小画布"><ZoomOut size={15} /></button>
          <button type="button" onClick={() => changeZoom(1)} title="恢复 100%">{Math.round(zoom * 100)}%</button>
          <button type="button" onClick={() => changeZoom(zoom + 0.1)} aria-label="放大画布"><ZoomIn size={15} /></button>
        </div>
      </div>

      <div className="canvas-context-bar" aria-live="polite">
        {selectedNode ? (
          <>
            <span className="canvas-selection-title"><MousePointer2 size={13} /><b>{selectedNode.label || selectedNode.id}</b></span>
            <span className="canvas-context-divider" />
            {canRenameSelectedNode ? <button type="button" onClick={() => setEditingNodeId(selectedNode.id)}><Pencil size={13} /> 改名</button> : null}
            {graph.kind === 'flowchart' ? (
              <div className="canvas-shape-tools" role="group" aria-label="节点形状">
                {SHAPE_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <button
                    type="button"
                    key={value}
                    className={selectedNode.shape === value ? 'active' : ''}
                    onClick={() => updateNode(selectedNode.id, { shape: value })}
                    title={label}
                    aria-label={label}
                  >
                    <Icon size={13} /><span>{label}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {graph.kind === 'sequence' ? (
              <div className="canvas-semantic-tools" role="group" aria-label="参与者类型">
                <button type="button" className={selectedNode.data?.sequenceType === 'actor' ? 'active' : ''} onClick={() => updateNodeData(selectedNode.id, { sequenceType: 'actor' })}>角色</button>
                <button type="button" className={selectedNode.data?.sequenceType !== 'actor' ? 'active' : ''} onClick={() => updateNodeData(selectedNode.id, { sequenceType: 'participant' })}>参与者</button>
              </div>
            ) : null}
            {graph.kind === 'state' ? (
              <div className="canvas-semantic-tools" role="group" aria-label="状态类型">
                <button type="button" className={selectedNode.data?.stateRole === 'state' ? 'active' : ''} onClick={() => changeStateRole(selectedNode.id, 'state')}>普通状态</button>
                <button type="button" className={selectedNode.data?.stateRole === 'start' ? 'active' : ''} disabled={selectedNode.data?.stateRole !== 'start' && (selectedNodeIncoming !== 0 || selectedNodeOutgoing !== 1)} onClick={() => changeStateRole(selectedNode.id, 'start')}>开始</button>
                <button type="button" className={selectedNode.data?.stateRole === 'end' ? 'active' : ''} disabled={selectedNode.data?.stateRole !== 'end' && (selectedNodeIncoming !== 1 || selectedNodeOutgoing !== 0)} onClick={() => changeStateRole(selectedNode.id, 'end')}>结束</button>
              </div>
            ) : null}
            {graph.kind === 'mindmap' ? (
              <button type="button" onClick={() => addNode(undefined, { parentId: selectedNode.id })}><Plus size={13} /> 子主题</button>
            ) : null}
            {graph.kind === 'gantt' ? <button type="button" onClick={() => addNode()}><Plus size={13} /> 同组任务</button> : null}
            <button type="button" className="danger" disabled={(graph.kind === 'mindmap' || graph.kind === 'gantt') && graph.nodes.length === 1} onClick={removeSelection}><Trash2 size={13} /> 删除</button>
          </>
        ) : selectedEdge ? (
          <>
            <span className="canvas-selection-title"><Link2 size={13} /><b>{selectedEdge.label || `已选${copy.edge}`}</b></span>
            <span className="canvas-context-divider" />
            {edgeSupportsLabel ? <button type="button" onClick={() => setEditingEdgeId(selectedEdge.id)}><Pencil size={13} /> {selectedEdge.label ? `改${graph.kind === 'sequence' ? '消息' : '说明'}` : `加${graph.kind === 'sequence' ? '消息' : '说明'}`}</button> : null}
            {graph.kind === 'flowchart' ? (
              <div className="canvas-edge-style-tools" role="group" aria-label="连线样式">
                {EDGE_OPTIONS.map(({ value, label }) => (
                  <button type="button" key={value} className={selectedEdge.style === value ? 'active' : ''} onClick={() => updateEdge(selectedEdge.id, { style: value })}>{label}</button>
                ))}
              </div>
            ) : null}
            {graph.kind === 'sequence' ? (
              <div className="canvas-semantic-tools" role="group" aria-label="消息顺序">
                <button type="button" disabled={selectedSequenceIndex <= 0} onClick={() => moveEdge(selectedEdge.id, -1)}><ArrowUp size={13} /> 提前</button>
                <button type="button" disabled={selectedSequenceIndex < 0 || selectedSequenceIndex >= graph.edges.length - 1} onClick={() => moveEdge(selectedEdge.id, 1)}><ArrowDown size={13} /> 延后</button>
              </div>
            ) : null}
            {canReverseSelectedEdge ? <button type="button" onClick={reverseSelectedEdge}><RefreshCcw size={13} /> 反向{copy.edge}</button> : null}
            {canRemoveSelectedEdge ? <button type="button" className="danger" onClick={removeSelection}><Trash2 size={13} /> {graph.kind === 'mindmap' ? '移到根主题' : '删除'}</button> : null}
          </>
        ) : (
          <span className="canvas-idle-hint">
            {connectMode
              ? connectingFrom ? `再点一个${copy.node}完成${copy.edge}；可连续操作` : `点一个${copy.node}作为${copy.edge}起点`
              : `拖动${copy.node}调整位置 · 双击改名 · 拖动右侧端点建立${copy.edge} · 双击空白新增${copy.node}`}
          </span>
        )}
      </div>

      {selectedNode && (graph.kind === 'class' || graph.kind === 'er') ? (
        <div className="canvas-semantic-inspector canvas-details-inspector">
          <label>
            <span>{graph.kind === 'class' ? '类成员（每行一项）' : '实体字段（每行一项）'}</span>
            <textarea
              rows={3}
              value={(selectedNode.data?.details ?? []).join('\n')}
              onChange={(event) => updateNodeData(selectedNode.id, { details: event.target.value ? event.target.value.split('\n') : [] })}
              placeholder={graph.kind === 'class' ? '+String id\n+save()' : 'string id PK\nstring name'}
              aria-label={graph.kind === 'class' ? '类成员' : '实体字段'}
            />
          </label>
        </div>
      ) : null}

      {selectedNode && graph.kind === 'gantt' ? (
        <div className="canvas-semantic-inspector canvas-gantt-inspector">
          <label><span>分组</span><input value={selectedNode.data?.ganttSection ?? ''} onChange={(event) => updateNodeData(selectedNode.id, { ganttSection: event.target.value })} placeholder="例如：设计" /></label>
          <label><span>任务 ID</span><input value={selectedNode.data?.ref ?? selectedNode.id} onChange={(event) => updateNodeData(selectedNode.id, { ref: event.target.value })} placeholder="唯一 ID" /></label>
          <label><span>开始</span><input disabled={selectedGanttHasDependency} value={selectedGanttStart} onChange={(event) => updateNodeData(selectedNode.id, { ganttStart: event.target.value })} placeholder={selectedGanttHasDependency ? '由依赖关系决定' : 'YYYY-MM-DD'} /></label>
          <label><span>工期 / 结束</span><input value={selectedNode.data?.ganttTiming?.[0] || '1d'} onChange={(event) => updateGanttTiming(selectedNode.id, 0, event.target.value)} placeholder="例如：5d 或 2026-01-10" /></label>
          <div className="canvas-gantt-statuses" role="group" aria-label="任务状态">
            <span>状态</span>
            {GANTT_STATUS_OPTIONS.map((option) => (
              <button type="button" key={option.value} className={selectedNode.data?.ganttStatuses?.includes(option.value) ? 'active' : ''} onClick={() => toggleGanttStatus(selectedNode.id, option.value)}>{option.label}</button>
            ))}
          </div>
        </div>
      ) : null}

      {selectedEdge && graph.kind === 'sequence' ? (
        <div className="canvas-semantic-inspector canvas-edge-inspector">
          <label><span>消息类型</span><select value={selectedEdge.data?.token ?? '->>'} onChange={(event) => updateEdgeToken(selectedEdge.id, event.target.value)}>{SEQUENCE_MESSAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <span className="canvas-inspector-note">第 {selectedSequenceIndex + 1} 条消息 · “提前 / 延后”可调整发送顺序</span>
        </div>
      ) : null}

      {selectedEdge && graph.kind === 'class' ? (
        <div className="canvas-semantic-inspector canvas-edge-inspector">
          <label><span>关系类型</span><select value={parseClassToken(selectedEdge.data?.token).relation} onChange={(event) => updateEdgeToken(selectedEdge.id, replaceClassRelation(selectedEdge.data?.token, event.target.value))}>{CLASS_RELATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <span className="canvas-inspector-note">{classRelationLabel(selectedEdge.data?.token)} · 反向关系可交换两端的类</span>
        </div>
      ) : null}

      {selectedEdge && graph.kind === 'er' && selectedErRelation ? (
        <div className="canvas-semantic-inspector canvas-er-inspector">
          <label><span>起点基数</span><select value={selectedErRelation.from} onChange={(event) => updateEdgeToken(selectedEdge.id, makeErToken(event.target.value as ErCardinality, selectedErRelation.to, selectedErRelation.identifying))}>{ER_CARDINALITIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span>终点基数</span><select value={selectedErRelation.to} onChange={(event) => updateEdgeToken(selectedEdge.id, makeErToken(selectedErRelation.from, event.target.value as ErCardinality, selectedErRelation.identifying))}>{ER_CARDINALITIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span>关系</span><select value={selectedErRelation.identifying ? 'identifying' : 'non-identifying'} onChange={(event) => updateEdgeToken(selectedEdge.id, makeErToken(selectedErRelation.from, selectedErRelation.to, event.target.value === 'identifying'))}><option value="identifying">标识关系</option><option value="non-identifying">非标识关系</option></select></label>
        </div>
      ) : null}

      <div className={`canvas-editor-viewport${connectMode ? ' connect-mode' : ''}`} ref={viewportRef}>
        <div className="canvas-editor-scaled-stage" style={{ width: STAGE_WIDTH * zoom, height: STAGE_HEIGHT * zoom }}>
          <div
            className="canvas-editor-stage"
            ref={stageRef}
            style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${zoom})` }}
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (performance.now() - lastNodePointerAt.current < 750
                || target.closest('[data-mermaid-node-id], [data-mermaid-edge-id], .canvas-edge-label')) return;
              setSelection(null);
              setEditingNodeId(null);
              setEditingEdgeId(null);
            }}
            onDoubleClick={handleCanvasDoubleClick}
          >
            <svg className="canvas-edge-layer" width={STAGE_WIDTH} height={STAGE_HEIGHT} aria-hidden="true">
              <defs>
                <marker id={markerId} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
                  <path d="M 0 0 L 9 4.5 L 0 9 z" />
                </marker>
              </defs>
              {graph.kind === 'sequence' ? graph.nodes.map((node) => {
                const position = positions[node.id];
                if (!position) return null;
                const size = nodeSize(node, graph.kind);
                const x = position.x + size.width / 2;
                return <line key={`lifeline-${node.id}`} className="canvas-sequence-lifeline" x1={x} x2={x} y1={position.y + size.height} y2={STAGE_HEIGHT - 25} />;
              }) : null}
              {graph.edges.map((edge) => {
                const geometry = edgeGeometries.get(edge.id);
                if (!geometry) return null;
                const selected = selection?.kind === 'edge' && selection.id === edge.id;
                const rawRelation = graph.kind === 'class' ? parseClassToken(edge.data?.token).relation : edge.data?.token ?? '';
                const tokenDashed = rawRelation.includes('--') && graph.kind === 'sequence' || rawRelation.startsWith('..');
                const markerEnd = graph.kind === 'flowchart'
                  ? edge.style !== 'line'
                  : graph.kind === 'sequence' || graph.kind === 'state' || graph.kind === 'gantt'
                    || (graph.kind === 'class' && rawRelation.endsWith('>') && !rawRelation.startsWith('<|'));
                return (
                  <g key={edge.id} className={`canvas-edge kind-${graph.kind} ${edge.style}${tokenDashed ? ' token-dashed' : ''}${selected ? ' selected' : ''}`} data-mermaid-edge-id={edge.id}>
                    <path className="canvas-edge-visible" d={geometry.path} markerEnd={markerEnd ? `url(#${markerId})` : undefined} />
                    <path
                      className="canvas-edge-hit"
                      d={geometry.path}
                      onClick={(event) => { event.stopPropagation(); setSelection({ kind: 'edge', id: edge.id }); setEditingNodeId(null); }}
                      onDoubleClick={(event) => { event.stopPropagation(); setSelection({ kind: 'edge', id: edge.id }); if (edgeSupportsLabel) setEditingEdgeId(edge.id); }}
                    />
                  </g>
                );
              })}
              {connectionDrag ? (() => {
                const sourceNode = graph.nodes.find((node) => node.id === connectionDrag.from);
                const position = positions[connectionDrag.from];
                if (!sourceNode || !position) return null;
                const size = nodeSize(sourceNode, graph.kind);
                const start = { x: position.x + size.width, y: position.y + size.height / 2 };
                return <path className="canvas-edge-preview" d={`M ${start.x} ${start.y} L ${connectionDrag.pointer.x} ${connectionDrag.pointer.y}`} markerEnd={`url(#${markerId})`} />;
              })() : null}
            </svg>

            {graph.edges.map((edge, edgeIndex) => {
              const geometry = edgeGeometries.get(edge.id);
              const semanticLabel = graph.kind === 'sequence' || graph.kind === 'class' || graph.kind === 'er' || graph.kind === 'gantt';
              if (!geometry || (!semanticLabel && !edge.label && editingEdgeId !== edge.id && selection?.id !== edge.id)) return null;
              const editing = editingEdgeId === edge.id;
              const fallbackLabel = graph.kind === 'sequence'
                ? '消息'
                : graph.kind === 'class'
                  ? classRelationLabel(edge.data?.token)
                  : graph.kind === 'er'
                    ? erRelationLabel(edge.data?.token)
                    : graph.kind === 'gantt' ? '依赖' : '添加说明';
              return (
                <div
                  key={`label-${edge.id}`}
                  className={`canvas-edge-label kind-${graph.kind}${selection?.kind === 'edge' && selection.id === edge.id ? ' selected' : ''}`}
                  style={{ left: geometry.label.x, top: geometry.label.y }}
                  data-mermaid-edge-id={edge.id}
                  onClick={(event) => { event.stopPropagation(); setSelection({ kind: 'edge', id: edge.id }); }}
                  onDoubleClick={(event) => { event.stopPropagation(); if (edgeSupportsLabel) setEditingEdgeId(edge.id); }}
                >
                  {graph.kind === 'sequence' ? <small className="canvas-edge-order">{edgeIndex + 1}</small> : null}
                  {editing ? (
                    <input
                      autoFocus
                      value={edge.label}
                      onChange={(event) => updateEdge(edge.id, { label: event.target.value })}
                      onBlur={() => setEditingEdgeId(null)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter') { event.preventDefault(); setEditingEdgeId(null); }
                        if (event.key === 'Escape') { event.preventDefault(); setEditingEdgeId(null); }
                      }}
                      placeholder={`${copy.edge}说明`}
                      aria-label={`${copy.edge}说明`}
                    />
                  ) : <span>{edge.label || fallbackLabel}</span>}
                  {graph.kind === 'class' && edge.label ? <small>{classRelationLabel(edge.data?.token)}</small> : null}
                  {graph.kind === 'er' && edge.label ? <small>{erRelationLabel(edge.data?.token)}</small> : null}
                </div>
              );
            })}

            {graph.nodes.map((node) => {
              const position = positions[node.id];
              if (!position) return null;
              const size = nodeSize(node, graph.kind);
              const selected = selection?.kind === 'node' && selection.id === node.id;
              const editing = editingNodeId === node.id;
              const connectionOrigin = connectingFrom === node.id || connectionDrag?.from === node.id;
              const semanticClasses = [
                `kind-${graph.kind}`,
                graph.kind === 'sequence' ? `sequence-${node.data?.sequenceType ?? 'participant'}` : '',
                graph.kind === 'state' ? `role-${node.data?.stateRole ?? 'state'}` : '',
                graph.kind === 'mindmap' && node.data?.mindRoot ? 'mind-root' : '',
                ...(graph.kind === 'gantt' ? (node.data?.ganttStatuses ?? []).map((status) => `gantt-${status}`) : []),
              ].filter(Boolean).join(' ');
              return (
                <div
                  key={node.id}
                  className={`mermaid-canvas-node shape-${node.shape} ${semanticClasses}${selected ? ' selected' : ''}${connectionOrigin ? ' connection-origin' : ''}`}
                  style={{ left: position.x, top: position.y, width: size.width, height: size.height }}
                  data-mermaid-node-id={node.id}
                  onPointerDown={(event) => handleNodePointerDown(event, node)}
                  onClick={(event) => handleNodeClick(event, node)}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    setSelection({ kind: 'node', id: node.id });
                    if (!(graph.kind === 'state' && node.data?.stateRole !== 'state')) setEditingNodeId(node.id);
                  }}
                  role="button"
                  aria-label={`${node.label} ${copy.node}`}
                  aria-pressed={selected}
                  tabIndex={-1}
                >
                  <div className="canvas-node-content">
                    {editing ? (
                      <input
                        autoFocus
                        value={node.label}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => updateNode(node.id, { label: event.target.value })}
                        onBlur={() => setEditingNodeId(null)}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === 'Enter') { event.preventDefault(); setEditingNodeId(null); }
                          if (event.key === 'Escape') setEditingNodeId(null);
                        }}
                        aria-label={`${copy.node}名称`}
                      />
                    ) : <span className="canvas-node-title">{node.label || node.id}</span>}
                    <small className="canvas-node-meta">{nodeMeta(node, graph.kind)}</small>
                    {(graph.kind === 'class' || graph.kind === 'er') ? (
                      <div className="canvas-node-details">
                        {(node.data?.details ?? []).length
                          ? (node.data?.details ?? []).slice(0, 6).map((detail, index) => <span key={`${node.id}-detail-${index}`}>{detail || '\u00a0'}</span>)
                          : <em>{graph.kind === 'class' ? '暂无成员' : '暂无字段'}</em>}
                      </div>
                    ) : null}
                    {graph.kind === 'gantt' ? (
                      <div className="canvas-node-gantt-meta">
                        <span>{node.data?.ganttStart || '未设开始'} · {node.data?.ganttTiming?.filter(Boolean).join(' → ') || '未设工期'}</span>
                      </div>
                    ) : null}
                  </div>
                  {selected ? (
                    <button
                      type="button"
                      className="canvas-node-connector"
                      onPointerDown={(event) => startConnectionDrag(event, node.id)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`从 ${node.label} 拖出${copy.edge}`}
                      title={`拖到另一${copy.node}建立${copy.edge}`}
                    >
                      <Plus size={13} />
                    </button>
                  ) : null}
                </div>
              );
            })}

            {!graph.nodes.length ? (
              <button type="button" className="canvas-empty-action" onClick={(event) => { event.stopPropagation(); addNode(); }}>
                <Plus size={22} /><strong>{copy.empty}</strong><span>也可以双击画布任意位置</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="canvas-editor-status">
        <span>{graph.nodes.length} 个{copy.nodes} · {graph.edges.length} 条{copy.edges}</span>
        <span>{copy.node}位置仅用于本次画布编排；应用时由 Mermaid 按图种结构自动布局</span>
      </div>
    </div>
  );
}
