// Deterministic desktop acceptance fixtures. No network or production settings.
// node --experimental-strip-types scripts/fixture-generate.mjs [--check]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MERMAID_TEMPLATES, parseMermaidVisualSource, serializeMermaidVisualGraph } from '../lib/mermaid-workbench.ts';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(repository, 'tests/fixtures');
const checkOnly = process.argv.includes('--check');
const files = new Map();
const entries = [];
const fence = (language, source) => '```' + language + '\n' + source.trimEnd() + '\n```';
const diagrams = [
  { id: 'basic-flowchart', source: `flowchart TD
  Start(["开始 🚀"])
  Input["接收中文请求 / Request"]
  Normalize("清理空白与编码")
  Valid{"参数校验通过？"}
  Duplicate{"重复请求？"}
  Cache[("缓存")]
  Queue["异步队列"]
  Worker["业务处理：长标签用于检查窄窗口换行与边界"]
  Audit["审计日志"]
  Result["返回结果"]
  Retry["重试计数 +1"]
  Error["错误提示 ⚠️"]
  End(["结束"])
  Start --> Input
  Input --> Normalize
  Normalize --> Valid
  Valid -->|是| Duplicate
  Valid -->|否| Error
  Duplicate -->|命中| Cache
  Duplicate -->|未命中| Queue
  Cache --> Result
  Queue ==> Worker
  Worker -->|成功| Result
  Worker -.->|可恢复错误| Retry
  Retry --> Queue
  Worker -.->|旁路审计| Audit
  Worker -->|记录摘要| Audit
  Audit -->|归档| Audit
  Result --> End
  Error --> End` },
  { id: 'four-plus-one', source: `flowchart TB
  Scenario(["场景视图 +1：会员下单与退款"])
  Logical["逻辑视图：领域模型"]
  Customer["客户聚合"]
  Order["订单聚合"]
  Development["开发视图：代码组织"]
  Frontend["前端模块"]
  Backend["应用服务模块"]
  Process["进程视图：并发与通信"]
  API["API 进程"]
  Consumer["消息消费者"]
  Physical["物理视图：部署拓扑"]
  ZoneA["可用区 A"]
  ZoneB["可用区 B"]
  Storage[("共享数据存储")]
  Logical --> Customer
  Logical --> Order
  Development --> Frontend
  Development --> Backend
  Process --> API
  Process --> Consumer
  Physical --> ZoneA
  Physical --> ZoneB
  ZoneA --> Storage
  ZoneB --> Storage
  Logical -->|用例验证| Scenario
  Development -->|实现| Scenario
  Scenario -->|驱动交互| Process
  Scenario -->|部署约束| Physical
  Order -.->|代码映射| Backend
  Backend -.->|运行映射| API
  API -.->|部署映射| ZoneA` },
  { id: 'architecture', source: `flowchart LR
  subgraph Clients["访问层"]
    Web["网页客户端"]
    Desktop["桌面客户端"]
    Mobile["移动客户端"]
  end
  subgraph Services["服务层"]
    Gateway["API 网关"]
    Auth["鉴权服务"]
    Catalog["目录服务"]
    Orders["订单服务"]
    Billing["账务服务"]
  end
  subgraph Data["数据层"]
    SQL[("关系数据库")]
    Cache[("缓存")]
    Search[("搜索索引")]
    Events["事件总线"]
  end
  External["外部支付系统"]
  Web --> Gateway
  Desktop --> Gateway
  Mobile --> Gateway
  Gateway --> Auth
  Gateway --> Catalog
  Gateway --> Orders
  Catalog --> Search
  Catalog --> Cache
  Orders --> SQL
  Orders ==> Events
  Events -.->|异步处理| Billing
  Billing --> External
  External -.->|支付回调| Billing
  Billing --> SQL
  Auth --> Cache` },
  { id: 'sequence', source: `sequenceDiagram
  autonumber
  actor User as 用户 👩‍💻
  participant App as 桌面应用
  participant API as 网关服务
  participant DB as 数据库
  participant Queue as 消息队列
  participant Audit as 审计服务
  User->>App: 提交订单
  App->>+API: POST orders
  Note over App,API: 请求编号保持一致
  API->>DB: 查询库存
  DB-->>API: 库存结果
  alt 库存足够
    API->>DB: 创建订单
    DB-->>API: 订单编号
    par 通知
      API->>Queue: 发布订单事件
      Queue-->>API: 已接收
    and 审计
      API->>Audit: 记录操作
      Audit-->>API: 已归档
    end
  else 库存不足
    API-->>App: 返回业务错误
  end
  loop 最多两次状态检查
    App->>API: 查询状态
    API-->>App: 当前状态
  end
  opt 展示帮助
    App->>App: 整理用户提示
  end
  API-->>-App: 完成响应
  App-->>User: 更新界面` },
  { id: 'state', source: `stateDiagram-v2
  direction LR
  state "草稿 📝" as Draft
  state "待审核" as Review
  state "自动校验中" as Checking
  state "等待人工确认" as Manual
  state "已发布" as Published
  state "发布失败" as Failed
  state "已归档" as Archived
  [*] --> Draft
  Draft --> Review: 提交
  Review --> Checking: 开始审核
  Checking --> Published: 自动通过
  Checking --> Manual: 需要人工
  Manual --> Published: 批准
  Manual --> Draft: 驳回修改
  Checking --> Failed: 校验异常
  Failed --> Review: 重新提交
  Published --> Published: 更新统计
  Published --> Archived: 到期归档
  Archived --> [*]` },
  { id: 'class', source: `classDiagram
  direction LR
  class Entity {
    +String id
    +DateTime createdAt
    +validate() bool
  }
  class Customer["客户 Customer"] {
    +String name
    +String email
    +placeOrder() Order
  }
  class Order["订单 Order"] {
    +String number
    +Decimal total
    +submit() void
    +cancel(reason) bool
  }
  class OrderLine {
    +int quantity
    +Decimal unitPrice
  }
  class Product {
    +String sku
    +String name
  }
  class Address {
    +String city
    +String street
  }
  class Payment {
    +String status
    +authorize() bool
  }
  class PaymentGateway {
    +charge(amount) bool
  }
  Entity <|-- Customer
  Entity <|-- Order
  Customer "1" --> "0..*" Order : 提交
  Customer "1" o-- "1..*" Address : 保存地址
  Order "1" *-- "1..*" OrderLine : 包含
  OrderLine "*" --> "1" Product : 指向商品
  Order "1" --> "0..1" Payment : 支付记录
  Payment ..> PaymentGateway : 调用
  Order --> Address : 发货地址` },
  { id: 'er', source: `erDiagram
  direction LR
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER ||--o{ ADDRESS : stores
  ORDER ||--|{ ORDER_LINE : contains
  PRODUCT ||--o{ ORDER_LINE : appears_in
  ORDER ||--o| PAYMENT : receives
  ADDRESS ||--o{ ORDER : ships_to
  CUSTOMER {
    string id PK
    string email UK
    string display_name
    datetime created_at
  }
  ADDRESS {
    string id PK
    string customer_id FK
    string city
    string street
  }
  ORDER {
    string id PK
    string customer_id FK
    string address_id FK
    decimal total
    string status
  }
  ORDER_LINE {
    string id PK
    string order_id FK
    string product_id FK
    int quantity
    decimal unit_price
  }
  PRODUCT {
    string id PK
    string sku UK
    string name
    decimal price
  }
  PAYMENT {
    string id PK
    string order_id FK
    string provider_ref UK
    decimal amount
  }` },
  { id: 'mindmap', source: `mindmap
  root((复杂产品规划 🚀))
    value["用户价值"]
      audience["目标用户"]
        author["内容作者"]
        engineer["研发人员"]
      problems["核心问题"]
        flow["编辑流程中断"]
        clarity["长图阅读困难"]
    capability["产品能力"]
      editing["编辑"]
        source["源码往返"]
        canvas["画布交互"]
          select["选择与多选"]
          move["拖动与吸附"]
      delivery["交付"]
        export["文档保存"]
        desktop["跨平台桌面"]
    quality["质量验证"]
      functional["功能正确"]
      usability["易用性"]
      performance["大图性能"]
      boundary["边界恢复"]
    schedule["计划"]
      design["设计阶段"]
      build["开发阶段"]
      accept["验收阶段"]` },
  { id: 'gantt', source: `gantt
  title 桌面绘图工具交付计划
  dateFormat YYYY-MM-DD
  axisFormat %m-%d
  excludes weekends
  todayMarker off
  section 设计
  需求调研 :done, req, 2026-10-05, 3d
  交互方案 :done, design, after req, 4d
  技术评估 :done, review, after req, 2d
  section 开发
  画布基础 :active, core, after design review, 5d
  文档集成 :docs, after design, 4d
  连线编辑 :crit, edges, after core, 3d
  性能优化 :perf, after core, 4d
  section 验证与发布
  自动回归 :tests, after edges docs, 3d
  原生验收 :crit, native, after tests perf, 2d
  发布准备 :release, after native, 1d
  交付里程碑 :milestone, launch, after release, 0d` },
  { id: 'usecase', source: `flowchart LR
  %% prosemap:usecase
  Guest["«actor» 访客"]
  Member["«actor» 注册会员"]
  Admin["«actor» 管理员"]
  PaymentProvider["«actor» 支付平台"]
  subgraph Shop["交易系统"]
    Browse(["浏览商品"])
    Search(["搜索商品"])
    Register(["注册账号"])
    Login(["身份验证"])
    Order(["提交订单"])
    Coupon(["使用优惠券"])
    Pay(["在线支付"])
    Refund(["申请退款"])
    Manage(["维护商品"])
    Audit(["审查交易"])
  end
  Guest --- Browse
  Guest --- Search
  Guest --- Register
  Member --- Order
  Member --- Refund
  Admin --- Manage
  Admin --- Audit
  PaymentProvider --- Pay
  Order -.->|«include»| Login
  Order -.->|«include»| Pay
  Coupon -.->|«extend»| Order
  Refund -.->|«include»| Login
  Manage -.->|«include»| Login
  Search -.->|«extend»| Browse` },
  { id: 'package', source: `flowchart TB
  %% prosemap:package
  subgraph App["应用"]
    subgraph Presentation["表现层"]
      Pages["页面"]
      Components["通用组件"]
      Controllers["界面控制器"]
    end
    subgraph Domain["领域层"]
      subgraph Ordering["订单领域"]
        Orders["订单服务"]
        Models["订单模型"]
        Policies["业务规则"]
      end
      subgraph Accounts["账号领域"]
        Users["用户服务"]
        Permissions["权限规则"]
      end
    end
    subgraph Infrastructure["基础设施层"]
      Repository["数据仓储"]
      Gateway["外部接口"]
      Events["事件发布"]
    end
  end
  Pages --> Components
  Pages --> Controllers
  Controllers -.->|依赖| Orders
  Controllers -.->|依赖| Users
  Orders --> Models
  Orders --> Policies
  Orders -.->|依赖| Repository
  Orders -.->|依赖| Events
  Users --> Permissions
  Users -.->|依赖| Repository
  Events -.->|依赖| Gateway` },
];

function add(path, content, assertions, extra = {}) {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  files.set(path, data);
  entries.push({ path, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), assertions, ...extra });
}

function inspectGraph(source, context) {
  const graph = parseMermaidVisualSource(source);
  assert.ok(graph, `${context}: canvas parser rejected intended editable syntax`);
  const ids = new Set(graph.nodes.map((node) => node.id));
  assert.equal(ids.size, graph.nodes.length, `${context}: duplicate node ID`);
  assert.equal(new Set(graph.edges.map((edge) => edge.id)).size, graph.edges.length, `${context}: duplicate edge ID`);
  for (const edge of graph.edges) assert.ok(ids.has(edge.from) && ids.has(edge.to), `${context}: missing edge endpoint`);
  const serialized = serializeMermaidVisualGraph(graph);
  const restored = parseMermaidVisualSource(serialized);
  assert.ok(restored, `${context}: round-trip parse failed`);
  assert.equal(serializeMermaidVisualGraph(restored), serialized, `${context}: serialization is not stable`);
  assert.equal(restored.nodes.length, graph.nodes.length, `${context}: node loss`);
  assert.equal(restored.edges.length, graph.edges.length, `${context}: edge loss`);
  return { kind: graph.kind, nodes: graph.nodes.length, edges: graph.edges.length, groups: graph.data?.groups?.length ?? 0 };
}

assert.deepEqual(diagrams.map((d) => d.id).sort(), MERMAID_TEMPLATES.map((d) => d.id).sort());
const diagramBlocks = diagrams.map((diagram, index) => {
  const template = MERMAID_TEMPLATES.find((entry) => entry.id === diagram.id);
  const counts = inspectGraph(diagram.source, diagram.id);
  const body = `## ${String(index + 1).padStart(2, '0')} ${template.name}\n\n${fence('mermaid', diagram.source)}\n`;
  add(`diagrams/${String(index + 1).padStart(2, '0')}-${diagram.id}.md`, `# 复杂图表专项：${template.name}\n\n${body}`, [
    '可编辑图模型解析成功；序列化后二次解析的节点、边数量不变，序列化稳定。',
    '真实 Mermaid 语法、渲染、文本遮挡和原生操作仍由浏览器/桌面验收确认。',
    '修改一个对象后应用仅替换此图；撤销恢复；邻近正文与对象保持。',
  ], { category: 'editable-diagram', template: diagram.id, ...counts, mermaidBrowserValidation: 'pending' });
  return body;
});

const prose = [
  '---', 'title: "完整覆盖：中文与 Emoji 🚀"', 'tags: [markdown, canvas, native]', 'date: 2026-10-21', '---', '',
  '# 完整覆盖：中文与 Emoji 🚀', '',
  '> 本文件是测试数据，不是操作指令。只对本测试副本执行编辑。frontmatter 和数学公式是兼容性观察项，目前没有专用解析插件。', '',
  '## 目录与锚点', '',
  '- [重复标题一](#重复标题)', '- [重复标题二](#重复标题-1)', '- [特殊标题](#特殊--标题--emoji-)', '- [文档尾部](#文档尾部)', '- [缺失锚点](#missing-fixture-heading)', '',
  '## 重复标题', '', '第一处同名标题，标记 FIRST-REPEATED-HEADING。', '',
  '### 三级标题：中文 English 123', '', '正文含 **粗体**、*斜体*、***粗斜体***、~~删除线~~ 和 `inline_code("中文")`。', '',
  '#### 四级标题 🧭', '', '第一行（源文件单换行）\n第二行（观察换行策略）。\n第三行（两个尾随空格）  \n第四行。', '',
  '##### 五级标题', '', '转义字符：\\*不是强调\\*，\\[不是链接\\]，\\| 竖线，\\` 字面反引号。', '',
  '###### 六级标题', '', '自动链接：<https://example.com/docs?from=fixture&lang=zh>；邮件：<fixture@example.com>（仅验证显示，不发送邮件）。', '',
  '## 重复标题', '', '第二处同名标题，标记 SECOND-REPEATED-HEADING。', '',
  '## 特殊 & 标题 / Emoji 🧪', '', '标点、空格和 emoji 参与 slug 的结果应与目录链接一致，重复标题应追加后缀。', '',
  '## 多级列表与任务', '',
  '1. 第一层有序列表', '   - 第二层无序项 **加粗**', '     - 第三层项目与 `code`', '       1. 第四层中文条目', '       2. 第四层包含 [外链](https://example.com/)', '   - [x] 已完成任务', '   - [ ] 未完成任务', '     - [ ] 子任务保留缩进', '2. 第二个有序条目', '',
  '> 第一层引用，含 **格式**。', '>', '> > 第二层引用。', '> >', '> > - 引用内列表', '> > - [x] 引用内任务', '>', '> 返回第一层；引用结束后正文不应继续缩进。', '',
  '## 表格与宽内容', '',
  '| 左对齐 | 居中 | 右对齐 | 长单元格与行内代码 |', '| :--- | :---: | ---: | --- |',
  '| 中文 | A | 12.50 | `const value = "a\\|b"` 与转义竖线 a\\|b |',
  '| Emoji 🚀 | **强调** | -123456.789 | 这是一段用于测试窄窗口中表格换行、横向滚动和阅读完整性的长内容。连续英文IdentifierWithoutSpaces0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ |',
  '| 空值 | | 0 | [相对附件](<./attachments/Q1 report (最终).csv>) |', '',
  '## 脚注、引用链接与相对文件', '',
  '正文脚注一[^zh-note]，重复引用[^zh-note]，另一个脚注[^second]。引用式链接：[示例站点][reference-site]。', '',
  '[reference-site]: https://example.com/reference "引用链接标题"', '',
  '[^zh-note]: 中文脚注正文，含 **粗体** 和 `footnote_code`。', '    第二段缩进内容，用于观察脚注返回链接。', '', '[^second]: 另一个简短脚注。', '',
  '- [普通 Markdown 附件](./attachments/related-note.md)',
  '- [带空格及括号附件](./attachments/Q1 report (最终).csv)',
  '- [角括号形式附件](<./attachments/Q1 report (最终).csv>)',
  '- [编码路径附件](./attachments/Q1%20report%20%28%E6%9C%80%E7%BB%88%29.csv)',
  '- [故意缺失附件](./attachments/does-not-exist.csv)', '',
  '## 本地、远程和缺失图片', '',
  '![本地 SVG：三栏示意](./assets/fixture-diagram.svg "现有仓库 SVG 的副本")', '',
  '![本地 PNG：中文 空格](<./assets/中文 图标.png> "现有 32px 图标副本")', '',
  '![同一 PNG 编码路径](./assets/%E4%B8%AD%E6%96%87%20%E5%9B%BE%E6%A0%87.png)', '',
  '![远程 PNG：联网观察项](https://raw.githubusercontent.com/kobe8bryant24lakers/prosemap/main/src-tauri/icons/32x32.png)', '',
  '![故意缺失本地图片](./assets/missing-image.png)', '',
  '远程图片不计入离线通过条件；不预下载、不以网络失败判定本地渲染回归。', '',
  '## 安全 HTML 与净化观察', '',
  '<details><summary>可展开说明</summary><p>展开后看到 <strong>HTML 粗体</strong> 和 <code>safe_code</code>。</p></details>', '',
  '<span style="color: #0a6640; background-color: #edf6f0; position: fixed" onclick="void 0">只允许文字与背景颜色；定位样式和事件应被移除。</span>', '',
  '<script>void 0</script>', '', '<hr />', '',
  '## 数学公式：兼容性观察', '',
  '行内公式 $E = mc^2$；目前应按原文显示，不宣称支持 KaTeX/MathJax。', '',
  '$$', '\\int_0^1 x^2\\,dx = \\frac{1}{3}', '$$', '',
  '---', '', '## 多语言代码与格式化边界', '',
  fence('json', '{"name":"中文 🧪","enabled":true,"items":[1,2,3],"nested":{"url":"https://example.com/a?b=1&c=2"}}'), '',
  fence('jsonc', '// JSONC 注释必须保留\n{"name":"fixture","list":[1,2,],}'), '',
  fence('javascript', 'export function sum(values){return values.reduce((total,value)=>total+value,0)}'), '',
  fence('typescript', 'type User={id:string;name:string};\nconst users:User[]=[{id:"u1",name:"中文"}];'), '',
  fence('css', '.fixture{color:#123456;background-color:rgb(240,245,250);padding:8px 12px}'), '',
  fence('html', '<section><h2>标题</h2><p data-test="fixture">HTML 代码不应作为页面标签执行。</p></section>'), '',
  fence('yaml', 'name: fixture\nsteps:\n  - name: 中文步骤\n    enabled: true'), '',
  fence('graphql', 'query Fixture{viewer{id name orders{id total}}}'), '',
  fence('python', 'def greet(name: str) -> str:\n    return f"你好，{name}"'), '',
  fence('rust', 'fn main() { println!("fixture 中文"); }'), '',
  fence('bash', 'printf "%s\\n" "这只是显示用代码，不执行"'), '',
  fence('unknown-fixture', 'unknown_language(value) // 观察未支持语言的原样显示'), '',
  fence('', '未标语言代码块：不应自动格式化。'), '',
  '1. 列表内 JSON：格式化应拒绝容器代码块，保留前缀。', '', '   ```json', '   {"nested":true,"value":1}', '   ```', '',
  '> 引用内 JSON：同样保留容器前缀。', '>', '> ```json', '> {"quoted":true}', '> ```', '',
  '## 十一种复杂图表', '',
].join('\n');

add('full-coverage.md', prose + diagramBlocks.join('\n') + '\n## 文档尾部\n\nEND-OF-FULL-COVERAGE：保存再打开后必须保留这行。\n', [
  '包含 11 个复杂 Mermaid 围栏，分别对应全部模板；完整文档仅包含设计为有效的图表。',
  '覆盖六级标题、中文/emoji/重复标题、锚点、列表/任务/引用、表格、脚注、HTML、链接、图片及 13 种代码标记/无标记代码。',
  'frontmatter 没有 remark-frontmatter 插件，按普通 Markdown 观察；数学公式没有 remark-math/KaTeX，不要求公式排版。',
  '相对资源使用本目录，需以原生应用打开此文件或完整复制目录；远程图片只作联网观察。',
  '脚本/事件属性/position 样式应被净化；安全颜色和允许标签可显示。',
  '保存前后比较正文、围栏边界、中文/emoji、最后标记；只格式化指定代码块，不改其余块。',
], { category: 'markdown-coverage', mermaidDiagrams: 11 });

const invalidCases = [
  ['未闭合节点', 'flowchart TD\n  A[未闭合节点'],
  ['不完整连线', 'flowchart TD\n  A -->'],
  ['未闭合时序控制块', 'sequenceDiagram\n  participant A\n  participant B\n  alt success\n    A->>B: missing end'],
  ['不存在的图种关键字', 'usecaseDiagram\n  actor User'],
];
add('invalid-mermaid.md', '# Mermaid 故意无效样例\n\n预期逐块显示可恢复错误；不应崩溃、覆盖原文或让后续正文消失。\n\n' + invalidCases.map(([name, source]) => `## ${name}\n\n${fence('mermaid', source)}\n`).join('\n') + '\nEND-OF-INVALID-FIXTURE\n', [
  '4 个故意无效的 Mermaid 块；官方语法校验预期失败，不要求图模型解析器也全部拒绝。',
  '应用无效草稿必须保持原文档；改为有效源码后错误应恢复。',
  '底部 END-OF-INVALID-FIXTURE 仍可见。',
], { category: 'invalid', mermaidDiagrams: 4 });

add('empty-mermaid.md', '# 空图与空白边界\n\n## 空围栏\n\n```mermaid\n\n```\n\n## 只有空白\n\n```mermaid\n   \n\n```\n\n## 仅流程图头\n\n```mermaid\nflowchart TD\n```\n\n## 仅时序图头\n\n```mermaid\nsequenceDiagram\n```\n\n## 正常图用于恢复检查\n\n```mermaid\nflowchart LR\n  A[恢复] --> B[正常]\n```\n\nEND-OF-EMPTY-FIXTURE\n', [
  '空/空白围栏与只有图头分别观察，不把无节点等同语法错误；当前图模型允许零节点 flowchart/sequence。',
  '空图打开、关闭、增加第一个对象可恢复；后续正常图和尾标记仍可见。',
], { category: 'empty', mermaidDiagrams: 5 });
add('empty-document.md', '', ['零字节文档显示空预览，允许输入/保存；无错误或旧文档残影。'], { category: 'empty' });

const readonlyCases = [
  ['带样式定义的流程图', 'flowchart LR\n  A[带样式节点] --> B[保留原始样式]\n  classDef highlighted fill:#e3f2fd,stroke:#1565c0\n  class A highlighted'],
  ['子图局部方向', 'flowchart TB\n  subgraph Group[局部横向]\n    direction LR\n    A[甲] --> B[乙]\n  end\n  B --> C[丙]'],
  ['复合状态', 'stateDiagram-v2\n  [*] --> Active\n  state Active {\n    [*] --> Waiting\n    Waiting --> Running: begin\n    Running --> [*]\n  }\n  Active --> [*]'],
];
for (const [name, source] of readonlyCases) assert.equal(parseMermaidVisualSource(source), null, `${name} should be read-only`);
add('readonly-mermaid.md', '# 有效语法但超出画布编辑子集\n\n预期真实 Mermaid 能渲染，画布给出只读预览并完整保留源码。\n\n' + readonlyCases.map(([name, source]) => `## ${name}\n\n${fence('mermaid', source)}\n`).join('\n'), [
  '样式定义、局部方向和复合状态均由图模型拒绝为 null，必须降级只读而非简化后丢失原文。',
  '真实 Mermaid 语法/渲染由原生验收确认；保存不应删除 classDef/direction/state 容器。',
], { category: 'readonly', mermaidDiagrams: 3, mermaidBrowserValidation: 'pending' });

function largeGraph(count, shortcuts) {
  const lines = ['flowchart LR'];
  for (let index = 0; index < count; index++) lines.push(`  N${index}["节点 ${String(index).padStart(4, '0')} 中文"]`);
  for (let index = 1; index < count; index++) lines.push(`  N${index - 1} --> N${index}`);
  if (shortcuts) for (let index = 0; index + 5 < count; index += 5) lines.push(`  N${index} -.->|分支 ${index}| N${index + 5}`);
  return lines.join('\n');
}
const large = largeGraph(300, true);
add('large-diagram-300.md', '# 大图：300 节点 / 358 连线\n\n单独打开；检查缩放、平移、插入、拖动及一步撤销。不以端点正确等同连续 FPS。\n\n' + fence('mermaid', large) + '\n', [
  '300 节点、358 连线，小于 Mermaid 默认 500-edge 限制；所有节点 ID 唯一，端点存在。',
  '新增第 301 节点不改变已有位置；修改/撤销数量正确；长标签不丢失。',
], { category: 'large', ...inspectGraph(large, 'large-300'), mermaidBrowserValidation: 'pending' });
const oversized = largeGraph(1000, false);
add('oversized-diagram-1000.md', '# 超默认边数限制：1000 节点 / 999 连线\n\n这是容量错误处理专项，不是默认设置下必须渲染成功的图。Mermaid 默认 maxEdges=500；不要为通过测试修改生产安全配置。\n\n' + fence('mermaid', oversized) + '\n\nEND-OF-OVERSIZED-FIXTURE\n', [
  '图模型可解析 1000 节点/999 边，源码语法按链生成。',
  '默认 Mermaid maxEdges=500，真实解析/渲染预期报告边数限制且应用保持响应；不得当成性能通过结果。',
], { category: 'capacity-limit', ...inspectGraph(oversized, 'oversized-1000'), expectedMermaidLimit: 'maxEdges=500' });

const repeated = 'flowchart LR\n  A[相同节点] --> B[相同结果]';
const targeting = ['# 重复与容器图定位', '', 'BEFORE-FIRST', '', fence('mermaid', repeated), '', 'BETWEEN-DIAGRAMS', '', fence('text', repeated), '', fence('mermaid', repeated), '', '> 引用容器中的第三张图', '>', ...fence('mermaid', repeated).split('\n').map((line) => '> ' + line), '', '1. 列表容器中的第四张图', '', ...fence('mermaid', repeated).split('\n').map((line) => '   ' + line), '', 'AFTER-LAST', ''].join('\n');
for (const ending of ['lf', 'crlf']) add(`targeting-${ending}.md`, ending === 'crlf' ? targeting.replaceAll('\n', '\r\n') : targeting, [
  '4 张源码相同的图 + 1 个同内容 text 代码块；编辑第二张只改变第二个 Mermaid 围栏。',
  '引用和列表图应用后保留 > / 三空格前缀；CRLF 版本修改后不应混入孤立 LF。',
  '首尾标记和普通 text 围栏逐字保留。',
], { category: 'targeting', mermaidDiagrams: 4, lineEnding: ending.toUpperCase() });

const sections = [];
for (let index = 1; index <= 600; index++) {
  const id = String(index).padStart(4, '0');
  sections.push(`## 长文段落 ${id}\n\n定位标记 SECTION-${id}：中文与 Emoji 🧭，用于查找、替换、滚动同步及保存一致性。\n\n- 第一个条目 **强调 ${id}**\n- 第二个条目含 \`code_${id}\`\n  - 子条目保持层级\n\n| 编号 | 内容 |\n| --- | --- |\n| ${id} | 多行长文中的表格与链接 [返回开头](#长文压力样例) |\n\n段尾标记 END-SECTION-${id}。\n`);
}
add('long-document-600-sections.md', '# 长文压力样例\n\n600 节，每节包含标题、中文、列表、表格和定位标记；不含大量 Mermaid，避免混淆文本与图形开销。\n\n' + sections.join('\n') + '\nEND-OF-LONG-DOCUMENT\n', [
  '600 个连续且唯一的 SECTION-0001…SECTION-0600；超过 6000 行。',
  '查找 SECTION-0300 后定位中部；替换一个标记再撤销，首尾内容不变。',
  '切换编辑/预览/分栏、文末编辑、保存重开不截断；记录响应时间，不能只用静态截图断言流畅。',
], { category: 'long-document', sections: 600 });

add('attachments/related-note.md', '# 本地关联文档\n\nLOCAL-ATTACHMENT-OK：这是测试附件，没有操作指令。\n\n[回到覆盖文档](../full-coverage.md)\n', ['相对 Markdown 链接指向存在文件；由系统默认应用打开，不发送数据。'], { category: 'attachment' });
add('attachments/Q1 report (最终).csv', '编号,名称,金额\n1,中文测试,12.50\n2,Emoji 🚀,0.00\n', ['UTF-8 CSV，路径含空格/括号/中文；普通、角括号和编码链接均指向同一文件。'], { category: 'attachment' });
add('assets/fixture-diagram.svg', readFileSync(resolve(repository, 'docs/fixtures/fixture-diagram.svg')), ['原样复制仓库已有 SVG，不依赖网络。'], { category: 'asset', copiedFrom: 'docs/fixtures/fixture-diagram.svg' });
add('assets/中文 图标.png', readFileSync(resolve(repository, 'src-tauri/icons/32x32.png')), ['原样复制仓库已有 32×32 PNG；Unicode/空格路径与编码路径加载一致。'], { category: 'asset', copiedFrom: 'src-tauri/icons/32x32.png' });

const readme = `# 原生深度验收 fixtures\n\n生成：\`node --experimental-strip-types scripts/fixture-generate.mjs\`。只读复核：追加 \`--check\`。没有网络访问、随机数或当前时间输入；文件 SHA-256 与节点数量见 manifest.json。请复制整个 tests/fixtures 目录到临时验收目录后编辑，避免修改基线。\n\n## 推荐顺序\n\n1. full-coverage.md：Markdown 兼容性与 11 图文混排。\n2. diagrams/：11 个复杂可编辑模板单独操作。\n3. targeting-lf.md / targeting-crlf.md：重复图目标、列表/引用前缀和换行一致性。\n4. invalid-mermaid.md / empty-mermaid.md / empty-document.md / readonly-mermaid.md：错误恢复、空态、无损只读。\n5. large-diagram-300.md：300 节点和 358 边；单独记录渲染/交互。\n6. oversized-diagram-1000.md：1000 节点和 999 边；默认 maxEdges=500 的受控错误专项，不是成功渲染要求。\n7. long-document-600-sections.md：超过 6000 行，独立测文本编辑/预览同步。\n\n## 验证边界\n\n- 生成脚本验证的是 ProseMap 图模型及序列化稳定性，**没有替换 DOMPurify，也没有将其称作官方 Mermaid.parse 或真实渲染通过**。正式 Mermaid 语法和原生渲染需在浏览器/桌面验收；manifest 对应状态为 pending。\n- frontmatter 当前无专用插件，普通 Markdown 可能形成分割线/标题；数学公式无专用插件，按原文观察，不把未排公式认定为新回归。\n- 只读样例使用有效 Mermaid 的扩展结构；画布当前不支持 classDef、局部 direction、复合状态，必须保留原文。\n- 用例/包图是带 prosemap 标记的 flowchart，不能写成不存在的 usecaseDiagram/packageDiagram。\n- 脚注、HTML、远程图片、缺失锚点是实际渲染观察项。远程图片不下载，离线失败不阻塞本地图片验收。\n- 对附件仅验证显示与系统打开，邮件链接不发送邮件。缺失附件/图片刻意不创建。\n- 代码格式化支持 JSON/JSONC/JS/TS/CSS/HTML/YAML/GraphQL；Python/Rust/bash/未知语言及容器代码块用于不支持时的保留/提示检查。\n\n## 图表结构\n\n| 文件 | 节点 | 边 | 分组 |\n| --- | ---: | ---: | ---: |\n${entries.filter((entry) => entry.category === 'editable-diagram').map((entry) => `| ${entry.path} | ${entry.nodes} | ${entry.edges} | ${entry.groups} |`).join('\n')}\n\n具体预期与每个文件的字节数、哈希见 manifest.json；验证完成后应把浏览器/原生实测记录单独保存，不能把生成器通过当作 UI 验收。\n`;
add('README.md', readme + '\n## 只读结构检查\n\n运行 `node --experimental-strip-types scripts/fixture-verify.mjs` 可复核文件哈希、Markdown 真实插件管线、标题锚点、脚注、表格、HTML 净化、资源路径及 LF/CRLF 定位。该脚本不渲染 Mermaid，也不代替原生操作验收。\n', ['验收说明，不是需要在应用中逐项执行的用户文档。'], { category: 'documentation' });

const manifest = {
  schemaVersion: 1,
  purpose: 'Deterministic native Markdown and Mermaid acceptance fixtures',
  generator: 'scripts/fixture-generate.mjs',
  validation: { canvasParserAndRoundTrip: 'passed', mermaidBrowserParseAndRendering: 'pending', nativeInteraction: 'pending', networkRequired: false },
  limits: { mermaidDefaultMaxEdges: 500, frontmatter: 'no dedicated plugin; observe ordinary Markdown output', math: 'no dedicated math renderer; literal text expected' },
  files: entries.map((entry) => ({ ...entry, ...(entry.path.endsWith('.md') ? { lines: files.get(entry.path).toString('utf8').split('\n').length } : {}) })),
};
files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
for (const [path, data] of files) {
  const destination = resolve(root, path);
  if (checkOnly) assert.deepEqual(readFileSync(destination), data, `${path}: regenerate fixtures`);
  else { mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, data); }
}
console.log(JSON.stringify({ mode: checkOnly ? 'check' : 'generate', files: files.size, bytes: [...files.values()].reduce((sum, data) => sum + data.length, 0), diagrams: diagrams.length, canvasRoundTrips: 13, officialMermaidValidation: 'pending-browser' }));
