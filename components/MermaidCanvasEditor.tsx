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
  Maximize2,
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
  useCallback,
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
import {
  graphLayoutSignature,
  graphNodeGeometrySignature,
  layoutMermaidGraph,
  mermaidCanvasFitZoom,
  mermaidCanvasLayoutBounds,
  mermaidCanvasNodeSize,
  mermaidSequenceMessageVisual,
  snapMermaidCanvasNode,
  MERMAID_STAGE_PADDING,
  MIN_MERMAID_CANVAS_ZOOM,
  MIN_MERMAID_STAGE_HEIGHT,
  MIN_MERMAID_STAGE_WIDTH,
  type MermaidCanvasEdgeRoute,
  type MermaidCanvasAlignmentGuides,
  type MermaidCanvasLayout,
  type MermaidCanvasNodePositions,
  type MermaidCanvasPoint,
  type MermaidSequenceMessageMarker,
} from '@/lib/mermaid-canvas-layout';

type MermaidCanvasEditorProps = {
  active?: boolean;
  suspended?: boolean;
  graph: MermaidFlowGraph;
  onChange: (graph: MermaidFlowGraph) => void;
};

type Point = MermaidCanvasPoint;
type NodePositions = MermaidCanvasNodePositions;

function safeCanvasRecord<T>(source?: Record<string, T>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, source);
}
type Selection = { kind: 'node' | 'edge'; id: string } | null;
type DragState = {
  id: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
};
type ConnectionDrag = {
  from: string;
  pointerId: number;
  pointer: Point;
  startClientX: number;
  startClientY: number;
  moved: boolean;
};
type CanvasViewStyle = 'standard' | 'handdrawn';
type QuickAddDirection = 'top' | 'right' | 'bottom' | 'left';
type CanvasNodePresetId =
  | 'flow-process'
  | 'flow-decision'
  | 'flow-data'
  | 'flow-terminal'
  | 'sequence-participant'
  | 'sequence-actor'
  | 'state-state'
  | 'state-start'
  | 'state-end'
  | 'class-class'
  | 'er-entity'
  | 'mind-topic'
  | 'gantt-task'
  | 'gantt-milestone';
type CanvasNodePreset = {
  id: CanvasNodePresetId;
  label: string;
  description: string;
  icon: typeof Square;
  requiresSelection?: boolean;
};
type AddNodeOptions = {
  parentId?: string;
  presetId?: CanvasNodePresetId;
  edgeDirection?: 'from-parent' | 'to-parent';
  editLabel?: boolean;
};
type PanState = {
  pointerId: number;
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
  captured: boolean;
};
type ViewportTarget =
  | { kind: 'anchor'; canvasX: number; canvasY: number; viewportX: number; viewportY: number }
  | { kind: 'center'; canvasX: number; canvasY: number };
type PendingViewport = { target: ViewportTarget; expectedZoom: number };
type NodeData = NonNullable<MermaidFlowNode['data']>;

const STAGE_WIDTH = MIN_MERMAID_STAGE_WIDTH;
const STAGE_HEIGHT = MIN_MERMAID_STAGE_HEIGHT;
const MIN_ZOOM = MIN_MERMAID_CANVAS_ZOOM;
const MAX_ZOOM = 2;

const SHAPE_OPTIONS: Array<{ value: MermaidNodeShape; label: string; icon: typeof Square }> = [
  { value: 'rectangle', label: '矩形', icon: Square },
  { value: 'rounded', label: '圆角', icon: Square },
  { value: 'terminal', label: '起止', icon: Circle },
  { value: 'decision', label: '判断', icon: Diamond },
  { value: 'circle', label: '圆形', icon: Circle },
  { value: 'database', label: '数据', icon: Database },
];

const NODE_PRESETS: Record<MermaidFlowGraph['kind'], CanvasNodePreset[]> = {
  flowchart: [
    { id: 'flow-process', label: '流程', description: '添加处理步骤', icon: Square },
    { id: 'flow-decision', label: '判断', description: '添加条件分支', icon: Diamond },
    { id: 'flow-data', label: '数据', description: '添加数据或存储', icon: Database },
    { id: 'flow-terminal', label: '起止', description: '添加开始或结束', icon: Circle },
  ],
  sequence: [
    { id: 'sequence-participant', label: '参与者', description: '添加系统或组件', icon: Square },
    { id: 'sequence-actor', label: '角色', description: '添加用户或外部角色', icon: Circle },
  ],
  state: [
    { id: 'state-state', label: '状态', description: '添加普通状态', icon: Square },
    { id: 'state-start', label: '起点', description: '连接到当前状态', icon: Circle, requiresSelection: true },
    { id: 'state-end', label: '终点', description: '从当前状态连接', icon: Circle, requiresSelection: true },
  ],
  class: [{ id: 'class-class', label: '类', description: '添加类或接口', icon: Square }],
  er: [{ id: 'er-entity', label: '实体', description: '添加数据实体', icon: Database }],
  mindmap: [{ id: 'mind-topic', label: '主题', description: '添加子主题', icon: Circle }],
  gantt: [
    { id: 'gantt-task', label: '任务', description: '添加普通任务', icon: Square },
    { id: 'gantt-milestone', label: '里程碑', description: '添加里程碑任务', icon: Diamond },
  ],
};

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

const QUICK_ADD_OPTIONS: Array<{ value: QuickAddDirection; label: string; icon: typeof ArrowDown }> = [
  { value: 'top', label: '在上方创建并连接', icon: ArrowUp },
  { value: 'right', label: '在右侧创建并连接', icon: ArrowRight },
  { value: 'bottom', label: '在下方创建并连接', icon: ArrowDown },
  { value: 'left', label: '在左侧创建并连接', icon: ArrowLeft },
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

const nodeSize = mermaidCanvasNodeSize;

function clampPosition(
  node: MermaidFlowNode,
  point: Point,
  kind: MermaidFlowGraph['kind'],
  stageSize = { width: STAGE_WIDTH, height: STAGE_HEIGHT },
): Point {
  const size = nodeSize(node, kind);
  return {
    x: Math.max(18, Math.min(stageSize.width - size.width - 18, point.x)),
    y: Math.max(18, Math.min(stageSize.height - size.height - 18, point.y)),
  };
}

function clampSequenceParticipantPosition(
  graph: MermaidFlowGraph,
  positions: NodePositions,
  node: MermaidFlowNode,
  desiredX: number,
  stageSize: { width: number; height: number },
): Point {
  const current = positions[node.id] ?? { x: 18, y: 58 };
  const index = graph.nodes.findIndex((candidate) => candidate.id === node.id);
  const size = nodeSize(node, graph.kind);
  const gap = 34;
  const previous = index > 0 ? graph.nodes[index - 1] : null;
  const next = index >= 0 && index < graph.nodes.length - 1 ? graph.nodes[index + 1] : null;
  const previousPosition = previous ? positions[previous.id] : null;
  const nextPosition = next ? positions[next.id] : null;
  const minimum = previous && previousPosition
    ? previousPosition.x + nodeSize(previous, graph.kind).width + gap
    : 18;
  const maximum = next && nextPosition
    ? nextPosition.x - size.width - gap
    : stageSize.width - size.width - 18;
  if (maximum < minimum) return current;
  return {
    x: Math.max(minimum, Math.min(maximum, desiredX)),
    y: current.y,
  };
}

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value * 1000) / 1000));
}

function hasNodeCollisions(graph: MermaidFlowGraph, positions: NodePositions, gap = 14) {
  for (let firstIndex = 0; firstIndex < graph.nodes.length; firstIndex += 1) {
    const first = graph.nodes[firstIndex];
    const firstPosition = positions[first.id];
    if (!firstPosition) continue;
    const firstSize = nodeSize(first, graph.kind);
    for (let secondIndex = firstIndex + 1; secondIndex < graph.nodes.length; secondIndex += 1) {
      const second = graph.nodes[secondIndex];
      const secondPosition = positions[second.id];
      if (!secondPosition) continue;
      const secondSize = nodeSize(second, graph.kind);
      const separated = firstPosition.x + firstSize.width + gap <= secondPosition.x
        || secondPosition.x + secondSize.width + gap <= firstPosition.x
        || firstPosition.y + firstSize.height + gap <= secondPosition.y
        || secondPosition.y + secondSize.height + gap <= firstPosition.y;
      if (!separated) return true;
    }
  }
  return false;
}

function expandedStageForPositions(
  graph: MermaidFlowGraph,
  positions: NodePositions,
  current: Pick<MermaidCanvasLayout, 'width' | 'height'>,
) {
  let maxX = 0;
  let maxY = 0;
  for (const node of graph.nodes) {
    const position = positions[node.id];
    if (!position) continue;
    const size = nodeSize(node, graph.kind);
    maxX = Math.max(maxX, position.x + size.width);
    maxY = Math.max(maxY, position.y + size.height);
  }
  return {
    width: Math.max(current.width, STAGE_WIDTH, Math.ceil(maxX + MERMAID_STAGE_PADDING)),
    height: Math.max(current.height, STAGE_HEIGHT, Math.ceil(maxY + MERMAID_STAGE_PADDING)),
  };
}

function layoutOffsetWithin(element: HTMLElement, ancestor: HTMLElement) {
  let x = 0;
  let y = 0;
  let current: HTMLElement | null = element;
  while (current && current !== ancestor) {
    x += current.offsetLeft;
    y += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  if (current === ancestor) return { x, y };
  const ancestorRect = ancestor.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  return {
    x: elementRect.left - ancestorRect.left + ancestor.scrollLeft,
    y: elementRect.top - ancestorRect.top + ancestor.scrollTop,
  };
}

function applyViewportTarget(viewport: HTMLDivElement, stage: HTMLDivElement, target: ViewportTarget, zoom: number) {
  const stageOffset = layoutOffsetWithin(stage, viewport);
  viewport.scrollLeft = Math.max(0, stageOffset.x + target.canvasX * zoom
    - (target.kind === 'anchor' ? target.viewportX : viewport.clientWidth / 2));
  viewport.scrollTop = Math.max(0, stageOffset.y + target.canvasY * zoom
    - (target.kind === 'anchor' ? target.viewportY : viewport.clientHeight / 2));
}

function routePath(points: Point[]) {
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

function edgeGeometry(
  edge: MermaidFlowEdge,
  graph: MermaidFlowGraph,
  positions: NodePositions,
  edgeIndex: number,
  routes: Record<string, MermaidCanvasEdgeRoute>,
  stageHeight: number,
) {
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
    const available = Math.max(80, stageHeight - firstRow - 34);
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
  const routed = routes[edge.id];
  if (routed?.points.length) {
    return { path: routePath(routed.points), label: routed.label };
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

function applyNodePreset(node: MermaidFlowNode, presetId?: CanvasNodePresetId): MermaidFlowNode {
  if (!presetId) return node;
  if (presetId === 'flow-process') return { ...node, label: '新流程', shape: 'rectangle' };
  if (presetId === 'flow-decision') return { ...node, label: '新判断', shape: 'decision' };
  if (presetId === 'flow-data') return { ...node, label: '新数据', shape: 'database' };
  if (presetId === 'flow-terminal') return { ...node, label: '开始 / 结束', shape: 'terminal' };
  if (presetId === 'sequence-participant') {
    return { ...node, label: '新参与者', shape: 'rectangle', data: { ...node.data, sequenceType: 'participant' } };
  }
  if (presetId === 'sequence-actor') {
    return { ...node, label: '新角色', shape: 'terminal', data: { ...node.data, sequenceType: 'actor' } };
  }
  if (presetId === 'state-state') {
    return { ...node, label: '新状态', shape: 'rounded', data: { ...node.data, stateRole: 'state' } };
  }
  if (presetId === 'state-start') {
    return { ...node, label: '开始', shape: 'circle', data: { ...node.data, ref: '[*]', stateRole: 'start' } };
  }
  if (presetId === 'state-end') {
    return { ...node, label: '结束', shape: 'circle', data: { ...node.data, ref: '[*]', stateRole: 'end' } };
  }
  if (presetId === 'class-class') return { ...node, label: '新类', shape: 'rectangle', data: { ...node.data, details: [] } };
  if (presetId === 'er-entity') return { ...node, label: '新实体', shape: 'rectangle', data: { ...node.data, details: [] } };
  if (presetId === 'mind-topic') return { ...node, label: '新主题', shape: 'rounded' };
  if (presetId === 'gantt-milestone') {
    const statuses = new Set(node.data?.ganttStatuses ?? []);
    statuses.add('milestone');
    return { ...node, label: '新里程碑', shape: 'rounded', data: { ...node.data, ganttStatuses: [...statuses] } };
  }
  if (presetId === 'gantt-task') return { ...node, label: '新任务', shape: 'rounded' };
  return node;
}

function defaultQuickPreset(kind: MermaidFlowGraph['kind']): CanvasNodePresetId {
  if (kind === 'flowchart') return 'flow-process';
  if (kind === 'sequence') return 'sequence-participant';
  if (kind === 'state') return 'state-state';
  if (kind === 'class') return 'class-class';
  if (kind === 'er') return 'er-entity';
  if (kind === 'mindmap') return 'mind-topic';
  return 'gantt-task';
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

function replaceClassMultiplicity(token: string | undefined, side: 'from' | 'to', value: string) {
  const parsed = parseClassToken(token);
  const safeValue = value.replace(/["\r\n]/g, '').trim();
  const fromMultiplicity = side === 'from' ? safeValue || undefined : parsed.fromMultiplicity;
  const toMultiplicity = side === 'to' ? safeValue || undefined : parsed.toMultiplicity;
  return `${fromMultiplicity ? `"${fromMultiplicity}" ` : ''}${parsed.relation}${toMultiplicity ? ` "${toMultiplicity}"` : ''}`;
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

export default function MermaidCanvasEditor({ active = true, suspended = false, graph, onChange }: MermaidCanvasEditorProps) {
  const canvasId = useId().replace(/:/g, '');
  const markerId = `canvas-arrow-${canvasId}`;
  const crossMarkerId = `canvas-cross-${canvasId}`;
  const asyncMarkerId = `canvas-async-${canvasId}`;
  const sketchFilterId = `canvas-sketch-${canvasId}`;
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [canvasLayout, setCanvasLayout] = useState<MermaidCanvasLayout>(() => layoutMermaidGraph(graph));
  const { positions, routes, width: stageWidth, height: stageHeight } = canvasLayout;
  const [selection, setSelection] = useState<Selection>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDrag | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.9);
  const [canvasStyle, setCanvasStyle] = useState<CanvasViewStyle>('standard');
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [alignmentGuides, setAlignmentGuides] = useState<MermaidCanvasAlignmentGuides>({});
  const [spacePressed, setSpacePressed] = useState(false);
  const [panning, setPanning] = useState(false);
  const nodeSignature = graph.nodes.map((node) => node.id).join('|');
  const layoutSignature = graphLayoutSignature(graph);
  const nodeGeometrySignature = graphNodeGeometrySignature(graph);
  const previousGraphShape = useRef({
    kind: graph.kind,
    direction: graph.direction,
    nodeSignature,
    layoutSignature,
    nodeGeometrySignature,
  });
  const shouldCenterViewport = useRef(true);
  const shouldAutoFitViewport = useRef(true);
  const wasActive = useRef(active);
  const lastNodePointerAt = useRef(0);
  const zoomRef = useRef(zoom);
  const spacePressedRef = useRef(false);
  const panStateRef = useRef<PanState | null>(null);
  const draggingRef = useRef<DragState | null>(null);
  const connectionDragRef = useRef<ConnectionDrag | null>(null);
  const interactionCaptureRef = useRef<{ pointerId: number; element: HTMLElement } | null>(null);
  const didPanRef = useRef(false);
  const pendingViewportRef = useRef<PendingViewport | null>(null);
  const zoomAtPointRef = useRef<(nextZoom: number, clientX: number, clientY: number) => void>(() => undefined);

  function setPositions(update: NodePositions | ((current: NodePositions) => NodePositions)) {
    setCanvasLayout((current) => ({
      ...current,
      positions: safeCanvasRecord(typeof update === 'function' ? update(current.positions) : update),
      routes: safeCanvasRecord(),
    }));
  }

  const releaseInteractionCapture = useCallback((pointerId?: number) => {
    const capture = interactionCaptureRef.current;
    if (!capture || (pointerId !== undefined && capture.pointerId !== pointerId)) return;
    interactionCaptureRef.current = null;
    try {
      if (capture.element.hasPointerCapture(capture.pointerId)) capture.element.releasePointerCapture(capture.pointerId);
    } catch {
      // Pointer capture may already have been released by the WebView.
    }
  }, []);

  const captureInteractionPointer = useCallback((element: HTMLElement, pointerId: number) => {
    releaseInteractionCapture();
    try {
      element.setPointerCapture(pointerId);
      interactionCaptureRef.current = { pointerId, element };
    } catch {
      interactionCaptureRef.current = null;
    }
  }, [releaseInteractionCapture]);

  const cancelPointerInteractions = useCallback((pointerId?: number) => {
    const activeDrag = draggingRef.current;
    if (activeDrag && (pointerId === undefined || activeDrag.pointerId === pointerId)) {
      draggingRef.current = null;
      setDragging(null);
      setAlignmentGuides({});
    }
    const activeConnection = connectionDragRef.current;
    if (activeConnection && (pointerId === undefined || activeConnection.pointerId === pointerId)) {
      connectionDragRef.current = null;
      setConnectionDrag(null);
    }
    releaseInteractionCapture(pointerId);
  }, [releaseInteractionCapture]);

  const finishViewportPanByPointerId = useCallback((pointerId?: number) => {
    const pan = panStateRef.current;
    if (!pan || (pointerId !== undefined && pan.pointerId !== pointerId)) return;
    const viewport = viewportRef.current;
    panStateRef.current = null;
    setPanning(false);
    try {
      if (viewport?.hasPointerCapture(pan.pointerId)) viewport.releasePointerCapture(pan.pointerId);
    } catch {
      // Pointer capture may already have been released by the WebView.
    }
    window.setTimeout(() => { didPanRef.current = false; }, 0);
  }, []);

  useLayoutEffect(() => {
    zoomRef.current = zoom;
    zoomAtPointRef.current = zoomAtPoint;
  });

  function applyAutomaticLayout(nextGraph = graph, autoFit = true) {
    setCanvasLayout(layoutMermaidGraph(nextGraph));
    shouldCenterViewport.current = true;
    if (autoFit) shouldAutoFitViewport.current = true;
  }

  useLayoutEffect(() => {
    if (!active || suspended) return;
    if (editorRef.current?.contains(document.activeElement)) return;
    editorRef.current?.focus({ preventScroll: true });
  }, [active, suspended]);

  useEffect(() => {
    const previous = previousGraphShape.current;
    const kindChanged = previous.kind !== graph.kind;
    const directionChanged = previous.direction !== graph.direction;
    const nodesChanged = previous.nodeSignature !== nodeSignature;
    const layoutChanged = previous.layoutSignature !== layoutSignature;
    const nodeGeometryChanged = !nodesChanged && previous.nodeGeometrySignature !== nodeGeometrySignature;
    previousGraphShape.current = {
      kind: graph.kind,
      direction: graph.direction,
      nodeSignature,
      layoutSignature,
      nodeGeometrySignature,
    };
    if (kindChanged || directionChanged || nodesChanged) {
      shouldCenterViewport.current = true;
    }
    if (kindChanged || directionChanged || (nodesChanged && graph.kind === 'sequence')) {
      shouldAutoFitViewport.current = true;
    }
    if (kindChanged) {
      setSelection(null);
      setEditingNodeId(null);
      setEditingEdgeId(null);
      cancelPointerInteractions();
      setConnectMode(false);
      setConnectingFrom(null);
    }
    if (kindChanged || directionChanged) {
      setCanvasLayout(layoutMermaidGraph(graph));
    } else if (nodeGeometryChanged) {
      const laidOut = layoutMermaidGraph(graph);
      setCanvasLayout((current) => {
        if (hasNodeCollisions(graph, current.positions)) {
          shouldCenterViewport.current = true;
          shouldAutoFitViewport.current = true;
          return laidOut;
        }
        return {
          ...current,
          ...expandedStageForPositions(graph, current.positions, current),
          routes: safeCanvasRecord(),
        };
      });
    } else if (nodesChanged) {
      const laidOut = layoutMermaidGraph(graph);
      setCanvasLayout((current) => {
        if (graph.kind === 'sequence') return laidOut;
        const next = safeCanvasRecord<Point>();
        for (const node of graph.nodes) next[node.id] = current.positions[node.id] ?? laidOut.positions[node.id];
        if (hasNodeCollisions(graph, next)) {
          shouldAutoFitViewport.current = true;
          return laidOut;
        }
        return {
          positions: next,
          routes: safeCanvasRecord(),
          width: Math.max(current.width, laidOut.width),
          height: Math.max(current.height, laidOut.height),
        };
      });
    } else if (layoutChanged) {
      if (graph.kind === 'sequence') {
        preserveViewportCenter();
        const laidOut = layoutMermaidGraph(graph);
        setCanvasLayout((current) => {
          const next = safeCanvasRecord<Point>();
          let maxX = 0;
          for (const node of graph.nodes) {
            const position = current.positions[node.id] ?? laidOut.positions[node.id];
            if (!position) continue;
            next[node.id] = position;
            maxX = Math.max(maxX, position.x + nodeSize(node, graph.kind).width);
          }
          return {
            positions: next,
            routes: safeCanvasRecord(),
            width: Math.max(laidOut.width, Math.ceil(maxX + MERMAID_STAGE_PADDING)),
            height: laidOut.height,
          };
        });
        return;
      }
      // Preserve manually arranged nodes during ordinary canvas edits. Routes
      // are invalidated so changed edges fall back to live geometry until the
      // user explicitly chooses “自动排列”.
      setCanvasLayout((current) => ({ ...current, routes: safeCanvasRecord() }));
    }
  }, [cancelPointerInteractions, graph, layoutSignature, nodeGeometrySignature, nodeSignature]);

  useLayoutEffect(() => {
    if (active && !wasActive.current) {
      shouldCenterViewport.current = true;
      shouldAutoFitViewport.current = true;
    }
    wasActive.current = active;
    if (!active) {
      cancelPointerInteractions();
      finishViewportPanByPointerId(panStateRef.current?.pointerId);
      return;
    }
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    if (!viewport || !stage || !viewport.clientWidth || !viewport.clientHeight) return;
    const pendingViewport = pendingViewportRef.current;
    if (pendingViewport) {
      if (Math.abs(zoom - pendingViewport.expectedZoom) > 0.0005) return;
      applyViewportTarget(viewport, stage, pendingViewport.target, pendingViewport.expectedZoom);
      pendingViewportRef.current = null;
      shouldCenterViewport.current = false;
      return;
    }
    if (!shouldCenterViewport.current) return;
    const visibleNodes = graph.nodes.filter((node) => positions[node.id]);
    if (!visibleNodes.length) {
      applyViewportTarget(viewport, stage, {
        kind: 'center',
        canvasX: stageWidth / 2,
        canvasY: stageHeight / 2,
      }, zoom);
      shouldCenterViewport.current = false;
      return;
    }
    const bounds = mermaidCanvasLayoutBounds(graph, canvasLayout);
    if (shouldAutoFitViewport.current) {
      shouldAutoFitViewport.current = false;
      const fittedZoom = mermaidCanvasFitZoom(bounds, viewport.clientWidth, viewport.clientHeight, 0.9);
      const minimumReadableZoom = graph.nodes.length <= 10
        ? graph.kind === 'sequence' ? 0.7 : 0.55
        : MIN_ZOOM;
      const nextZoom = Math.max(fittedZoom, minimumReadableZoom);
      const target: ViewportTarget = {
        kind: 'center',
        canvasX: (bounds.minX + bounds.maxX) / 2,
        canvasY: (bounds.minY + bounds.maxY) / 2,
      };
      pendingViewportRef.current = { target, expectedZoom: nextZoom };
      if (Math.abs(nextZoom - zoom) <= 0.0005) {
        applyViewportTarget(viewport, stage, target, nextZoom);
        pendingViewportRef.current = null;
        shouldCenterViewport.current = false;
      } else {
        zoomRef.current = nextZoom;
        setZoom(nextZoom);
      }
      return;
    }
    applyViewportTarget(viewport, stage, {
      kind: 'center',
      canvasX: (bounds.minX + bounds.maxX) / 2,
      canvasY: (bounds.minY + bounds.maxY) / 2,
    }, zoom);
    shouldCenterViewport.current = false;
  }, [active, cancelPointerInteractions, canvasLayout, finishViewportPanByPointerId, graph, positions, stageHeight, stageWidth, zoom]);

  useLayoutEffect(() => {
    if (!suspended) return;
    spacePressedRef.current = false;
    cancelPointerInteractions();
    finishViewportPanByPointerId(panStateRef.current?.pointerId);
  }, [cancelPointerInteractions, finishViewportPanByPointerId, suspended]);

  useEffect(() => {
    if (!active || suspended) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    function handleWheel(event: WheelEvent) {
      if (!event.deltaY) return;
      event.preventDefault();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 18
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport!.clientHeight : 1;
      const delta = Math.max(-180, Math.min(180, event.deltaY * unit));
      const nextZoom = zoomRef.current * Math.exp(-delta * 0.0017);
      zoomAtPointRef.current(nextZoom, event.clientX, event.clientY);
    }
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [active, suspended]);

  useEffect(() => {
    const viewport = viewportRef.current;
    function releaseSpace(event: KeyboardEvent) {
      if (event.code !== 'Space') return;
      spacePressedRef.current = false;
      setSpacePressed(false);
    }
    function resetTransientNavigation() {
      spacePressedRef.current = false;
      finishViewportPanByPointerId(panStateRef.current?.pointerId);
      cancelPointerInteractions();
      setSpacePressed(false);
    }
    window.addEventListener('keyup', releaseSpace);
    window.addEventListener('blur', resetTransientNavigation);
    return () => {
      window.removeEventListener('keyup', releaseSpace);
      window.removeEventListener('blur', resetTransientNavigation);
      const interactionCapture = interactionCaptureRef.current;
      interactionCaptureRef.current = null;
      try {
        if (interactionCapture?.element.hasPointerCapture(interactionCapture.pointerId)) {
          interactionCapture.element.releasePointerCapture(interactionCapture.pointerId);
        }
      } catch {
        // Pointer capture may already have been released during unmount.
      }
      const activePan = panStateRef.current;
      panStateRef.current = null;
      try {
        if (activePan && viewport?.hasPointerCapture(activePan.pointerId)) {
          viewport.releasePointerCapture(activePan.pointerId);
        }
      } catch {
        // Pointer capture may already have been released during unmount.
      }
    };
  }, [cancelPointerInteractions, finishViewportPanByPointerId]);

  useEffect(() => {
    function canvasPoint(clientX: number, clientY: number) {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
    }

    function handlePointerMove(event: PointerEvent) {
      const point = canvasPoint(event.clientX, event.clientY);
      const activeDrag = draggingRef.current;
      if (activeDrag && event.pointerId === activeDrag.pointerId) {
        const moved = activeDrag.moved
          || Math.hypot(event.clientX - activeDrag.startClientX, event.clientY - activeDrag.startClientY) > 3;
        if (!moved) return;
        if (!activeDrag.moved) {
          const movedDrag = { ...activeDrag, moved: true };
          draggingRef.current = movedDrag;
          setDragging(movedDrag);
        }
        lastNodePointerAt.current = performance.now();
        const node = graph.nodes.find((candidate) => candidate.id === activeDrag.id);
        if (node) {
          const desired = { x: point.x - activeDrag.offsetX, y: point.y - activeDrag.offsetY };
          const snapped = snapMermaidCanvasNode(graph, positions, node, desired, snapToGrid);
          setAlignmentGuides(graph.kind === 'sequence' ? { x: snapped.guides.x } : snapped.guides);
          setPositions((current) => ({
            ...current,
            [activeDrag.id]: graph.kind === 'sequence'
              ? clampSequenceParticipantPosition(
                graph,
                current,
                node,
                snapped.point.x,
                { width: stageWidth, height: stageHeight },
              )
              : clampPosition(
                node,
                snapped.point,
                graph.kind,
                { width: stageWidth, height: stageHeight },
              ),
          }));
        }
      }
      const activeConnection = connectionDragRef.current;
      if (activeConnection && event.pointerId === activeConnection.pointerId) {
        const moved = activeConnection.moved
          || Math.hypot(event.clientX - activeConnection.startClientX, event.clientY - activeConnection.startClientY) > 4;
        const nextConnection = { ...activeConnection, pointer: point, moved };
        connectionDragRef.current = nextConnection;
        setConnectionDrag(nextConnection);
      }
    }

    function handlePointerUp(event: PointerEvent) {
      finishViewportPanByPointerId(event.pointerId);
      const activeDrag = draggingRef.current;
      if (activeDrag?.pointerId === event.pointerId) {
        draggingRef.current = null;
        setDragging(null);
        setAlignmentGuides({});
      }
      const activeConnection = connectionDragRef.current;
      if (activeConnection?.pointerId === event.pointerId) {
        connectionDragRef.current = null;
        setConnectionDrag(null);
        const moved = activeConnection.moved
          || Math.hypot(event.clientX - activeConnection.startClientX, event.clientY - activeConnection.startClientY) > 4;
        if (!moved) {
          beginConnectionFrom(activeConnection.from);
        } else {
          const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
          const target = element?.closest<HTMLElement>('[data-mermaid-node-id]')?.dataset.mermaidNodeId;
          if (target && (target !== activeConnection.from || (graph.kind !== 'mindmap' && graph.kind !== 'gantt'))) {
            addConnection(activeConnection.from, target);
          }
        }
      }
      releaseInteractionCapture(event.pointerId);
    }

    function handlePointerCancel(event: PointerEvent) {
      finishViewportPanByPointerId(event.pointerId);
      cancelPointerInteractions(event.pointerId);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  });

  const selectedNode = selection?.kind === 'node' ? graph.nodes.find((node) => node.id === selection.id) ?? null : null;
  const selectedEdge = selection?.kind === 'edge' ? graph.edges.find((edge) => edge.id === selection.id) ?? null : null;
  const nodePresets = NODE_PRESETS[graph.kind];
  const selectedNodeIndex = selectedNode ? graph.nodes.findIndex((node) => node.id === selectedNode.id) : -1;
  const connectingNode = connectingFrom ? graph.nodes.find((node) => node.id === connectingFrom) ?? null : null;
  const copy = KIND_COPY[graph.kind];
  const selectedErRelation = selectedEdge && graph.kind === 'er' ? parseErToken(selectedEdge.data?.token) : null;
  const selectedClassRelation = selectedEdge && graph.kind === 'class' ? parseClassToken(selectedEdge.data?.token) : null;
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
  const quickAddDirections: QuickAddDirection[] = !selectedNode
    ? []
    : graph.kind === 'sequence' || graph.kind === 'mindmap' || graph.kind === 'gantt'
      ? ['right']
      : graph.kind === 'state' && selectedNode.data?.stateRole !== 'state'
        ? []
        : ['top', 'right', 'bottom', 'left'];
  const edgeGeometries = useMemo(
    () => new Map(graph.edges.map((edge, index) => [
      edge.id,
      edgeGeometry(edge, graph, positions, index, routes, stageHeight),
    ])),
    [graph, positions, routes, stageHeight],
  );

  function sequenceMarkerUrl(marker: MermaidSequenceMessageMarker) {
    if (marker === 'none') return undefined;
    const id = marker === 'cross' ? crossMarkerId : marker === 'async' ? asyncMarkerId : markerId;
    return `url(#${id})`;
  }

  function pointFromEvent(event: { clientX: number; clientY: number }): Point {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: stageWidth / 2, y: stageHeight / 2 };
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
    if (graph.kind === 'sequence') setEditingEdgeId(edge.id);
    setConnectingFrom(connectMode ? to : null);
  }

  function addNode(point?: Point, options?: AddNodeOptions) {
    const prefix = graph.kind === 'sequence' ? 'Participant'
      : graph.kind === 'state' ? 'State'
        : graph.kind === 'class' ? 'Class'
          : graph.kind === 'er' ? 'ENTITY'
            : graph.kind === 'mindmap' ? 'Mind'
              : graph.kind === 'gantt' ? 'Task' : 'N';
    const id = nextMermaidNodeId(graph.nodes, prefix);
    const node = applyNodePreset(defaultNode(graph.kind, id, graph, selectedNode), options?.presetId);
    const automaticMindParent = graph.kind === 'mindmap' && graph.nodes.length
      ? selectedNode?.id ?? graph.nodes.find((candidate) => candidate.data?.mindRoot)?.id ?? graph.nodes[0].id
      : undefined;
    const parentId = options?.parentId ?? automaticMindParent;
    const parentPosition = parentId ? positions[parentId] : undefined;
    const fallbackIndex = graph.nodes.length;
    const size = nodeSize(node, graph.kind);
    const fallback = parentPosition
      ? { x: parentPosition.x + 250, y: parentPosition.y + ((fallbackIndex % 3) - 1) * 92 }
      : { x: stageWidth / 2 - size.width / 2 + (fallbackIndex % 4) * 18, y: stageHeight / 2 - size.height / 2 + (fallbackIndex % 4) * 18 };
    const parentEdge = parentId
      ? options?.edgeDirection === 'to-parent'
        ? defaultEdge(graph.kind, nextEdgeId(graph.edges), id, parentId)
        : defaultEdge(graph.kind, nextEdgeId(graph.edges), parentId, id)
      : null;
    const nextGraph: MermaidFlowGraph = {
      ...graph,
      nodes: [...graph.nodes, node],
      edges: parentEdge ? [...graph.edges, parentEdge] : graph.edges,
    };
    if (graph.kind === 'sequence') {
      applyAutomaticLayout(nextGraph, false);
    } else {
      setPositions((current) => ({
        ...current,
        [id]: clampPosition(
          node,
          point ? { x: point.x - size.width / 2, y: point.y - size.height / 2 } : fallback,
          graph.kind,
          { width: stageWidth, height: stageHeight },
        ),
      }));
    }
    onChange(nextGraph);
    setSelection({ kind: 'node', id });
    setEditingNodeId(options?.editLabel === false || options?.presetId === 'state-start' || options?.presetId === 'state-end' ? null : id);
    setEditingEdgeId(null);
  }

  function quickAddPoint(fromId: string, direction: QuickAddDirection, presetId?: CanvasNodePresetId) {
    const sourceNode = graph.nodes.find((node) => node.id === fromId);
    const sourcePosition = positions[fromId];
    if (!sourceNode || !sourcePosition) return undefined;
    const nextId = nextMermaidNodeId(graph.nodes, graph.kind === 'sequence' ? 'Participant' : 'N');
    const candidate = applyNodePreset(defaultNode(graph.kind, nextId, graph, sourceNode), presetId);
    const sourceSize = nodeSize(sourceNode, graph.kind);
    const candidateSize = nodeSize(candidate, graph.kind);
    const horizontalGap = 112;
    const verticalGap = 92;
    const sourceCenter = {
      x: sourcePosition.x + sourceSize.width / 2,
      y: sourcePosition.y + sourceSize.height / 2,
    };
    if (direction === 'left') return { x: sourceCenter.x - sourceSize.width / 2 - candidateSize.width / 2 - horizontalGap, y: sourceCenter.y };
    if (direction === 'top') return { x: sourceCenter.x, y: sourceCenter.y - sourceSize.height / 2 - candidateSize.height / 2 - verticalGap };
    if (direction === 'bottom') return { x: sourceCenter.x, y: sourceCenter.y + sourceSize.height / 2 + candidateSize.height / 2 + verticalGap };
    return { x: sourceCenter.x + sourceSize.width / 2 + candidateSize.width / 2 + horizontalGap, y: sourceCenter.y };
  }

  function addConnectedNode(
    fromId: string,
    direction: QuickAddDirection = 'right',
    presetId?: CanvasNodePresetId,
    edgeDirection: AddNodeOptions['edgeDirection'] = 'from-parent',
  ) {
    addNode(quickAddPoint(fromId, direction, presetId), {
      parentId: fromId,
      presetId,
      edgeDirection,
    });
  }

  function addPresetNode(preset: CanvasNodePreset) {
    if (preset.id === 'state-start' || preset.id === 'state-end') {
      if (!selectedNode || selectedNode.data?.stateRole !== 'state') return;
      addConnectedNode(
        selectedNode.id,
        preset.id === 'state-start' ? 'top' : 'bottom',
        preset.id,
        preset.id === 'state-start' ? 'to-parent' : 'from-parent',
      );
      return;
    }
    addNode(undefined, { presetId: preset.id });
  }

  function addMindmapSibling(nodeId: string) {
    const parentId = graph.edges.find((edge) => edge.to === nodeId)?.from;
    if (parentId) addConnectedNode(parentId, 'bottom', 'mind-topic');
    else addConnectedNode(nodeId, 'right', 'mind-topic');
  }

  function addGanttParallel(nodeId: string, presetId: CanvasNodePresetId = 'gantt-task') {
    const point = quickAddPoint(nodeId, 'bottom', presetId);
    addNode(point, { presetId });
  }

  function addSequenceMessageToNeighbor(nodeId: string, offset: -1 | 1) {
    const index = graph.nodes.findIndex((node) => node.id === nodeId);
    const target = graph.nodes[index + offset];
    if (target) addConnection(nodeId, target.id);
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

  function canRetargetEdge(edge: MermaidFlowEdge, side: 'from' | 'to', nodeId: string) {
    const candidate = { ...edge, [side]: nodeId };
    if (!graph.nodes.some((node) => node.id === nodeId)) return false;
    if (graph.kind === 'mindmap' || graph.kind === 'gantt') {
      if (candidate.from === candidate.to) return false;
      const otherEdges = graph.edges.filter((item) => item.id !== edge.id);
      if (graph.kind === 'mindmap') {
        const rootId = graph.nodes.find((node) => node.data?.mindRoot)?.id;
        if (candidate.to === rootId || otherEdges.some((item) => item.to === candidate.to)) return false;
      }
      if (graph.kind === 'gantt' && otherEdges.some((item) => item.from === candidate.from && item.to === candidate.to)) return false;
      return !connectionWouldCycle(otherEdges, candidate.from, candidate.to);
    }
    if (graph.kind === 'state') {
      const currentTouchesPseudo = graph.nodes.some((node) => (node.id === edge.from || node.id === edge.to) && node.data?.stateRole !== 'state');
      if (currentTouchesPseudo) return false;
      const candidateEdges = graph.edges.map((item) => item.id === edge.id ? candidate : item);
      return graph.nodes.every((node) => {
        if (node.data?.stateRole === 'state') return true;
        const incoming = candidateEdges.filter((item) => item.to === node.id).length;
        const outgoing = candidateEdges.filter((item) => item.from === node.id).length;
        return node.data?.stateRole === 'start' ? incoming === 0 && outgoing === 1 : incoming === 1 && outgoing === 0;
      });
    }
    return true;
  }

  function retargetEdge(id: string, side: 'from' | 'to', nodeId: string) {
    const edge = graph.edges.find((item) => item.id === id);
    if (!edge || !canRetargetEdge(edge, side, nodeId)) return;
    const nextEdge = { ...edge, [side]: nodeId };
    const edges = graph.edges.map((item) => item.id === id ? nextEdge : item);
    let nodes = graph.nodes;
    if (graph.kind === 'gantt') {
      nodes = graph.nodes.map((node) => node.id === nextEdge.to
        ? { ...node, data: { ...node.data, ganttStart: '' } }
        : node);
      nodes = ensureGanttStarts(graph, nodes, edges);
    }
    onChange({ ...graph, nodes, edges });
  }

  function updateNodeData(id: string, update: Partial<NodeData>) {
    onChange({
      ...graph,
      nodes: graph.nodes.map((node) => node.id === id ? { ...node, data: { ...node.data, ...update } } : node),
    });
  }

  function updateNodeDetail(id: string, index: number, value: string) {
    const node = graph.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    const details = [...(node.data?.details ?? [])];
    details[index] = value;
    updateNodeData(id, { details });
  }

  function addNodeDetail(id: string) {
    const node = graph.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    const details = [...(node.data?.details ?? []), graph.kind === 'class' ? '+newMember()' : 'string new_field'];
    updateNodeData(id, { details });
  }

  function removeNodeDetail(id: string, index: number) {
    const node = graph.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    updateNodeData(id, { details: (node.data?.details ?? []).filter((_, detailIndex) => detailIndex !== index) });
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
    if (event.button !== 0 || editingNodeId === node.id || connectMode || spacePressedRef.current) return;
    event.stopPropagation();
    // Selecting rich nodes (class, ER and Gantt) reveals an inspector and can
    // resize the viewport between pointer-down and click. Remember the press so
    // a retargeted click on the shifted canvas cannot immediately clear it.
    lastNodePointerAt.current = performance.now();
    editorRef.current?.focus({ preventScroll: true });
    const point = pointFromEvent(event);
    const position = positions[node.id] ?? { x: 0, y: 0 };
    cancelPointerInteractions();
    setAlignmentGuides({});
    setSelection({ kind: 'node', id: node.id });
    setEditingEdgeId(null);
    const nextDrag = {
      id: node.id,
      pointerId: event.pointerId,
      offsetX: point.x - position.x,
      offsetY: point.y - position.y,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    };
    draggingRef.current = nextDrag;
    setDragging(nextDrag);
    captureInteractionPointer(event.currentTarget, event.pointerId);
  }

  function activateNode(node: MermaidFlowNode) {
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

  function handleNodeClick(event: ReactMouseEvent<HTMLDivElement>, node: MermaidFlowNode) {
    event.stopPropagation();
    if (connectMode && event.detail > 1) return;
    activateNode(node);
  }

  function beginConnectionFrom(nodeId: string) {
    setConnectMode(true);
    setConnectingFrom(nodeId);
    setSelection({ kind: 'node', id: nodeId });
    setEditingNodeId(null);
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
    if (event.metaKey || event.ctrlKey) {
      if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') {
        event.preventDefault();
        zoomAroundViewportCenter(zoomRef.current + 0.1);
        return;
      }
      if (event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract') {
        event.preventDefault();
        zoomAroundViewportCenter(zoomRef.current - 0.1);
        return;
      }
      if (event.key === '0' || event.code === 'Numpad0') {
        event.preventDefault();
        zoomAroundViewportCenter(1);
        return;
      }
    }
    if (!isControl && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      fitContent();
      return;
    }
    if (!isControl && !event.metaKey && !event.ctrlKey && !event.altKey && event.key === '0') {
      event.preventDefault();
      zoomAroundViewportCenter(1);
      return;
    }
    if (!isControl && event.code === 'Space') {
      event.preventDefault();
      spacePressedRef.current = true;
      setSpacePressed(true);
      return;
    }
    if (event.key === 'Escape') {
      const isFormControl = target.matches('input, textarea, select') || target.isContentEditable;
      const hasCanvasState = Boolean(
        dragging || connectionDrag || panStateRef.current || panning
        || connectingFrom || connectMode || editingNodeId || editingEdgeId || selection,
      );
      if (!isFormControl && !hasCanvasState) return;
      event.preventDefault();
      event.stopPropagation();
      if (isFormControl) target.blur();
      finishViewportPanByPointerId(panStateRef.current?.pointerId);
      cancelPointerInteractions();
      setConnectingFrom(null);
      setConnectMode(false);
      setEditingNodeId(null);
      setEditingEdgeId(null);
      setSelection(null);
      return;
    }
    if (isControl) return;
    if (event.key === 'Tab' && selectedNode && quickAddDirections.length) {
      event.preventDefault();
      addConnectedNode(selectedNode.id, quickAddDirections[0]);
      return;
    }
    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      addNode();
      return;
    }
    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'c' && selectedNode) {
      event.preventDefault();
      beginConnectionFrom(selectedNode.id);
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selection) {
      event.preventDefault();
      removeSelection();
    } else if (event.key === 'Enter' && selection?.kind === 'node'
      && !(graph.kind === 'state' && selectedNode?.data?.stateRole !== 'state')) {
      event.preventDefault();
      setEditingNodeId(selection.id);
    } else if (event.key === 'Enter' && selection?.kind === 'edge' && edgeSupportsLabel) {
      event.preventDefault();
      setEditingEdgeId(selection.id);
    }
  }

  function startConnectionDrag(event: ReactPointerEvent<HTMLButtonElement>, nodeId: string) {
    if (event.button !== 0 || spacePressedRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    cancelPointerInteractions();
    setSelection({ kind: 'node', id: nodeId });
    const nextConnection = {
      from: nodeId,
      pointerId: event.pointerId,
      pointer: pointFromEvent(event),
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    };
    connectionDragRef.current = nextConnection;
    setConnectionDrag(nextConnection);
    captureInteractionPointer(event.currentTarget, event.pointerId);
  }

  function setZoomWithTarget(nextZoom: number, target: ViewportTarget) {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    if (!viewport || !stage) return;
    const normalized = clampZoom(nextZoom);
    pendingViewportRef.current = { target, expectedZoom: normalized };
    if (Math.abs(normalized - zoom) <= 0.0005) {
      applyViewportTarget(viewport, stage, target, normalized);
      pendingViewportRef.current = null;
      shouldCenterViewport.current = false;
      return;
    }
    zoomRef.current = normalized;
    setZoom(normalized);
  }

  function preserveViewportCenter() {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    if (!viewport || !stage || !zoomRef.current) return;
    const viewportRect = viewport.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const viewportX = viewport.clientWidth / 2;
    const viewportY = viewport.clientHeight / 2;
    pendingViewportRef.current = {
      expectedZoom: zoomRef.current,
      target: {
        kind: 'anchor',
        canvasX: (viewportRect.left + viewportX - stageRect.left) / zoomRef.current,
        canvasY: (viewportRect.top + viewportY - stageRect.top) / zoomRef.current,
        viewportX,
        viewportY,
      },
    };
    shouldCenterViewport.current = false;
  }

  function zoomAtPoint(nextZoom: number, clientX: number, clientY: number) {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    if (!viewport || !stage) return;
    const viewportRect = viewport.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const viewportX = Math.max(0, Math.min(viewport.clientWidth, clientX - viewportRect.left));
    const viewportY = Math.max(0, Math.min(viewport.clientHeight, clientY - viewportRect.top));
    const currentZoom = zoomRef.current;
    setZoomWithTarget(nextZoom, {
      kind: 'anchor',
      canvasX: Math.max(0, Math.min(stageWidth, (clientX - stageRect.left) / currentZoom)),
      canvasY: Math.max(0, Math.min(stageHeight, (clientY - stageRect.top) / currentZoom)),
      viewportX,
      viewportY,
    });
  }

  function zoomAroundViewportCenter(nextZoom: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    zoomAtPoint(nextZoom, rect.left + viewport.clientWidth / 2, rect.top + viewport.clientHeight / 2);
  }

  function fitContent(maxZoom = MAX_ZOOM) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = mermaidCanvasLayoutBounds(graph, canvasLayout);
    const nextZoom = mermaidCanvasFitZoom(bounds, viewport.clientWidth, viewport.clientHeight, maxZoom);
    setZoomWithTarget(nextZoom, {
      kind: 'center',
      canvasX: (bounds.minX + bounds.maxX) / 2,
      canvasY: (bounds.minY + bounds.maxY) / 2,
    });
  }

  function handleViewportPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button === 0 || event.button === 1) editorRef.current?.focus({ preventScroll: true });
    const target = event.target as Element;
    const directPan = event.button === 0 && !target.closest(
      '[data-mermaid-node-id], [data-mermaid-edge-id], button, input, textarea, select, a, [contenteditable="true"]',
    );
    const shouldPan = event.button === 1 || (event.button === 0 && (spacePressedRef.current || directPan));
    if (!shouldPan || dragging || connectionDrag) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const captureImmediately = event.button === 1 || spacePressedRef.current;
    // Keep an ordinary blank click/double-click available for clearing the
    // selection or adding a node. Direct left-button panning is captured only
    // after the pointer crosses the movement threshold below.
    if (captureImmediately) event.preventDefault();
    event.stopPropagation();
    didPanRef.current = false;
    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      captured: captureImmediately,
    };
    if (captureImmediately) {
      try {
        viewport.setPointerCapture(event.pointerId);
        setPanning(true);
      } catch {
        panStateRef.current = null;
        setPanning(false);
      }
    }
  }

  function handleViewportPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panStateRef.current;
    const viewport = viewportRef.current;
    if (!pan || pan.pointerId !== event.pointerId || !viewport) return;
    if (event.buttons === 0) {
      finishViewportPanByPointerId(event.pointerId);
      return;
    }
    const deltaX = event.clientX - pan.startX;
    const deltaY = event.clientY - pan.startY;
    const crossedThreshold = Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3;
    if (!pan.captured && !crossedThreshold) return;
    event.preventDefault();
    if (!pan.captured) {
      try {
        viewport.setPointerCapture(event.pointerId);
        pan.captured = true;
        setPanning(true);
      } catch {
        finishViewportPanByPointerId(event.pointerId);
        return;
      }
    }
    if (crossedThreshold) didPanRef.current = true;
    viewport.scrollLeft = pan.scrollLeft - deltaX;
    viewport.scrollTop = pan.scrollTop - deltaY;
  }

  function finishViewportPan(event: ReactPointerEvent<HTMLDivElement>) {
    finishViewportPanByPointerId(event.pointerId);
  }

  return (
    <div
      className={`mermaid-canvas-editor canvas-style-${canvasStyle}`}
      ref={editorRef}
      role="region"
      aria-label="Mermaid 可视化画布编辑器"
      tabIndex={0}
      onKeyDown={handleEditorKeyDown}
    >
      <div className="canvas-editor-toolbar">
        <div className="canvas-tool-group primary-tools">
          <button type="button" onClick={() => addNode()}><Plus size={15} /> {copy.add}</button>
          <button
            type="button"
            className={connectMode ? 'active' : ''}
            onClick={() => {
              if (connectMode) {
                setConnectMode(false);
                setConnectingFrom(null);
              } else if (selectedNode) {
                beginConnectionFrom(selectedNode.id);
              } else {
                setConnectMode(true);
                setConnectingFrom(null);
              }
            }}
            aria-pressed={connectMode}
          >
            <Link2 size={15} /> {copy.connect}
          </button>
          <button type="button" onClick={() => applyAutomaticLayout()} title={`重新排列${copy.nodes}`}><RefreshCcw size={14} /> 自动排列</button>
        </div>

        <div className="canvas-node-library" role="group" aria-label={`${copy.node}库`}>
          <span>对象</span>
          {nodePresets.map((preset) => {
            const Icon = preset.icon;
            const disabled = Boolean(preset.requiresSelection && (!selectedNode || selectedNode.data?.stateRole !== 'state'));
            return (
              <button
                type="button"
                key={preset.id}
                disabled={disabled}
                onClick={() => addPresetNode(preset)}
                title={`${preset.description}${preset.requiresSelection ? '（先选择普通状态）' : ''}`}
              >
                <Icon size={13} /><span>{preset.label}</span>
              </button>
            );
          })}
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

        <div className="canvas-assist-tools" role="group" aria-label="画布辅助">
          <button type="button" className={snapToGrid ? 'active' : ''} onClick={() => setSnapToGrid((value) => !value)} aria-pressed={snapToGrid} title="拖动时吸附到网格和其他对象"><Square size={12} /> 吸附</button>
        </div>

        <div className="canvas-style-tools" role="group" aria-label="画布风格">
          <button type="button" className={canvasStyle === 'standard' ? 'active' : ''} onClick={() => setCanvasStyle('standard')} aria-pressed={canvasStyle === 'standard'}><Square size={13} /> 标准</button>
          <button type="button" className={canvasStyle === 'handdrawn' ? 'active' : ''} onClick={() => setCanvasStyle('handdrawn')} aria-pressed={canvasStyle === 'handdrawn'}><Pencil size={13} /> 手绘</button>
        </div>

        <div className="canvas-zoom-tools" role="group" aria-label="画布缩放">
          <button type="button" onClick={() => zoomAroundViewportCenter(zoomRef.current - 0.1)} aria-label="缩小画布" title="缩小（⌘/Ctrl -）"><ZoomOut size={15} /></button>
          <button type="button" className="canvas-zoom-value" onClick={() => zoomAroundViewportCenter(1)} aria-label={`当前缩放 ${Math.round(zoom * 100)}%，点击重置`} title="重置为 100%（0 或 ⌘/Ctrl 0）">{Math.round(zoom * 100)}%</button>
          <button type="button" onClick={() => zoomAroundViewportCenter(zoomRef.current + 0.1)} aria-label="放大画布" title="放大（⌘/Ctrl +）"><ZoomIn size={15} /></button>
          <button type="button" className="canvas-fit-button" onClick={() => fitContent()} title="适配全部内容（F）"><Maximize2 size={14} /> 适配</button>
        </div>
      </div>

      <div className="canvas-context-bar" aria-live="polite">
        {connectMode ? (
          <>
            <span className="canvas-selection-title"><Link2 size={13} /><b>{connectingNode ? `起点：${connectingNode.label || connectingNode.id}` : `添加${copy.edge}`}</b></span>
            <span className="canvas-context-divider" />
            <span className="canvas-connect-guidance">
              {connectingNode
                ? `点击目标${copy.node}${graph.kind === 'sequence' ? '或其生命线' : ''}完成${copy.edge}；可连续添加`
                : `先点击一个${copy.node}作为起点`}
            </span>
            {connectingNode ? <button type="button" onClick={() => { setConnectingFrom(null); setSelection(null); }}>重选起点</button> : null}
            <button type="button" onClick={() => { setConnectMode(false); setConnectingFrom(null); }}>完成</button>
          </>
        ) : selectedNode ? (
          <>
            <span className="canvas-selection-title"><MousePointer2 size={13} /><b>{selectedNode.label || selectedNode.id}</b></span>
            <span className="canvas-context-divider" />
            {canRenameSelectedNode ? <button type="button" onClick={() => setEditingNodeId(selectedNode.id)}><Pencil size={13} /> 改名</button> : null}
            {graph.kind === 'flowchart' ? (
              <div className="canvas-shape-tools" role="group" aria-label="节点形状与快速创建">
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
                <button type="button" onClick={() => addConnectedNode(selectedNode.id, 'right', 'flow-process')}><ArrowRight size={13} /> 下游流程</button>
                <button type="button" onClick={() => addConnectedNode(selectedNode.id, 'bottom', 'flow-decision')}><Diamond size={13} /> 分支判断</button>
              </div>
            ) : null}
            {graph.kind === 'sequence' ? (
              <div className="canvas-semantic-tools" role="group" aria-label="参与者类型">
                <button type="button" className={selectedNode.data?.sequenceType === 'actor' ? 'active' : ''} onClick={() => updateNodeData(selectedNode.id, { sequenceType: 'actor' })}>角色</button>
                <button type="button" className={selectedNode.data?.sequenceType !== 'actor' ? 'active' : ''} onClick={() => updateNodeData(selectedNode.id, { sequenceType: 'participant' })}>参与者</button>
                <button type="button" onClick={() => beginConnectionFrom(selectedNode.id)}><Link2 size={13} /> 从这里发消息</button>
                <button type="button" disabled={selectedNodeIndex <= 0} onClick={() => addSequenceMessageToNeighbor(selectedNode.id, -1)}><ArrowLeft size={13} /> 发给上一个</button>
                <button type="button" disabled={selectedNodeIndex < 0 || selectedNodeIndex >= graph.nodes.length - 1} onClick={() => addSequenceMessageToNeighbor(selectedNode.id, 1)}><ArrowRight size={13} /> 发给下一个</button>
                <button type="button" onClick={() => addConnection(selectedNode.id, selectedNode.id)}>自消息</button>
                <button type="button" onClick={() => addConnectedNode(selectedNode.id, 'right', 'sequence-participant')}><Plus size={13} /> 新参与者并发送</button>
              </div>
            ) : null}
            {graph.kind === 'state' ? (
              <div className="canvas-semantic-tools" role="group" aria-label="状态类型">
                <button type="button" className={selectedNode.data?.stateRole === 'state' ? 'active' : ''} onClick={() => changeStateRole(selectedNode.id, 'state')}>普通状态</button>
                <button type="button" className={selectedNode.data?.stateRole === 'start' ? 'active' : ''} disabled={selectedNode.data?.stateRole !== 'start' && (selectedNodeIncoming !== 0 || selectedNodeOutgoing !== 1)} onClick={() => changeStateRole(selectedNode.id, 'start')}>开始</button>
                <button type="button" className={selectedNode.data?.stateRole === 'end' ? 'active' : ''} disabled={selectedNode.data?.stateRole !== 'end' && (selectedNodeIncoming !== 1 || selectedNodeOutgoing !== 0)} onClick={() => changeStateRole(selectedNode.id, 'end')}>结束</button>
                {selectedNode.data?.stateRole === 'state' ? <button type="button" onClick={() => addConnectedNode(selectedNode.id, 'right', 'state-state')}><ArrowRight size={13} /> 下一状态</button> : null}
                {selectedNode.data?.stateRole === 'state' ? <button type="button" onClick={() => addConnectedNode(selectedNode.id, 'top', 'state-start', 'to-parent')}><Circle size={12} /> 添加起点</button> : null}
                {selectedNode.data?.stateRole === 'state' ? <button type="button" onClick={() => addConnectedNode(selectedNode.id, 'bottom', 'state-end')}><Circle size={12} /> 添加终点</button> : null}
              </div>
            ) : null}
            {graph.kind === 'mindmap' ? (
              <div className="canvas-semantic-tools" role="group" aria-label="主题结构">
                <button type="button" onClick={() => addConnectedNode(selectedNode.id, 'right', 'mind-topic')}><Plus size={13} /> 子主题</button>
                <button type="button" onClick={() => addMindmapSibling(selectedNode.id)}><ArrowDown size={13} /> 同级主题</button>
              </div>
            ) : null}
            {graph.kind === 'gantt' ? (
              <div className="canvas-semantic-tools" role="group" aria-label="任务结构">
                <button type="button" onClick={() => addConnectedNode(selectedNode.id, 'right', 'gantt-task')}><ArrowRight size={13} /> 后续任务</button>
                <button type="button" onClick={() => addGanttParallel(selectedNode.id)}><ArrowDown size={13} /> 并行任务</button>
                <button type="button" onClick={() => addGanttParallel(selectedNode.id, 'gantt-milestone')}><Diamond size={12} /> 里程碑</button>
              </div>
            ) : null}
            {graph.kind === 'class' ? <button type="button" onClick={() => addConnectedNode(selectedNode.id, 'right', 'class-class')}><Plus size={13} /> 关联类</button> : null}
            {graph.kind === 'er' ? <button type="button" onClick={() => addConnectedNode(selectedNode.id, 'right', 'er-entity')}><Plus size={13} /> 关联实体</button> : null}
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
                <label className="canvas-context-select"><span>类型</span><select value={selectedEdge.data?.token ?? '->>'} onChange={(event) => updateEdgeToken(selectedEdge.id, event.target.value)}>{SEQUENCE_MESSAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
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
              : `选择${copy.node}后用方向箭头快速创建 · 右下角端点可连接已有${copy.node} · 双击空白新增`}
          </span>
        )}
      </div>

      {selectedNode && (graph.kind === 'class' || graph.kind === 'er') ? (
        <div className="canvas-semantic-inspector canvas-details-inspector">
          <span className="canvas-inspector-heading">{graph.kind === 'class' ? '类成员' : '实体字段'}</span>
          <div className="canvas-detail-list">
            {(selectedNode.data?.details ?? []).map((detail, index) => (
              <label key={`${selectedNode.id}-detail-editor-${index}`}>
                <span>{index + 1}</span>
                <input
                  value={detail}
                  onChange={(event) => updateNodeDetail(selectedNode.id, index, event.target.value)}
                  placeholder={graph.kind === 'class' ? '+String id 或 +save()' : 'string id PK'}
                  aria-label={`${graph.kind === 'class' ? '类成员' : '实体字段'} ${index + 1}`}
                />
                <button type="button" className="canvas-detail-remove" onClick={() => removeNodeDetail(selectedNode.id, index)} aria-label={`删除第 ${index + 1} 项`}><Trash2 size={12} /></button>
              </label>
            ))}
            <button type="button" className="canvas-detail-add" onClick={() => addNodeDetail(selectedNode.id)}><Plus size={12} /> 添加{graph.kind === 'class' ? '成员' : '字段'}</button>
          </div>
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

      {selectedEdge ? (
        <div className="canvas-semantic-inspector canvas-edge-inspector">
          {!selectedEdgeTouchesStatePseudo ? (
            <>
              <label>
                <span>{graph.kind === 'mindmap' ? '父主题' : graph.kind === 'gantt' ? '前置任务' : '起点'}</span>
                <select value={selectedEdge.from} onChange={(event) => retargetEdge(selectedEdge.id, 'from', event.target.value)}>
                  {graph.nodes.map((node) => <option key={node.id} value={node.id} disabled={!canRetargetEdge(selectedEdge, 'from', node.id)}>{node.label || node.id}</option>)}
                </select>
              </label>
              <label>
                <span>{graph.kind === 'mindmap' ? '子主题' : graph.kind === 'gantt' ? '后续任务' : '终点'}</span>
                <select value={selectedEdge.to} onChange={(event) => retargetEdge(selectedEdge.id, 'to', event.target.value)}>
                  {graph.nodes.map((node) => <option key={node.id} value={node.id} disabled={!canRetargetEdge(selectedEdge, 'to', node.id)}>{node.label || node.id}</option>)}
                </select>
              </label>
            </>
          ) : <span className="canvas-inspector-note">开始或结束状态的连接端点由状态语义固定</span>}
          {graph.kind === 'class' && selectedClassRelation ? (
            <>
              <label><span>关系类型</span><select value={selectedClassRelation.relation} onChange={(event) => updateEdgeToken(selectedEdge.id, replaceClassRelation(selectedEdge.data?.token, event.target.value))}>{CLASS_RELATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label><span>起点多重性</span><input value={selectedClassRelation.fromMultiplicity ?? ''} onChange={(event) => updateEdgeToken(selectedEdge.id, replaceClassMultiplicity(selectedEdge.data?.token, 'from', event.target.value))} placeholder="例如 1" /></label>
              <label><span>终点多重性</span><input value={selectedClassRelation.toMultiplicity ?? ''} onChange={(event) => updateEdgeToken(selectedEdge.id, replaceClassMultiplicity(selectedEdge.data?.token, 'to', event.target.value))} placeholder="例如 0..*" /></label>
            </>
          ) : null}
          {graph.kind === 'er' && selectedErRelation ? (
            <>
              <label><span>起点基数</span><select value={selectedErRelation.from} onChange={(event) => updateEdgeToken(selectedEdge.id, makeErToken(event.target.value as ErCardinality, selectedErRelation.to, selectedErRelation.identifying))}>{ER_CARDINALITIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label><span>终点基数</span><select value={selectedErRelation.to} onChange={(event) => updateEdgeToken(selectedEdge.id, makeErToken(selectedErRelation.from, event.target.value as ErCardinality, selectedErRelation.identifying))}>{ER_CARDINALITIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label><span>关系</span><select value={selectedErRelation.identifying ? 'identifying' : 'non-identifying'} onChange={(event) => updateEdgeToken(selectedEdge.id, makeErToken(selectedErRelation.from, selectedErRelation.to, event.target.value === 'identifying'))}><option value="identifying">标识关系</option><option value="non-identifying">非标识关系</option></select></label>
            </>
          ) : null}
          {graph.kind === 'class' ? <span className="canvas-inspector-note">{classRelationLabel(selectedEdge.data?.token)} · 可直接更换连接两端</span> : null}
        </div>
      ) : null}

      <div
        className={`canvas-editor-viewport${connectMode ? ' connect-mode' : ''}${spacePressed && !panning ? ' pan-ready' : ''}${panning ? ' is-panning' : ''}`}
        ref={viewportRef}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={finishViewportPan}
        onPointerCancel={finishViewportPan}
        onLostPointerCapture={finishViewportPan}
        onClickCapture={(event) => {
          if (!didPanRef.current) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (performance.now() - lastNodePointerAt.current < 750
            || target.closest('[data-mermaid-node-id], [data-mermaid-edge-id], .canvas-edge-label')) return;
          setSelection(null);
          setEditingNodeId(null);
          setEditingEdgeId(null);
        }}
        onDoubleClick={handleCanvasDoubleClick}
        onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}
      >
        <div className="canvas-editor-stage-center">
          <div className="canvas-editor-scaled-stage" style={{ width: stageWidth * zoom, height: stageHeight * zoom }}>
            <div
              className="canvas-editor-stage"
              ref={stageRef}
              style={{ width: stageWidth, height: stageHeight, transform: `scale(${zoom})` }}
          >
            <svg className="canvas-edge-layer" width={stageWidth} height={stageHeight} aria-hidden="true">
              <defs>
                <marker id={markerId} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto-start-reverse" markerUnits="strokeWidth">
                  <path d="M 0 0 L 9 4.5 L 0 9 z" />
                </marker>
                <marker id={crossMarkerId} markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                  <path className="canvas-marker-cross" d="M 1 1 L 8 8 M 8 1 L 1 8" />
                </marker>
                <marker id={asyncMarkerId} markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                  <path className="canvas-marker-async" d="M 1 1 L 8 5 L 1 9" />
                </marker>
                <filter id={sketchFilterId} filterUnits="userSpaceOnUse" x={-120} y={-120} width={stageWidth + 240} height={stageHeight + 240} colorInterpolationFilters="sRGB">
                  <feTurbulence type="fractalNoise" baseFrequency="0.015 0.075" numOctaves="1" seed="7" result="sketchNoise" />
                  <feDisplacementMap in="SourceGraphic" in2="sketchNoise" scale="1.35" xChannelSelector="R" yChannelSelector="G" />
                </filter>
              </defs>
              <g className="canvas-drawing-layer" style={canvasStyle === 'handdrawn' ? { filter: `url(#${sketchFilterId})` } : undefined}>
                {graph.kind === 'sequence' ? graph.nodes.map((node) => {
                  const position = positions[node.id];
                  if (!position) return null;
                  const size = nodeSize(node, graph.kind);
                  const x = position.x + size.width / 2;
                  return <line key={`lifeline-${node.id}`} className="canvas-sequence-lifeline" x1={x} x2={x} y1={position.y + size.height} y2={stageHeight - 25} />;
                }) : null}
                {graph.edges.map((edge) => {
                  const geometry = edgeGeometries.get(edge.id);
                  if (!geometry) return null;
                  const selected = selection?.kind === 'edge' && selection.id === edge.id;
                  const rawRelation = graph.kind === 'class' ? parseClassToken(edge.data?.token).relation : edge.data?.token ?? '';
                  const sequenceVisual = graph.kind === 'sequence' ? mermaidSequenceMessageVisual(rawRelation) : null;
                  const tokenDashed = sequenceVisual?.dashed ?? rawRelation.startsWith('..');
                  const markerEnd = graph.kind === 'flowchart'
                    ? edge.style !== 'line'
                    : graph.kind === 'state' || graph.kind === 'gantt'
                      || (graph.kind === 'class' && rawRelation.endsWith('>') && !rawRelation.startsWith('<|'));
                  const markerStartUrl = sequenceVisual ? sequenceMarkerUrl(sequenceVisual.startMarker) : undefined;
                  const markerEndUrl = sequenceVisual
                    ? sequenceMarkerUrl(sequenceVisual.endMarker)
                    : markerEnd ? `url(#${markerId})` : undefined;
                  return (
                    <g key={edge.id} className={`canvas-edge kind-${graph.kind} ${edge.style}${tokenDashed ? ' token-dashed' : ''}${selected ? ' selected' : ''}`} data-mermaid-edge-id={edge.id}>
                      <path className="canvas-edge-visible" d={geometry.path} markerStart={markerStartUrl} markerEnd={markerEndUrl} />
                      <path
                        className="canvas-edge-hit"
                        d={geometry.path}
                        onClick={(event) => { event.stopPropagation(); setSelection({ kind: 'edge', id: edge.id }); setEditingNodeId(null); }}
                        onDoubleClick={(event) => { event.stopPropagation(); setSelection({ kind: 'edge', id: edge.id }); if (edgeSupportsLabel) setEditingEdgeId(edge.id); }}
                      />
                    </g>
                  );
                })}
                {graph.kind === 'sequence' ? graph.nodes.map((node) => {
                  const position = positions[node.id];
                  if (!position) return null;
                  const size = nodeSize(node, graph.kind);
                  const x = position.x + size.width / 2;
                  return (
                    <line
                      key={`lifeline-hit-${node.id}`}
                      className="canvas-sequence-lifeline-hit"
                      data-mermaid-node-id={node.id}
                      x1={x}
                      x2={x}
                      y1={position.y + size.height}
                      y2={stageHeight - 25}
                      vectorEffect="non-scaling-stroke"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (connectMode && event.detail > 1) return;
                        activateNode(node);
                      }}
                    />
                  );
                }) : null}
                {connectionDrag ? (() => {
                  const sourceNode = graph.nodes.find((node) => node.id === connectionDrag.from);
                  const position = positions[connectionDrag.from];
                  if (!sourceNode || !position) return null;
                  const size = nodeSize(sourceNode, graph.kind);
                  const start = { x: position.x + size.width, y: position.y + size.height / 2 };
                  return <path className="canvas-edge-preview" d={`M ${start.x} ${start.y} L ${connectionDrag.pointer.x} ${connectionDrag.pointer.y}`} markerEnd={`url(#${markerId})`} />;
                })() : null}
              </g>
            </svg>

            {alignmentGuides.x !== undefined ? <div className="canvas-alignment-guide vertical" style={{ left: alignmentGuides.x, height: stageHeight }} /> : null}
            {alignmentGuides.y !== undefined ? <div className="canvas-alignment-guide horizontal" style={{ top: alignmentGuides.y, width: stageWidth }} /> : null}

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
                  onPointerCancel={(event) => cancelPointerInteractions(event.pointerId)}
                  onLostPointerCapture={(event) => cancelPointerInteractions(event.pointerId)}
                  onClick={(event) => handleNodeClick(event, node)}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (connectMode) return;
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
                  {selected && quickAddDirections.length ? (
                    <div className="canvas-node-quick-add" aria-label={`围绕 ${node.label} 快速创建`}>
                      {QUICK_ADD_OPTIONS.filter((option) => quickAddDirections.includes(option.value)).map(({ value, label, icon: Icon }) => (
                        <button
                          type="button"
                          key={value}
                          className={`quick-add-${value}`}
                          onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (performance.now() - lastNodePointerAt.current < 400) return;
                            addConnectedNode(node.id, value, defaultQuickPreset(graph.kind));
                          }}
                          aria-label={`${label}${copy.node}`}
                          title={`${label}${copy.node}（Tab 可快速向右创建）`}
                        >
                          <Icon size={12} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {selected ? (
                    <button
                      type="button"
                      className="canvas-node-connector"
                      onPointerDown={(event) => startConnectionDrag(event, node.id)}
                      onPointerCancel={(event) => cancelPointerInteractions(event.pointerId)}
                      onLostPointerCapture={(event) => cancelPointerInteractions(event.pointerId)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`从 ${node.label} 创建${copy.edge}`}
                      title={`点击后再选目标，或直接拖到另一${copy.node}${graph.kind === 'sequence' ? ' / 生命线' : ''}`}
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
      </div>
      <div className="canvas-editor-status">
        <span>{graph.nodes.length} 个{copy.nodes} · {graph.edges.length} 条{copy.edges}</span>
        <span>{graph.kind === 'sequence' ? '点击参与者或生命线选择 · ' : ''}Tab 创建并连接 · C 连线 · N 新建 · 拖动空白平移 · 滚轮缩放 · F 适配</span>
      </div>
    </div>
  );
}
