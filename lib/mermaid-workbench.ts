export type MermaidFlowDirection = 'TB' | 'TD' | 'BT' | 'LR' | 'RL';

export type MermaidNodeShape = 'rectangle' | 'rounded' | 'terminal' | 'decision' | 'circle' | 'database';

export type MermaidEdgeStyle = 'arrow' | 'line' | 'dotted' | 'thick';

export type MermaidFlowNode = {
  id: string;
  label: string;
  shape: MermaidNodeShape;
};

export type MermaidFlowEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  style: MermaidEdgeStyle;
};

export type MermaidFlowGraph = {
  direction: MermaidFlowDirection;
  nodes: MermaidFlowNode[];
  edges: MermaidFlowEdge[];
};

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
    visualEditable: false,
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
    visualEditable: false,
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
    visualEditable: false,
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
    visualEditable: false,
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
    visualEditable: false,
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
    visualEditable: false,
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
    // The form editor intentionally supports only a lossless subset. Returning
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

  return { direction, nodes: Array.from(nodeMap.values()), edges };
}

function safeLabel(value: string): string {
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

export function nextMermaidNodeId(nodes: MermaidFlowNode[]): string {
  const existing = new Set(nodes.map((node) => node.id));
  let index = nodes.length + 1;
  while (existing.has(`N${index}`)) index += 1;
  return `N${index}`;
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
