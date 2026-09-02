export type MermaidFlowDirection = 'TB' | 'TD' | 'BT' | 'LR' | 'RL';

export type MermaidDiagramKind = 'flowchart' | 'sequence' | 'state' | 'class' | 'er' | 'mindmap' | 'gantt';

export type MermaidNodeShape = 'rectangle' | 'rounded' | 'terminal' | 'decision' | 'circle' | 'database';

export type MermaidEdgeStyle = 'arrow' | 'line' | 'dotted' | 'thick';

export type MermaidFlowNode = {
  id: string;
  label: string;
  shape: MermaidNodeShape;
  data?: {
    ref?: string;
    sequenceType?: 'actor' | 'participant';
    stateRole?: 'start' | 'end' | 'state';
    details?: string[];
    mindRoot?: boolean;
    ganttSection?: string;
    ganttStatuses?: string[];
    ganttStart?: string;
    ganttTiming?: string[];
    /** Canvas-only dimensions. Mermaid serialization intentionally ignores them. */
    canvasWidth?: number;
    canvasHeight?: number;
    /** Total height from a sequence participant's top edge to its lifeline end. */
    canvasLifelineHeight?: number;
  };
};

export type MermaidFlowEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  style: MermaidEdgeStyle;
  data?: {
    token?: string;
  };
};

export type MermaidFlowGraph = {
  kind: MermaidDiagramKind;
  direction: MermaidFlowDirection;
  nodes: MermaidFlowNode[];
  edges: MermaidFlowEdge[];
  data?: {
    header?: string;
    autonumber?: boolean;
    directives?: string[];
  };
};

export type MermaidVisualGraph = MermaidFlowGraph;

export type MermaidTemplate = {
  id: string;
  name: string;
  category: string;
  description: string;
  source: string;
  visualEditable: boolean;
};

export const MERMAID_TEMPLATES: MermaidTemplate[] = [
  {
    id: 'basic-flowchart',
    name: '基本流程图',
    category: '流程',
    description: '开始、处理、判断分支与结束节点',
    visualEditable: true,
    source: `flowchart TD
  Start(["开始"])
  Input["接收请求"]
  Check{"校验通过？"}
  Process["处理业务"]
  Error["返回错误"]
  End(["结束"])
  Start --> Input
  Input --> Check
  Check -->|是| Process
  Check -->|否| Error
  Process --> End
  Error --> End`,
  },
  {
    id: 'four-plus-one',
    name: '4+1 架构视图',
    category: '架构',
    description: '逻辑、开发、进程、物理视图与场景视图',
    visualEditable: true,
    source: `flowchart TB
  Logical["逻辑视图：领域模型与核心抽象"]
  Development["开发视图：模块、组件与代码组织"]
  Scenario(["场景视图 (+1)：关键用例与需求"])
  Process["进程视图：运行时行为、并发与通信"]
  Physical["物理视图：部署节点与基础设施"]
  Logical -->|由场景验证| Scenario
  Development -->|实现| Scenario
  Scenario -->|驱动运行| Process
  Scenario -->|部署到| Physical`,
  },
  {
    id: 'architecture',
    name: '分层架构图',
    category: '架构',
    description: '展示客户端、服务、数据与外部依赖',
    visualEditable: true,
    source: `flowchart LR
  Client["客户端"]
  Gateway["API 网关"]
  Service["业务服务"]
  Database[("数据库")]
  External["外部服务"]
  Client --> Gateway
  Gateway --> Service
  Service --> Database
  Service --> External`,
  },
  {
    id: 'sequence',
    name: '时序图',
    category: '交互',
    description: '描述参与者之间按时间发生的交互',
    visualEditable: true,
    source: `sequenceDiagram
  autonumber
  actor User as 用户
  participant App as 客户端
  participant API as 服务端
  User->>App: 提交请求
  App->>API: 发送数据
  API-->>App: 返回结果
  App-->>User: 展示结果`,
  },
  {
    id: 'state',
    name: '状态图',
    category: '行为',
    description: '描述对象状态及其转换条件',
    visualEditable: true,
    source: `stateDiagram-v2
  [*] --> 草稿
  草稿 --> 审核中: 提交
  审核中 --> 已发布: 通过
  审核中 --> 草稿: 驳回
  已发布 --> [*]`,
  },
  {
    id: 'class',
    name: '类图',
    category: '结构',
    description: '展示类、成员与继承或关联关系',
    visualEditable: true,
    source: `classDiagram
  class User {
    +String id
    +String name
    +signIn()
  }
  class Order {
    +String id
    +create()
  }
  User "1" --> "many" Order : 创建`,
  },
  {
    id: 'er',
    name: 'ER 数据模型',
    category: '数据',
    description: '展示实体、字段与基数关系',
    visualEditable: true,
    source: `erDiagram
  USER ||--o{ ORDER : creates
  USER {
    string id PK
    string name
  }
  ORDER {
    string id PK
    string user_id FK
    decimal amount
  }`,
  },
  {
    id: 'mindmap',
    name: '思维导图',
    category: '分析',
    description: '从一个主题向外展开层级信息',
    visualEditable: true,
    source: `mindmap
  root((产品规划))
    用户价值
      核心问题
      目标人群
    产品能力
      MVP
      后续迭代
    交付计划
      里程碑
      风险`,
  },
  {
    id: 'gantt',
    name: '甘特图',
    category: '计划',
    description: '按日期展示任务、依赖与里程碑',
    visualEditable: true,
    source: `gantt
  title 项目计划
  dateFormat YYYY-MM-DD
  section 设计
  需求确认 :done, req, 2026-01-01, 3d
  方案设计 :design, after req, 5d
  section 开发
  核心开发 :dev, after design, 8d
  验收发布 :milestone, after dev, 1d`,
  },
];

const EDGE_STYLE_TO_TOKEN: Record<MermaidEdgeStyle, string> = {
  arrow: '-->',
  line: '---',
  dotted: '-.->',
  thick: '==>',
};

function normalizeLabel(value: string): string {
  const trimmed = value.trim();
  const unquoted = ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ? trimmed.slice(1, -1)
    : trimmed;
  return unquoted
    .replace(/<br\s*\/?\s*>/gi, ' / ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function parseNodeToken(token: string): MermaidFlowNode | null {
  const match = token.trim().match(/^([A-Za-z_][\w-]*)([\s\S]*)$/);
  if (!match) return null;
  const id = match[1];
  const notation = match[2].trim();
  if (!notation) return { id, label: id, shape: 'rectangle' };

  // Mermaid has many additional node notations. Only accept shapes that the
  // canvas can serialize back exactly; otherwise keep the original source in
  // source mode instead of collapsing it into a basic rectangle/circle.
  if (
    notation.startsWith('[[')
    || notation.startsWith('{{')
    || notation.startsWith('(((')
    || notation.startsWith('[/')
    || notation.startsWith('[\\')
    || notation.startsWith('>')
    || notation.startsWith('@{')
  ) return null;

  const shapes: Array<{ pattern: RegExp; shape: MermaidNodeShape }> = [
    { pattern: /^\(\[([\s\S]*)\]\)$/, shape: 'terminal' },
    { pattern: /^\(\(([\s\S]*)\)\)$/, shape: 'circle' },
    { pattern: /^\[\(([\s\S]*)\)\]$/, shape: 'database' },
    { pattern: /^\{([\s\S]*)\}$/, shape: 'decision' },
    { pattern: /^\(([\s\S]*)\)$/, shape: 'rounded' },
    { pattern: /^\[([\s\S]*)\]$/, shape: 'rectangle' },
  ];
  for (const candidate of shapes) {
    const label = notation.match(candidate.pattern);
    if (label) return { id, label: normalizeLabel(label[1]), shape: candidate.shape };
  }
  return null;
}

function edgeStyleFromToken(token: string): MermaidEdgeStyle {
  if (token === '---') return 'line';
  if (token === '-.->') return 'dotted';
  if (token === '==>') return 'thick';
  return 'arrow';
}

function parseEdgeLine(line: string): { from: MermaidFlowNode; to: MermaidFlowNode; label: string; style: MermaidEdgeStyle } | null {
  const labelledArrow = line.match(/^([\s\S]*?)\s+--\s+([\s\S]+?)\s+-->\s+([\s\S]*?)$/);
  if (labelledArrow) {
    const from = parseNodeToken(labelledArrow[1]);
    const to = parseNodeToken(labelledArrow[3]);
    if (from && to) return { from, to, label: normalizeLabel(labelledArrow[2]), style: 'arrow' };
  }

  const normal = line.match(/^([\s\S]*?)\s*(-->|---|-\.->|==>)\s*(?:\|([^|]*)\|\s*)?([\s\S]*?)$/);
  if (!normal) return null;
  const from = parseNodeToken(normal[1]);
  const to = parseNodeToken(normal[4]);
  if (!from || !to) return null;
  return { from, to, label: normalizeLabel(normal[3] ?? ''), style: edgeStyleFromToken(normal[2]) };
}

export function parseFlowchartSource(source: string): MermaidFlowGraph | null {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const headerIndex = lines.findIndex((line) => /^\s*(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)\b/i.test(line));
  if (headerIndex < 0) return null;
  if (lines.slice(0, headerIndex).some((line) => line.trim())) return null;
  if (!/^\s*(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)\s*$/i.test(lines[headerIndex])) return null;
  const directionMatch = lines[headerIndex].match(/^\s*(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)\b/i);
  const direction = (directionMatch?.[1]?.toUpperCase() ?? 'TD') as MermaidFlowDirection;
  const nodeMap = new Map<string, MermaidFlowNode>();
  const edges: MermaidFlowEdge[] = [];

  const rememberNode = (node: MermaidFlowNode) => {
    const previous = nodeMap.get(node.id);
    if (!previous || node.label !== node.id || previous.label === previous.id) nodeMap.set(node.id, node);
  };

  for (const rawLine of lines.slice(headerIndex + 1)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('%%')) return null;
    // The direct-manipulation canvas intentionally supports only a lossless subset. Returning
    // null keeps richer Mermaid source (subgraphs, styling, classes, etc.) in
    // source/AI mode instead of silently dropping it during serialization.
    if (/^(?:(?:subgraph|direction|classDef|class|style|linkStyle)(?:\s|$)|end\s*$)/i.test(line) || line.includes(';')) return null;
    const edge = parseEdgeLine(line);
    if (edge) {
      rememberNode(edge.from);
      rememberNode(edge.to);
      edges.push({
        id: `edge-${edges.length + 1}`,
        from: edge.from.id,
        to: edge.to.id,
        label: edge.label,
        style: edge.style,
      });
      continue;
    }
    const node = parseNodeToken(line);
    if (!node) return null;
    rememberNode(node);
  }

  return { kind: 'flowchart', direction, nodes: Array.from(nodeMap.values()), edges };
}

function safeLabel(value: string): string {
  if (/[;#\r\n]/.test(value)) throw new Error('画布文字不能包含换行、分号或 #');
  return value
    .replace(/[\r\n]+/g, ' / ')
    .replace(/"/g, "'")
    .replace(/\|/g, '/')
    .trim();
}

function serializeNode(node: MermaidFlowNode): string {
  const label = `"${safeLabel(node.label) || node.id}"`;
  if (node.shape === 'rounded') return `${node.id}(${label})`;
  if (node.shape === 'terminal') return `${node.id}([${label}])`;
  if (node.shape === 'decision') return `${node.id}{${label}}`;
  if (node.shape === 'circle') return `${node.id}((${label}))`;
  if (node.shape === 'database') return `${node.id}[(${label})]`;
  return `${node.id}[${label}]`;
}

export function serializeFlowchart(graph: MermaidFlowGraph): string {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const nodes = graph.nodes
    .filter((node) => /^[A-Za-z_][\w-]*$/.test(node.id))
    .map((node) => `  ${serializeNode(node)}`);
  const edges = graph.edges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .map((edge) => {
      const token = EDGE_STYLE_TO_TOKEN[edge.style];
      const label = safeLabel(edge.label);
      return `  ${edge.from} ${token}${label ? `|${label}|` : ''} ${edge.to}`;
    });
  return [`flowchart ${graph.direction}`, ...nodes, ...edges].join('\n');
}

function diagramBody(source: string, headerPattern: RegExp): { header: string; lines: string[] } | null {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const headerIndex = lines.findIndex((line) => line.trim());
  if (headerIndex < 0 || lines.slice(0, headerIndex).some((line) => line.trim())) return null;
  const header = lines[headerIndex].trim();
  if (!headerPattern.test(header)) return null;
  return { header, lines: lines.slice(headerIndex + 1) };
}

function safeVisualText(value: string): string {
  if (/[;#\r\n]/.test(value)) throw new Error('画布文字不能包含换行、分号或 #');
  return value.replace(/[\r\n]+/g, ' / ').replace(/"/g, "'").trim();
}

function meaningfulDetails(details: string[], kind: 'class' | 'er'): string[] {
  const normalized = details.map((detail) => detail.trim()).filter(Boolean);
  if (normalized.some((detail) => /[{};#\r\n]/.test(detail))) {
    throw new Error(`${kind === 'class' ? '类成员' : '实体字段'}不能包含换行、花括号、分号或 #`);
  }
  return normalized;
}

function nextInternalId(prefix: string, used: Set<string>): string {
  let index = used.size + 1;
  while (used.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

function styleForRawToken(token: string): MermaidEdgeStyle {
  if (token === '--' || token === '---') return 'line';
  if (token.includes('..') || /^(?:-->>|--\)|--x|-->)$/.test(token)) return 'dotted';
  if (token.includes('==')) return 'thick';
  return 'arrow';
}

export function parseSequenceSource(source: string): MermaidFlowGraph | null {
  const body = diagramBody(source, /^sequenceDiagram$/i);
  if (!body) return null;
  const nodes: MermaidFlowNode[] = [];
  const edges: MermaidFlowEdge[] = [];
  const nodeMap = new Map<string, MermaidFlowNode>();
  let autonumber = false;

  const rememberParticipant = (ref: string, label = ref, sequenceType: 'actor' | 'participant' = 'participant') => {
    const previous = nodeMap.get(ref);
    if (previous) {
      if (label !== ref || previous.label === previous.data?.ref) previous.label = label;
      if (sequenceType === 'actor') {
        previous.shape = 'terminal';
        previous.data = { ...previous.data, sequenceType };
      }
      return previous;
    }
    const node: MermaidFlowNode = {
      id: ref,
      label,
      shape: sequenceType === 'actor' ? 'terminal' : 'rectangle',
      data: { ref, sequenceType },
    };
    nodeMap.set(ref, node);
    nodes.push(node);
    return node;
  };

  for (const rawLine of body.lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === 'autonumber') {
      if (autonumber) return null;
      autonumber = true;
      continue;
    }
    if (line.startsWith('%%')) return null;
    const declaration = line.match(/^(actor|participant)\s+([A-Za-z_][\w-]*)(?:\s+as\s+(.+))?$/i);
    if (declaration) {
      const ref = declaration[2];
      const label = normalizeLabel(declaration[3] ?? ref);
      if (!label) return null;
      rememberParticipant(ref, label, declaration[1].toLowerCase() as 'actor' | 'participant');
      continue;
    }
    const message = line.match(/^([A-Za-z_][\w-]*?)\s*(<<-->>|<<->>|-->>|--\)|--x|-->|->>|-\)|-x|->)\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!message) return null;
    const [, from, token, to, label] = message;
    rememberParticipant(from);
    rememberParticipant(to);
    edges.push({
      id: `edge-${edges.length + 1}`,
      from,
      to,
      label: normalizeLabel(label),
      style: styleForRawToken(token),
      data: { token },
    });
  }

  return {
    kind: 'sequence',
    direction: 'LR',
    nodes,
    edges,
    data: { header: body.header, autonumber },
  };
}

function serializeSequence(graph: MermaidFlowGraph): string {
  const lines = [graph.data?.header || 'sequenceDiagram'];
  if (graph.data?.autonumber) lines.push('  autonumber');
  const refs = new Map<string, string>();
  for (const node of graph.nodes) {
    const ref = /^[A-Za-z_][\w-]*$/.test(node.data?.ref ?? '') ? node.data!.ref! : nextMermaidNodeId(graph.nodes, 'Participant');
    refs.set(node.id, ref);
    const declaration = node.data?.sequenceType === 'actor' ? 'actor' : 'participant';
    lines.push(`  ${declaration} ${ref} as ${safeVisualText(node.label) || ref}`);
  }
  for (const edge of graph.edges) {
    const from = refs.get(edge.from);
    const to = refs.get(edge.to);
    if (!from || !to) continue;
    const rawToken = edge.data?.token;
    const token = rawToken && /^(?:<<-->>|<<->>|-->>|--\)|--x|-->|->>|-\)|-x|->)$/.test(rawToken) ? rawToken : '->>';
    lines.push(`  ${from}${token}${to}: ${safeVisualText(edge.label)}`);
  }
  return lines.join('\n');
}

function validStateRef(value: string): boolean {
  return /^[\p{L}\p{N}_-]+$/u.test(value);
}

export function parseStateSource(source: string): MermaidFlowGraph | null {
  const body = diagramBody(source, /^stateDiagram(?:-v2)?$/i);
  if (!body) return null;
  const nodes: MermaidFlowNode[] = [];
  const edges: MermaidFlowEdge[] = [];
  const nodeMap = new Map<string, MermaidFlowNode>();
  let direction: MermaidFlowDirection = 'TD';
  let startCount = 0;
  let endCount = 0;

  const rememberState = (ref: string, role: 'start' | 'end' | 'state', label = ref) => {
    const key = role === 'state' ? ref : role === 'start' ? `__state_start_${++startCount}` : `__state_end_${++endCount}`;
    if (role === 'state') {
      const previous = nodeMap.get(ref);
      if (previous) {
        if (label !== ref || previous.label === ref) previous.label = label;
        return previous;
      }
    }
    const node: MermaidFlowNode = {
      id: key,
      label: role === 'start' ? '开始' : role === 'end' ? '结束' : label,
      shape: role === 'state' ? 'rounded' : 'circle',
      data: { ref, stateRole: role },
    };
    if (role === 'state') nodeMap.set(ref, node);
    nodes.push(node);
    return node;
  };

  for (const rawLine of body.lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('%%')) return null;
    const directionMatch = line.match(/^direction\s+(TB|TD|BT|LR|RL)$/i);
    if (directionMatch) {
      direction = directionMatch[1].toUpperCase() as MermaidFlowDirection;
      continue;
    }
    const alias = line.match(/^state\s+"([^"]*)"\s+as\s+([\p{L}\p{N}_-]+)$/u);
    if (alias) {
      rememberState(alias[2], 'state', alias[1]);
      continue;
    }
    const transition = line.match(/^(\[\*\]|[\p{L}\p{N}_-]+)\s*-->\s*(\[\*\]|[\p{L}\p{N}_-]+)(?:\s*:\s*(.*))?$/u);
    if (!transition) return null;
    const from = transition[1] === '[*]' ? rememberState('[*]', 'start') : rememberState(transition[1], 'state');
    const to = transition[2] === '[*]' ? rememberState('[*]', 'end') : rememberState(transition[2], 'state');
    edges.push({ id: `edge-${edges.length + 1}`, from: from.id, to: to.id, label: normalizeLabel(transition[3] ?? ''), style: 'arrow', data: { token: '-->' } });
  }
  return { kind: 'state', direction, nodes, edges, data: { header: body.header } };
}

function serializeState(graph: MermaidFlowGraph): string {
  const lines = [graph.data?.header || 'stateDiagram-v2'];
  if (graph.direction !== 'TD' && graph.direction !== 'TB') lines.push(`  direction ${graph.direction}`);
  const refs = new Map<string, string>();
  const usedRefs = new Set<string>();
  for (const node of graph.nodes) {
    if (node.data?.stateRole === 'start' || node.data?.stateRole === 'end') {
      refs.set(node.id, '[*]');
      continue;
    }
    const requested = node.data?.ref ?? node.id;
    let ref = validStateRef(requested) && !usedRefs.has(requested) ? requested : nextInternalId('State', usedRefs);
    while (usedRefs.has(ref)) ref = nextInternalId('State', usedRefs);
    usedRefs.add(ref);
    refs.set(node.id, ref);
    if (node.label !== ref) lines.push(`  state "${safeVisualText(node.label) || ref}" as ${ref}`);
  }
  for (const node of graph.nodes) {
    const role = node.data?.stateRole;
    if (role !== 'start' && role !== 'end') continue;
    const incoming = graph.edges.filter((edge) => edge.to === node.id).length;
    const outgoing = graph.edges.filter((edge) => edge.from === node.id).length;
    const valid = role === 'start' ? incoming === 0 && outgoing === 1 : incoming === 1 && outgoing === 0;
    if (!valid) throw new Error(`${role === 'start' ? '开始' : '结束'}状态必须且只能连接一条方向正确的转换`);
  }
  for (const edge of graph.edges) {
    const from = refs.get(edge.from);
    const to = refs.get(edge.to);
    if (!from || !to) continue;
    const label = safeVisualText(edge.label);
    lines.push(`  ${from} --> ${to}${label ? `: ${label}` : ''}`);
  }
  return lines.join('\n');
}

const CLASS_RELATION_PATTERN = /^(<\|--|\*--|o--|-->|--|\.\.\|>|\.\.>|\.\.)$/;

export function parseClassSource(source: string): MermaidFlowGraph | null {
  const body = diagramBody(source, /^classDiagram$/i);
  if (!body) return null;
  const nodes: MermaidFlowNode[] = [];
  const edges: MermaidFlowEdge[] = [];
  const nodeMap = new Map<string, MermaidFlowNode>();
  const rememberClass = (ref: string, label = ref, details: string[] = []) => {
    const previous = nodeMap.get(ref);
    if (previous) {
      if (label !== ref || previous.label === ref) previous.label = label;
      if (details.length) previous.data = { ...previous.data, details: [...(previous.data?.details ?? []), ...details] };
      return previous;
    }
    const node: MermaidFlowNode = { id: ref, label, shape: 'rectangle', data: { ref, details } };
    nodeMap.set(ref, node);
    nodes.push(node);
    return node;
  };

  for (let index = 0; index < body.lines.length; index += 1) {
    const line = body.lines[index].trim();
    if (!line) continue;
    if (line.startsWith('%%')) return null;
    const block = line.match(/^class\s+([A-Za-z_][\w-]*)(?:\["([^"]*)"\])?\s*\{$/);
    if (block) {
      const details: string[] = [];
      let closed = false;
      for (index += 1; index < body.lines.length; index += 1) {
        const member = body.lines[index].trim();
        if (member === '}') { closed = true; break; }
        if (!member) continue;
        if (member.includes('{') || member.includes('}')) return null;
        details.push(member);
      }
      if (!closed) return null;
      rememberClass(block[1], block[2] ?? block[1], details);
      continue;
    }
    const declaration = line.match(/^class\s+([A-Za-z_][\w-]*)(?:\["([^"]*)"\])?$/);
    if (declaration) {
      rememberClass(declaration[1], declaration[2] ?? declaration[1]);
      continue;
    }
    const relation = line.match(/^([A-Za-z_][\w-]*)\s*(?:"([^"]*)"\s*)?(<\|--|\*--|o--|-->|--|\.\.\|>|\.\.>|\.\.)\s*(?:"([^"]*)"\s*)?([A-Za-z_][\w-]*)(?:\s*:\s*(.*))?$/);
    if (!relation || !CLASS_RELATION_PATTERN.test(relation[3])) return null;
    rememberClass(relation[1]);
    rememberClass(relation[5]);
    const token = `${relation[2] ? `"${relation[2]}" ` : ''}${relation[3]}${relation[4] ? ` "${relation[4]}"` : ''}`;
    const style: MermaidEdgeStyle = relation[3].startsWith('..') ? 'dotted' : relation[3] === '--' ? 'line' : 'arrow';
    edges.push({ id: `edge-${edges.length + 1}`, from: relation[1], to: relation[5], label: normalizeLabel(relation[6] ?? ''), style, data: { token } });
  }
  return { kind: 'class', direction: 'LR', nodes, edges, data: { header: body.header } };
}

function serializeClass(graph: MermaidFlowGraph): string {
  const lines = [graph.data?.header || 'classDiagram'];
  const refs = new Map<string, string>();
  for (const node of graph.nodes) {
    const ref = /^[A-Za-z_][\w-]*$/.test(node.data?.ref ?? '') ? node.data!.ref! : nextMermaidNodeId(graph.nodes, 'Class');
    refs.set(node.id, ref);
    const label = safeVisualText(node.label) || ref;
    const alias = label === ref ? ref : `${ref}["${label}"]`;
    const details = node.data?.details ?? [];
    const members = meaningfulDetails(details, 'class');
    if (members.length) lines.push(`  class ${alias} {`, ...members.map((detail) => `    ${detail}`), '  }');
    else lines.push(`  class ${alias}`);
  }
  for (const edge of graph.edges) {
    const from = refs.get(edge.from);
    const to = refs.get(edge.to);
    if (!from || !to) continue;
    const token = edge.data?.token && /^(?:"[^"]*"\s+)?(?:<\|--|\*--|o--|-->|--|\.\.\|>|\.\.>|\.\.)(?:\s+"[^"]*")?$/.test(edge.data.token) ? edge.data.token : '-->';
    const label = safeVisualText(edge.label);
    lines.push(`  ${from} ${token} ${to}${label ? ` : ${label}` : ''}`);
  }
  return lines.join('\n');
}

function validErToken(token: string): boolean {
  return /^(?:\|\||\|o|\}\||\}o)(?:--|\.\.)(?:\|\||o\||\|\{|o\{)$/.test(token);
}

export function parseErSource(source: string): MermaidFlowGraph | null {
  const body = diagramBody(source, /^erDiagram$/i);
  if (!body) return null;
  const nodes: MermaidFlowNode[] = [];
  const edges: MermaidFlowEdge[] = [];
  const nodeMap = new Map<string, MermaidFlowNode>();
  const rememberEntity = (ref: string, label = ref, details: string[] = []) => {
    const previous = nodeMap.get(ref);
    if (previous) {
      if (label !== ref || previous.label === ref) previous.label = label;
      if (details.length) previous.data = { ...previous.data, details: [...(previous.data?.details ?? []), ...details] };
      return previous;
    }
    const node: MermaidFlowNode = { id: ref, label, shape: 'database', data: { ref, details } };
    nodeMap.set(ref, node);
    nodes.push(node);
    return node;
  };

  for (let index = 0; index < body.lines.length; index += 1) {
    const line = body.lines[index].trim();
    if (!line) continue;
    if (line.startsWith('%%')) return null;
    const block = line.match(/^([A-Za-z_][\w-]*)(?:\["([^"]*)"\])?\s*\{$/);
    if (block) {
      const details: string[] = [];
      let closed = false;
      for (index += 1; index < body.lines.length; index += 1) {
        const field = body.lines[index].trim();
        if (field === '}') { closed = true; break; }
        if (!field) continue;
        if (field.includes('{') || field.includes('}')) return null;
        details.push(field);
      }
      if (!closed) return null;
      rememberEntity(block[1], block[2] ?? block[1], details);
      continue;
    }
    const declaration = line.match(/^([A-Za-z_][\w-]*)(?:\["([^"]*)"\])?$/);
    if (declaration) {
      rememberEntity(declaration[1], declaration[2] ?? declaration[1]);
      continue;
    }
    const relation = line.match(/^([A-Za-z_][\w-]*)\s+([|o}{]{2}(?:--|\.\.)[|o}{]{2})\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!relation || !validErToken(relation[2])) return null;
    rememberEntity(relation[1]);
    rememberEntity(relation[3]);
    edges.push({ id: `edge-${edges.length + 1}`, from: relation[1], to: relation[3], label: normalizeLabel(relation[4]), style: 'line', data: { token: relation[2] } });
  }
  return { kind: 'er', direction: 'LR', nodes, edges, data: { header: body.header } };
}

function serializeEr(graph: MermaidFlowGraph): string {
  const lines = [graph.data?.header || 'erDiagram'];
  const refs = new Map<string, string>();
  for (const node of graph.nodes) {
    const ref = /^[A-Za-z_][\w-]*$/.test(node.data?.ref ?? '') ? node.data!.ref! : nextMermaidNodeId(graph.nodes, 'ENTITY');
    refs.set(node.id, ref);
  }
  for (const edge of graph.edges) {
    const from = refs.get(edge.from);
    const to = refs.get(edge.to);
    if (!from || !to) continue;
    const token = edge.data?.token && validErToken(edge.data.token) ? edge.data.token : '||--o{';
    lines.push(`  ${from} ${token} ${to} : ${safeVisualText(edge.label) || 'relates'}`);
  }
  for (const node of graph.nodes) {
    const ref = refs.get(node.id)!;
    const label = safeVisualText(node.label) || ref;
    const alias = label === ref ? ref : `${ref}["${label}"]`;
    const details = node.data?.details ?? [];
    const fields = meaningfulDetails(details, 'er');
    if (fields.length) lines.push(`  ${alias} {`, ...fields.map((detail) => `    ${detail}`), '  }');
    else lines.push(`  ${alias}`);
  }
  return lines.join('\n');
}

function parseMindNode(content: string, isRoot: boolean, generatedRef: string): { ref: string; label: string } | null {
  if (isRoot) {
    const root = content.match(/^([A-Za-z_][\w-]*)\(\((?:"([^"]*)"|([^()]*))\)\)$/);
    if (!root) return null;
    return { ref: root[1], label: normalizeLabel(root[2] ?? root[3]) };
  }
  const square = content.match(/^([A-Za-z_][\w-]*)\[(?:"([^"]*)"|([^[\]]*))\]$/);
  if (square) return { ref: square[1], label: normalizeLabel(square[2] ?? square[3]) };
  if (/[()[\]{}]/.test(content) || !content.trim()) return null;
  return { ref: generatedRef, label: normalizeLabel(content) };
}

export function parseMindmapSource(source: string): MermaidFlowGraph | null {
  const body = diagramBody(source, /^mindmap$/i);
  if (!body) return null;
  const nodes: MermaidFlowNode[] = [];
  const edges: MermaidFlowEdge[] = [];
  const used = new Set<string>();
  const stack: Array<{ indent: number; node: MermaidFlowNode }> = [];

  for (const rawLine of body.lines) {
    if (!rawLine.trim()) continue;
    if (rawLine.includes('\t') || rawLine.trimStart().startsWith('%%')) return null;
    const indent = rawLine.length - rawLine.trimStart().length;
    const parsed = parseMindNode(rawLine.trim(), nodes.length === 0, nextInternalId('Mind', used));
    if (!parsed || used.has(parsed.ref)) return null;
    used.add(parsed.ref);
    const node: MermaidFlowNode = {
      id: parsed.ref,
      label: parsed.label,
      shape: nodes.length === 0 ? 'circle' : 'rounded',
      data: { ref: parsed.ref, mindRoot: nodes.length === 0 },
    };
    if (nodes.length === 0) {
      stack.push({ indent, node });
    } else {
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const parent = stack[stack.length - 1]?.node;
      if (!parent) return null;
      edges.push({ id: `edge-${edges.length + 1}`, from: parent.id, to: node.id, label: '', style: 'line', data: { token: 'child' } });
      stack.push({ indent, node });
    }
    nodes.push(node);
  }
  if (!nodes.length) return null;
  return { kind: 'mindmap', direction: 'LR', nodes, edges, data: { header: body.header } };
}

function serializeMindmap(graph: MermaidFlowGraph): string {
  if (!graph.nodes.length) throw new Error('思维导图至少需要一个根主题');
  const roots = graph.nodes.filter((node) => node.data?.mindRoot);
  if (roots.length !== 1) throw new Error('思维导图必须且只能有一个根主题');
  const root = roots[0];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const children = new Map<string, string[]>();
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to) {
      throw new Error('思维导图包含无效的父子关系');
    }
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    if ((incoming.get(edge.to) ?? 0) > 1) throw new Error('每个子主题只能有一个父主题');
    children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  }
  if (graph.edges.length !== graph.nodes.length - 1
    || incoming.get(root.id) !== 0
    || graph.nodes.some((node) => node.id !== root.id && incoming.get(node.id) !== 1)) {
    throw new Error('思维导图必须保持从根主题出发的完整树结构');
  }
  const order = new Map(graph.nodes.map((node, index) => [node.id, index]));
  for (const list of children.values()) list.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const refs = new Map<string, string>();
  const usedRefs = new Set<string>();
  for (const node of graph.nodes) {
    let ref = /^[A-Za-z_][\w-]*$/.test(node.data?.ref ?? '') ? node.data!.ref! : nextInternalId('Mind', usedRefs);
    while (usedRefs.has(ref)) ref = nextInternalId('Mind', usedRefs);
    usedRefs.add(ref);
    refs.set(node.id, ref);
  }
  const lines = [graph.data?.header || 'mindmap'];
  const visited = new Set<string>();
  const writeNode = (nodeId: string, depth: number) => {
    if (visited.has(nodeId)) throw new Error('思维导图不能包含循环关系');
    visited.add(nodeId);
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    const label = safeVisualText(node.label) || refs.get(nodeId)!;
    lines.push(`${'  '.repeat(depth + 1)}${depth === 0 ? `${refs.get(nodeId)}(("${label}"))` : `${refs.get(nodeId)}["${label}"]`}`);
    for (const child of children.get(nodeId) ?? []) writeNode(child, depth + 1);
  };
  writeNode(root.id, 0);
  if (visited.size !== graph.nodes.length) throw new Error('所有主题都必须连接到根主题');
  return lines.join('\n');
}

const GANTT_STATUSES = new Set(['active', 'done', 'crit', 'milestone']);
const GANTT_DIRECTIVE = /^(?:(?:title|dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker)\s+[^#;]+|weekday\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|weekend\s+(?:friday|saturday)|inclusiveEndDates|topAxis)$/i;

export function parseGanttSource(source: string): MermaidFlowGraph | null {
  const body = diagramBody(source, /^gantt$/i);
  if (!body) return null;
  const nodes: MermaidFlowNode[] = [];
  const edges: MermaidFlowEdge[] = [];
  const directives: string[] = [];
  const usedRefs = new Set<string>();
  const pendingDependencies: Array<{ nodeId: string; refs: string[] }> = [];
  let section = '';

  for (const rawLine of body.lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('%%')) return null;
    const sectionMatch = line.match(/^section\s+(.+)$/);
    if (sectionMatch) {
      section = normalizeLabel(sectionMatch[1]);
      continue;
    }
    if (GANTT_DIRECTIVE.test(line)) {
      directives.push(line);
      continue;
    }
    const colon = line.indexOf(':');
    if (colon < 1) return null;
    const label = normalizeLabel(line.slice(0, colon));
    const parts = line.slice(colon + 1).split(',').map((part) => part.trim());
    if (!label || !parts.length || parts.some((part) => !part)) return null;
    const statuses: string[] = [];
    while (parts.length && GANTT_STATUSES.has(parts[0])) statuses.push(parts.shift()!);
    if (parts.length < 1 || parts.length > 3) return null;
    const hasExplicitRef = parts.length === 3;
    const ref = hasExplicitRef && /^[A-Za-z_][\w-]*$/.test(parts[0])
      ? parts.shift()!
      : hasExplicitRef ? '' : nextInternalId('Task', usedRefs);
    if (!ref) return null;
    if (usedRefs.has(ref)) return null;
    usedRefs.add(ref);
    const schedule = [...parts];
    let dependencyRefs: string[] = [];
    let start: string | undefined;
    if (schedule[0]?.startsWith('after ')) dependencyRefs = schedule.shift()!.slice(6).trim().split(/\s+/).filter(Boolean);
    else if (schedule.length === 2) start = schedule.shift();
    else if (schedule.length === 1) {
      const previousRef = nodes.at(-1)?.data?.ref;
      if (!previousRef) return null;
      dependencyRefs = [previousRef];
    }
    if (schedule.length !== 1) return null;
    const node: MermaidFlowNode = {
      id: ref,
      label,
      shape: 'rounded',
      data: { ref, ganttSection: section, ganttStatuses: statuses, ganttStart: start, ganttTiming: schedule },
    };
    nodes.push(node);
    if (dependencyRefs.length) pendingDependencies.push({ nodeId: node.id, refs: dependencyRefs });
  }

  const refs = new Set(nodes.map((node) => node.data?.ref ?? node.id));
  for (const pending of pendingDependencies) {
    for (const dependency of pending.refs) {
      if (!refs.has(dependency)) return null;
      const from = nodes.find((node) => (node.data?.ref ?? node.id) === dependency)!;
      edges.push({ id: `edge-${edges.length + 1}`, from: from.id, to: pending.nodeId, label: '', style: 'arrow', data: { token: 'after' } });
    }
  }
  if (!nodes.length) return null;
  return { kind: 'gantt', direction: 'LR', nodes, edges, data: { header: body.header, directives } };
}

export function suggestGanttStart(graph: MermaidFlowGraph): string {
  const explicitStart = graph.nodes.find((node) => node.data?.ganttStart)?.data?.ganttStart;
  if (explicitStart) return explicitStart;
  const dateFormat = graph.data?.directives
    ?.find((directive) => /^dateFormat\s+/i.test(directive))
    ?.replace(/^dateFormat\s+/i, '')
    .trim();
  if (dateFormat && dateFormat !== 'YYYY-MM-DD') return '';
  return new Date().toISOString().slice(0, 10);
}

function serializeGantt(graph: MermaidFlowGraph): string {
  if (!graph.nodes.length) throw new Error('甘特图至少需要一个任务');
  const lines = [graph.data?.header || 'gantt', ...(graph.data?.directives ?? []).map((directive) => `  ${directive.trim()}`)];
  const refs = new Map<string, string>();
  const used = new Set<string>();
  for (const node of graph.nodes) {
    const ref = node.data?.ref ?? node.id;
    if (!/^[A-Za-z_][\w-]*$/.test(ref)) throw new Error(`任务“${node.label || node.id}”的 ID 格式无效`);
    if (used.has(ref)) throw new Error(`任务 ID“${ref}”不能重复`);
    used.add(ref);
    refs.set(node.id, ref);
  }
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  const incomingCount = new Map(graph.nodes.map((node) => [node.id, 0]));
  const dependencyPairs = new Set<string>();
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to) throw new Error('甘特图包含无效的任务依赖');
    const pair = `${edge.from}\u0000${edge.to}`;
    if (dependencyPairs.has(pair)) throw new Error('同一任务依赖不能重复');
    dependencyPairs.add(pair);
    outgoing.get(edge.from)!.push(edge.to);
    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);
  }
  const remainingIncoming = new Map(incomingCount);
  const queue = graph.nodes.filter((node) => remainingIncoming.get(node.id) === 0).map((node) => node.id);
  let visitedCount = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visitedCount += 1;
    for (const target of outgoing.get(id) ?? []) {
      const remaining = (remainingIncoming.get(target) ?? 1) - 1;
      remainingIncoming.set(target, remaining);
      if (remaining === 0) queue.push(target);
    }
  }
  if (visitedCount !== graph.nodes.length) throw new Error('甘特图任务依赖不能形成循环');
  let section = '__unset__';
  for (const node of graph.nodes) {
    if (/[:\r\n]/.test(node.label)) throw new Error('甘特图任务名称不能包含冒号或换行');
    const taskLabel = safeVisualText(node.label) || refs.get(node.id)!;
    const nextSection = safeVisualText(node.data?.ganttSection ?? '');
    if (nextSection !== section) {
      section = nextSection;
      if (section) lines.push(`  section ${section}`);
    }
    const dependencies = graph.edges.filter((edge) => edge.to === node.id && refs.has(edge.from)).map((edge) => refs.get(edge.from)!);
    const statuses = node.data?.ganttStatuses ?? [];
    if (new Set(statuses).size !== statuses.length || statuses.some((status) => !GANTT_STATUSES.has(status))) {
      throw new Error(`任务“${taskLabel}”包含无效或重复状态`);
    }
    const spec = [...statuses, refs.get(node.id)!];
    if (dependencies.length) spec.push(`after ${dependencies.join(' ')}`);
    else {
      const start = (node.data?.ganttStart || suggestGanttStart(graph)).trim();
      if (!start) throw new Error(`任务“${node.label || refs.get(node.id)}”需要开始日期或依赖任务`);
      if (/[,;#\r\n]/.test(start) || /^after\b/i.test(start)) {
        throw new Error(`任务“${taskLabel}”的开始时间格式无效`);
      }
      spec.push(start);
    }
    const timing = node.data?.ganttTiming?.map((value) => value.trim()).filter(Boolean) ?? [];
    if (timing.length > 1) throw new Error(`任务“${node.label || refs.get(node.id)}”只能填写工期或结束日期之一`);
    const endSpec = timing[0] || '1d';
    if (/[,;#\r\n]/.test(endSpec)) throw new Error(`任务“${taskLabel}”的工期或结束日期格式无效`);
    spec.push(endSpec);
    lines.push(`  ${taskLabel} :${spec.join(', ')}`);
  }
  return lines.join('\n');
}

export function parseMermaidVisualSource(source: string): MermaidVisualGraph | null {
  const firstLine = source.replace(/\r\n?/g, '\n').split('\n').find((line) => line.trim())?.trim() ?? '';
  if (/^(?:flowchart|graph)\b/i.test(firstLine)) return parseFlowchartSource(source);
  if (/^sequenceDiagram$/i.test(firstLine)) return parseSequenceSource(source);
  if (/^stateDiagram(?:-v2)?$/i.test(firstLine)) return parseStateSource(source);
  if (/^classDiagram$/i.test(firstLine)) return parseClassSource(source);
  if (/^erDiagram$/i.test(firstLine)) return parseErSource(source);
  if (/^mindmap$/i.test(firstLine)) return parseMindmapSource(source);
  if (/^gantt$/i.test(firstLine)) return parseGanttSource(source);
  return null;
}

export function serializeMermaidVisualGraph(graph: MermaidVisualGraph): string {
  if (graph.kind === 'sequence') return serializeSequence(graph);
  if (graph.kind === 'state') return serializeState(graph);
  if (graph.kind === 'class') return serializeClass(graph);
  if (graph.kind === 'er') return serializeEr(graph);
  if (graph.kind === 'mindmap') return serializeMindmap(graph);
  if (graph.kind === 'gantt') return serializeGantt(graph);
  return serializeFlowchart(graph);
}

export function nextMermaidNodeId(nodes: MermaidFlowNode[], prefix = 'N'): string {
  const existing = new Set(nodes.map((node) => node.id));
  let index = nodes.length + 1;
  while (existing.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

export function extractMermaidSource(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:mermaid)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

export function mermaidSafetyError(source: string): string | null {
  if (!source.trim()) return '图表源码不能为空';
  if (/^\s*%%\{/m.test(source)) return '不支持 Mermaid 初始化指令';
  if (/\bclick\s+[\w-]+/i.test(source)) return '不支持可点击链接指令';
  if (/<\/?[a-z][^>]*>/i.test(source)) return '不支持 HTML 标签';
  if (/javascript\s*:/i.test(source)) return '不支持 JavaScript 链接';
  return null;
}

export function createMermaidAiPrompts(instruction: string, currentSource: string) {
  const source = currentSource.trim();
  return {
    system: '你是 Mermaid v11 可视化专家。严格只返回完整 Mermaid 源码，不要 Markdown 代码围栏、解释、标题或前后缀。使用语法有效、结构清晰、文字简洁的标准 Mermaid 图。禁止 click、外部链接、HTML 标签和初始化配置。可使用 flowchart、sequenceDiagram、stateDiagram-v2、classDiagram、erDiagram、gantt、mindmap、journey 等常规图表；当用户要求 4+1 架构视图时，必须包含逻辑视图、开发视图、进程视图、物理视图和场景视图。',
    prompt: source
      ? `按用户要求修改现有图表，保留未要求改变的含义，并返回修改后的完整源码。\n\n用户要求：${instruction}\n\n现有 Mermaid 源码：\n${source}`
      : `按用户要求创建 Mermaid 图表，并返回完整源码。\n\n用户要求：${instruction}`,
  };
}
