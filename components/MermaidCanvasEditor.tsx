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

function nodeSize(shape: MermaidNodeShape) {
  if (shape === 'circle') return { width: 92, height: 92 };
  if (shape === 'decision') return { width: 112, height: 92 };
  if (shape === 'terminal') return { width: 166, height: 64 };
  return { width: 176, height: 72 };
}

function clampPosition(node: MermaidFlowNode, point: Point): Point {
  const size = nodeSize(node.shape);
  return {
    x: Math.max(18, Math.min(STAGE_WIDTH - size.width - 18, point.x)),
    y: Math.max(18, Math.min(STAGE_HEIGHT - size.height - 18, point.y)),
  };
}

function autoLayout(graph: MermaidFlowGraph): NodePositions {
  if (!graph.nodes.length) return {};

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
  const horizontal = graph.direction === 'LR' || graph.direction === 'RL';
  const reverse = graph.direction === 'BT' || graph.direction === 'RL';
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
      const size = nodeSize(node.shape);
      const cross = nodes.length === 1 ? STAGE_PADDING + crossAvailable / 2 : crossStart + crossIndex * crossStep;
      positions[node.id] = clampPosition(node, horizontal
        ? { x: main - size.width / 2, y: cross - size.height / 2 }
        : { x: cross - size.width / 2, y: main - size.height / 2 });
    });
  });
  return positions;
}

function edgeGeometry(edge: MermaidFlowEdge, graph: MermaidFlowGraph, positions: NodePositions) {
  const fromNode = graph.nodes.find((node) => node.id === edge.from);
  const toNode = graph.nodes.find((node) => node.id === edge.to);
  const fromPosition = positions[edge.from];
  const toPosition = positions[edge.to];
  if (!fromNode || !toNode || !fromPosition || !toPosition) return null;

  const fromSize = nodeSize(fromNode.shape);
  const toSize = nodeSize(toNode.shape);
  const fromCenter = { x: fromPosition.x + fromSize.width / 2, y: fromPosition.y + fromSize.height / 2 };
  const toCenter = { x: toPosition.x + toSize.width / 2, y: toPosition.y + toSize.height / 2 };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const fromFactor = 1 / Math.max(Math.abs(dx) / (fromSize.width / 2), Math.abs(dy) / (fromSize.height / 2), 1);
  const toFactor = 1 / Math.max(Math.abs(dx) / (toSize.width / 2), Math.abs(dy) / (toSize.height / 2), 1);
  const start = { x: fromCenter.x + dx * fromFactor, y: fromCenter.y + dy * fromFactor };
  const end = { x: toCenter.x - dx * toFactor, y: toCenter.y - dy * toFactor };
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const path = horizontal
    ? `M ${start.x} ${start.y} C ${(start.x + end.x) / 2} ${start.y}, ${(start.x + end.x) / 2} ${end.y}, ${end.x} ${end.y}`
    : `M ${start.x} ${start.y} C ${start.x} ${(start.y + end.y) / 2}, ${end.x} ${(start.y + end.y) / 2}, ${end.x} ${end.y}`;
  return {
    path,
    label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
  };
}

function nextEdgeId(edges: MermaidFlowEdge[]) {
  let index = edges.length + 1;
  const existing = new Set(edges.map((edge) => edge.id));
  while (existing.has(`edge-${index}`)) index += 1;
  return `edge-${index}`;
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
  const previousGraphShape = useRef({ direction: graph.direction, nodeSignature });
  const shouldCenterViewport = useRef(true);
  const wasActive = useRef(active);

  useEffect(() => {
    const previous = previousGraphShape.current;
    const directionChanged = previous.direction !== graph.direction;
    const nodesChanged = previous.nodeSignature !== nodeSignature;
    previousGraphShape.current = { direction: graph.direction, nodeSignature };
    if (directionChanged || nodesChanged) {
      shouldCenterViewport.current = true;
    }
    setPositions((current) => {
      const laidOut = autoLayout(graph);
      if (directionChanged || !Object.keys(current).length) return laidOut;
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
    const maxX = Math.max(...visibleNodes.map((node) => positions[node.id].x + nodeSize(node.shape).width));
    const maxY = Math.max(...visibleNodes.map((node) => positions[node.id].y + nodeSize(node.shape).height));
    const contentWidth = (maxX - minX) * zoom;
    const contentHeight = (maxY - minY) * zoom;
    viewport.scrollLeft = Math.max(0, contentWidth <= viewport.clientWidth - 40
      ? ((minX + maxX) / 2) * zoom - viewport.clientWidth / 2
      : minX * zoom - 32);
    viewport.scrollTop = Math.max(0, contentHeight <= viewport.clientHeight - 40
      ? ((minY + maxY) / 2) * zoom - viewport.clientHeight / 2
      : minY * zoom - 26);
    shouldCenterViewport.current = false;
  }, [active, graph.nodes, positions, zoom]);

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
        const node = graph.nodes.find((candidate) => candidate.id === dragging.id);
        if (!node) return;
        setPositions((current) => ({
          ...current,
          [dragging.id]: clampPosition(node, { x: point.x - dragging.offsetX, y: point.y - dragging.offsetY }),
        }));
      }
      if (connectionDrag) setConnectionDrag((current) => current ? { ...current, pointer: point } : null);
    }

    function handlePointerUp(event: PointerEvent) {
      setDragging(null);
      if (!connectionDrag) return;
      const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const target = element?.closest<HTMLElement>('[data-mermaid-node-id]')?.dataset.mermaidNodeId;
      if (target && target !== connectionDrag.from) addConnection(connectionDrag.from, target);
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
  const edgeGeometries = useMemo(() => new Map(graph.edges.map((edge) => [edge.id, edgeGeometry(edge, graph, positions)])), [graph, positions]);

  function pointFromEvent(event: { clientX: number; clientY: number }): Point {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2 };
    return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
  }

  function addConnection(from: string, to: string) {
    if (from === to) return;
    const edge: MermaidFlowEdge = { id: nextEdgeId(graph.edges), from, to, label: '', style: 'arrow' };
    onChange({ ...graph, edges: [...graph.edges, edge] });
    setSelection({ kind: 'edge', id: edge.id });
    setConnectingFrom(connectMode ? to : null);
  }

  function addNode(point?: Point) {
    const id = nextMermaidNodeId(graph.nodes);
    const node: MermaidFlowNode = { id, label: '新节点', shape: 'rectangle' };
    const fallbackIndex = graph.nodes.length;
    const fallback = { x: STAGE_WIDTH / 2 - 88 + (fallbackIndex % 4) * 18, y: STAGE_HEIGHT / 2 - 36 + (fallbackIndex % 4) * 18 };
    setPositions((current) => ({ ...current, [id]: clampPosition(node, point ? { x: point.x - 88, y: point.y - 36 } : fallback) }));
    onChange({ ...graph, nodes: [...graph.nodes, node] });
    setSelection({ kind: 'node', id });
    setEditingNodeId(id);
    setEditingEdgeId(null);
  }

  function removeSelection() {
    if (!selection) return;
    if (selection.kind === 'node') {
      onChange({
        ...graph,
        nodes: graph.nodes.filter((node) => node.id !== selection.id),
        edges: graph.edges.filter((edge) => edge.from !== selection.id && edge.to !== selection.id),
      });
    } else {
      onChange({ ...graph, edges: graph.edges.filter((edge) => edge.id !== selection.id) });
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

  function handleNodePointerDown(event: ReactPointerEvent<HTMLDivElement>, node: MermaidFlowNode) {
    if (event.button !== 0 || editingNodeId === node.id || connectMode) return;
    event.preventDefault();
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
      if (connectingFrom && connectingFrom !== node.id) addConnection(connectingFrom, node.id);
      else setConnectingFrom(node.id);
    }
    setSelection({ kind: 'node', id: node.id });
    setEditingEdgeId(null);
  }

  function handleCanvasDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('[data-mermaid-node-id], [data-mermaid-edge-id], .canvas-edge-label')) return;
    addNode(pointFromEvent(event));
  }

  function handleEditorKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.matches('input, textarea, select') || target.isContentEditable) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && selection) {
      event.preventDefault();
      removeSelection();
    } else if (event.key === 'Enter' && selection?.kind === 'node') {
      event.preventDefault();
      setEditingNodeId(selection.id);
    } else if (event.key === 'Enter' && selection?.kind === 'edge') {
      event.preventDefault();
      setEditingEdgeId(selection.id);
    } else if (event.key === 'Escape') {
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
          <button type="button" onClick={() => addNode()}><Plus size={15} /> 节点</button>
          <button
            type="button"
            className={connectMode ? 'active' : ''}
            onClick={() => { setConnectMode((value) => !value); setConnectingFrom(null); }}
            aria-pressed={connectMode}
          >
            <Link2 size={15} /> 连线模式
          </button>
          <button type="button" onClick={() => { shouldCenterViewport.current = true; setPositions(autoLayout(graph)); }} title="根据当前方向重新排列节点"><RefreshCcw size={14} /> 自动排列</button>
        </div>

        <div className="canvas-direction-tools" role="group" aria-label="流程图方向">
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
            <button type="button" onClick={() => setEditingNodeId(selectedNode.id)}><Pencil size={13} /> 改名</button>
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
            <button type="button" className="danger" onClick={removeSelection}><Trash2 size={13} /> 删除</button>
          </>
        ) : selectedEdge ? (
          <>
            <span className="canvas-selection-title"><Link2 size={13} /><b>{selectedEdge.label || '已选连线'}</b></span>
            <span className="canvas-context-divider" />
            <button type="button" onClick={() => setEditingEdgeId(selectedEdge.id)}><Pencil size={13} /> {selectedEdge.label ? '改说明' : '加说明'}</button>
            <div className="canvas-edge-style-tools" role="group" aria-label="连线样式">
              {EDGE_OPTIONS.map(({ value, label }) => (
                <button type="button" key={value} className={selectedEdge.style === value ? 'active' : ''} onClick={() => updateEdge(selectedEdge.id, { style: value })}>{label}</button>
              ))}
            </div>
            <button type="button" onClick={() => updateEdge(selectedEdge.id, { from: selectedEdge.to, to: selectedEdge.from })}><RefreshCcw size={13} /> 反向</button>
            <button type="button" className="danger" onClick={removeSelection}><Trash2 size={13} /> 删除</button>
          </>
        ) : (
          <span className="canvas-idle-hint">
            {connectMode
              ? connectingFrom ? '再点一个节点完成连线；可连续连接多个节点' : '点一个节点作为连线起点'
              : '拖动节点调整位置 · 双击节点改名 · 拖动节点右侧端点建立连线 · 双击空白新增节点'}
          </span>
        )}
      </div>

      <div className={`canvas-editor-viewport${connectMode ? ' connect-mode' : ''}`} ref={viewportRef}>
        <div className="canvas-editor-scaled-stage" style={{ width: STAGE_WIDTH * zoom, height: STAGE_HEIGHT * zoom }}>
          <div
            className="canvas-editor-stage"
            ref={stageRef}
            style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${zoom})` }}
            onClick={() => { setSelection(null); setEditingNodeId(null); setEditingEdgeId(null); }}
            onDoubleClick={handleCanvasDoubleClick}
          >
            <svg className="canvas-edge-layer" width={STAGE_WIDTH} height={STAGE_HEIGHT} aria-hidden="true">
              <defs>
                <marker id={markerId} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
                  <path d="M 0 0 L 9 4.5 L 0 9 z" />
                </marker>
              </defs>
              {graph.edges.map((edge) => {
                const geometry = edgeGeometries.get(edge.id);
                if (!geometry) return null;
                const selected = selection?.kind === 'edge' && selection.id === edge.id;
                return (
                  <g key={edge.id} className={`canvas-edge ${edge.style}${selected ? ' selected' : ''}`} data-mermaid-edge-id={edge.id}>
                    <path className="canvas-edge-visible" d={geometry.path} markerEnd={edge.style === 'line' ? undefined : `url(#${markerId})`} />
                    <path
                      className="canvas-edge-hit"
                      d={geometry.path}
                      onClick={(event) => { event.stopPropagation(); setSelection({ kind: 'edge', id: edge.id }); setEditingNodeId(null); }}
                      onDoubleClick={(event) => { event.stopPropagation(); setSelection({ kind: 'edge', id: edge.id }); setEditingEdgeId(edge.id); }}
                    />
                  </g>
                );
              })}
              {connectionDrag ? (() => {
                const sourceNode = graph.nodes.find((node) => node.id === connectionDrag.from);
                const position = positions[connectionDrag.from];
                if (!sourceNode || !position) return null;
                const size = nodeSize(sourceNode.shape);
                const start = { x: position.x + size.width, y: position.y + size.height / 2 };
                return <path className="canvas-edge-preview" d={`M ${start.x} ${start.y} L ${connectionDrag.pointer.x} ${connectionDrag.pointer.y}`} markerEnd={`url(#${markerId})`} />;
              })() : null}
            </svg>

            {graph.edges.map((edge) => {
              const geometry = edgeGeometries.get(edge.id);
              if (!geometry || (!edge.label && editingEdgeId !== edge.id && selection?.id !== edge.id)) return null;
              const editing = editingEdgeId === edge.id;
              return (
                <div
                  key={`label-${edge.id}`}
                  className={`canvas-edge-label${selection?.kind === 'edge' && selection.id === edge.id ? ' selected' : ''}`}
                  style={{ left: geometry.label.x, top: geometry.label.y }}
                  data-mermaid-edge-id={edge.id}
                  onClick={(event) => { event.stopPropagation(); setSelection({ kind: 'edge', id: edge.id }); }}
                  onDoubleClick={(event) => { event.stopPropagation(); setEditingEdgeId(edge.id); }}
                >
                  {editing ? (
                    <input
                      autoFocus
                      value={edge.label}
                      onChange={(event) => updateEdge(edge.id, { label: event.target.value })}
                      onBlur={() => setEditingEdgeId(null)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') { event.preventDefault(); setEditingEdgeId(null); }
                        if (event.key === 'Escape') setEditingEdgeId(null);
                      }}
                      placeholder="连线说明"
                      aria-label="连线说明"
                    />
                  ) : <span>{edge.label || '添加说明'}</span>}
                </div>
              );
            })}

            {graph.nodes.map((node) => {
              const position = positions[node.id];
              if (!position) return null;
              const size = nodeSize(node.shape);
              const selected = selection?.kind === 'node' && selection.id === node.id;
              const editing = editingNodeId === node.id;
              const connectionOrigin = connectingFrom === node.id || connectionDrag?.from === node.id;
              return (
                <div
                  key={node.id}
                  className={`mermaid-canvas-node shape-${node.shape}${selected ? ' selected' : ''}${connectionOrigin ? ' connection-origin' : ''}`}
                  style={{ left: position.x, top: position.y, width: size.width, height: size.height }}
                  data-mermaid-node-id={node.id}
                  onPointerDown={(event) => handleNodePointerDown(event, node)}
                  onClick={(event) => handleNodeClick(event, node)}
                  onDoubleClick={(event) => { event.stopPropagation(); setSelection({ kind: 'node', id: node.id }); setEditingNodeId(node.id); }}
                  role="button"
                  aria-label={`${node.label} 节点`}
                  aria-pressed={selected}
                  tabIndex={-1}
                >
                  <span className="canvas-node-content">
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
                        aria-label="节点名称"
                      />
                    ) : <span>{node.label || node.id}</span>}
                    <small>{node.id}</small>
                  </span>
                  {selected ? (
                    <button
                      type="button"
                      className="canvas-node-connector"
                      onPointerDown={(event) => startConnectionDrag(event, node.id)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`从 ${node.label} 拖出连线`}
                      title="拖到另一节点建立连线"
                    >
                      <Plus size={13} />
                    </button>
                  ) : null}
                </div>
              );
            })}

            {!graph.nodes.length ? (
              <button type="button" className="canvas-empty-action" onClick={(event) => { event.stopPropagation(); addNode(); }}>
                <Plus size={22} /><strong>添加第一个节点</strong><span>也可以双击画布任意位置</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="canvas-editor-status">
        <span>{graph.nodes.length} 个节点 · {graph.edges.length} 条连线</span>
        <span>节点位置仅用于本次画布编排；应用时由 Mermaid 按结构和方向自动布局</span>
      </div>
    </div>
  );
}
