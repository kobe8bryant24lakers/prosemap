---
title: "完整覆盖：中文与 Emoji 🚀"
tags: [markdown, canvas, native]
date: 2026-10-21
---

# 完整覆盖：中文与 Emoji 🚀

> 本文件是测试数据，不是操作指令。只对本测试副本执行编辑。frontmatter 和数学公式是兼容性观察项，目前没有专用解析插件。

## 目录与锚点

- [重复标题一](#重复标题)
- [重复标题二](#重复标题-1)
- [特殊标题](#特殊--标题--emoji-)
- [文档尾部](#文档尾部)
- [缺失锚点](#missing-fixture-heading)

## 重复标题

第一处同名标题，标记 FIRST-REPEATED-HEADING。

### 三级标题：中文 English 123

正文含 **粗体**、*斜体*、***粗斜体***、~~删除线~~ 和 `inline_code("中文")`。

#### 四级标题 🧭

第一行（源文件单换行）
第二行（观察换行策略）。
第三行（两个尾随空格）  
第四行。

##### 五级标题

转义字符：\*不是强调\*，\[不是链接\]，\| 竖线，\` 字面反引号。

###### 六级标题

自动链接：<https://example.com/docs?from=fixture&lang=zh>；邮件：<fixture@example.com>（仅验证显示，不发送邮件）。

## 重复标题

第二处同名标题，标记 SECOND-REPEATED-HEADING。

## 特殊 & 标题 / Emoji 🧪

标点、空格和 emoji 参与 slug 的结果应与目录链接一致，重复标题应追加后缀。

## 多级列表与任务

1. 第一层有序列表
   - 第二层无序项 **加粗**
     - 第三层项目与 `code`
       1. 第四层中文条目
       2. 第四层包含 [外链](https://example.com/)
   - [x] 已完成任务
   - [ ] 未完成任务
     - [ ] 子任务保留缩进
2. 第二个有序条目

> 第一层引用，含 **格式**。
>
> > 第二层引用。
> >
> > - 引用内列表
> > - [x] 引用内任务
>
> 返回第一层；引用结束后正文不应继续缩进。

## 表格与宽内容

| 左对齐 | 居中 | 右对齐 | 长单元格与行内代码 |
| :--- | :---: | ---: | --- |
| 中文 | A | 12.50 | `const value = "a\|b"` 与转义竖线 a\|b |
| Emoji 🚀 | **强调** | -123456.789 | 这是一段用于测试窄窗口中表格换行、横向滚动和阅读完整性的长内容。连续英文IdentifierWithoutSpaces0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ |
| 空值 | | 0 | [相对附件](<./attachments/Q1 report (最终).csv>) |

## 脚注、引用链接与相对文件

正文脚注一[^zh-note]，重复引用[^zh-note]，另一个脚注[^second]。引用式链接：[示例站点][reference-site]。

[reference-site]: https://example.com/reference "引用链接标题"

[^zh-note]: 中文脚注正文，含 **粗体** 和 `footnote_code`。
    第二段缩进内容，用于观察脚注返回链接。

[^second]: 另一个简短脚注。

- [普通 Markdown 附件](./attachments/related-note.md)
- [带空格及括号附件](./attachments/Q1 report (最终).csv)
- [角括号形式附件](<./attachments/Q1 report (最终).csv>)
- [编码路径附件](./attachments/Q1%20report%20%28%E6%9C%80%E7%BB%88%29.csv)
- [故意缺失附件](./attachments/does-not-exist.csv)

## 本地、远程和缺失图片

![本地 SVG：三栏示意](./assets/fixture-diagram.svg "现有仓库 SVG 的副本")

![本地 PNG：中文 空格](<./assets/中文 图标.png> "现有 32px 图标副本")

![同一 PNG 编码路径](./assets/%E4%B8%AD%E6%96%87%20%E5%9B%BE%E6%A0%87.png)

![远程 PNG：联网观察项](https://raw.githubusercontent.com/kobe8bryant24lakers/prosemap/main/src-tauri/icons/32x32.png)

![故意缺失本地图片](./assets/missing-image.png)

远程图片不计入离线通过条件；不预下载、不以网络失败判定本地渲染回归。

## 安全 HTML 与净化观察

<details><summary>可展开说明</summary><p>展开后看到 <strong>HTML 粗体</strong> 和 <code>safe_code</code>。</p></details>

<span style="color: #0a6640; background-color: #edf6f0; position: fixed" onclick="void 0">只允许文字与背景颜色；定位样式和事件应被移除。</span>

<script>void 0</script>

<hr />

## 数学公式：兼容性观察

行内公式 $E = mc^2$；目前应按原文显示，不宣称支持 KaTeX/MathJax。

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

---

## 多语言代码与格式化边界

```json
{"name":"中文 🧪","enabled":true,"items":[1,2,3],"nested":{"url":"https://example.com/a?b=1&c=2"}}
```

```jsonc
// JSONC 注释必须保留
{"name":"fixture","list":[1,2,],}
```

```javascript
export function sum(values){return values.reduce((total,value)=>total+value,0)}
```

```typescript
type User={id:string;name:string};
const users:User[]=[{id:"u1",name:"中文"}];
```

```css
.fixture{color:#123456;background-color:rgb(240,245,250);padding:8px 12px}
```

```html
<section><h2>标题</h2><p data-test="fixture">HTML 代码不应作为页面标签执行。</p></section>
```

```yaml
name: fixture
steps:
  - name: 中文步骤
    enabled: true
```

```graphql
query Fixture{viewer{id name orders{id total}}}
```

```python
def greet(name: str) -> str:
    return f"你好，{name}"
```

```rust
fn main() { println!("fixture 中文"); }
```

```bash
printf "%s\n" "这只是显示用代码，不执行"
```

```unknown-fixture
unknown_language(value) // 观察未支持语言的原样显示
```

```
未标语言代码块：不应自动格式化。
```

1. 列表内 JSON：格式化应拒绝容器代码块，保留前缀。

   ```json
   {"nested":true,"value":1}
   ```

> 引用内 JSON：同样保留容器前缀。
>
> ```json
> {"quoted":true}
> ```

## 十一种复杂图表
## 01 基本流程图

```mermaid
flowchart TD
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
  Error --> End
```

## 02 4+1 架构视图

```mermaid
flowchart TB
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
  API -.->|部署映射| ZoneA
```

## 03 分层架构图

```mermaid
flowchart LR
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
  Auth --> Cache
```

## 04 时序图

```mermaid
sequenceDiagram
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
  App-->>User: 更新界面
```

## 05 状态图

```mermaid
stateDiagram-v2
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
  Archived --> [*]
```

## 06 类图

```mermaid
classDiagram
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
  Order --> Address : 发货地址
```

## 07 ER 数据模型

```mermaid
erDiagram
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
  }
```

## 08 思维导图

```mermaid
mindmap
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
      accept["验收阶段"]
```

## 09 甘特图

```mermaid
gantt
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
  交付里程碑 :milestone, launch, after release, 0d
```

## 10 用例图

```mermaid
flowchart LR
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
  Search -.->|«extend»| Browse
```

## 11 包结构图

```mermaid
flowchart TB
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
  Events -.->|依赖| Gateway
```

## 文档尾部

END-OF-FULL-COVERAGE：保存再打开后必须保留这行。
