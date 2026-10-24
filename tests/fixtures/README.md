# 原生深度验收 fixtures

生成：`node --experimental-strip-types scripts/fixture-generate.mjs`。只读复核：追加 `--check`。没有网络访问、随机数或当前时间输入；文件 SHA-256 与节点数量见 manifest.json。请复制整个 tests/fixtures 目录到临时验收目录后编辑，避免修改基线。

## 推荐顺序

1. full-coverage.md：Markdown 兼容性与 11 图文混排。
2. diagrams/：11 个复杂可编辑模板单独操作。
3. targeting-lf.md / targeting-crlf.md：重复图目标、列表/引用前缀和换行一致性。
4. invalid-mermaid.md / empty-mermaid.md / empty-document.md / readonly-mermaid.md：错误恢复、空态、无损只读。
5. large-diagram-300.md：300 节点和 358 边；单独记录渲染/交互。
6. oversized-diagram-1000.md：1000 节点和 999 边；默认 maxEdges=500 的受控错误专项，不是成功渲染要求。
7. long-document-600-sections.md：超过 6000 行，独立测文本编辑/预览同步。

## 验证边界

- 生成脚本验证的是 ProseMap 图模型及序列化稳定性，**没有替换 DOMPurify，也没有将其称作官方 Mermaid.parse 或真实渲染通过**。正式 Mermaid 语法和原生渲染需在浏览器/桌面验收；manifest 对应状态为 pending。
- frontmatter 当前无专用插件，普通 Markdown 可能形成分割线/标题；数学公式无专用插件，按原文观察，不把未排公式认定为新回归。
- 只读样例使用有效 Mermaid 的扩展结构；画布当前不支持 classDef、局部 direction、复合状态，必须保留原文。
- 用例/包图是带 prosemap 标记的 flowchart，不能写成不存在的 usecaseDiagram/packageDiagram。
- 脚注、HTML、远程图片、缺失锚点是实际渲染观察项。远程图片不下载，离线失败不阻塞本地图片验收。
- 对附件仅验证显示与系统打开，邮件链接不发送邮件。缺失附件/图片刻意不创建。
- 代码格式化支持 JSON/JSONC/JS/TS/CSS/HTML/YAML/GraphQL；Python/Rust/bash/未知语言及容器代码块用于不支持时的保留/提示检查。

## 图表结构

| 文件 | 节点 | 边 | 分组 |
| --- | ---: | ---: | ---: |
| diagrams/01-basic-flowchart.md | 13 | 17 | 0 |
| diagrams/02-four-plus-one.md | 14 | 17 | 0 |
| diagrams/03-architecture.md | 13 | 15 | 3 |
| diagrams/04-sequence.md | 6 | 16 | 0 |
| diagrams/05-state.md | 9 | 12 | 0 |
| diagrams/06-class.md | 8 | 9 | 0 |
| diagrams/07-er.md | 6 | 6 | 0 |
| diagrams/08-mindmap.md | 26 | 25 | 0 |
| diagrams/09-gantt.md | 11 | 13 | 0 |
| diagrams/10-usecase.md | 14 | 14 | 1 |
| diagrams/11-package.md | 11 | 11 | 6 |

具体预期与每个文件的字节数、哈希见 manifest.json；验证完成后应把浏览器/原生实测记录单独保存，不能把生成器通过当作 UI 验收。

## 只读结构检查

运行 `node --experimental-strip-types scripts/fixture-verify.mjs` 可复核文件哈希、Markdown 真实插件管线、标题锚点、脚注、表格、HTML 净化、资源路径及 LF/CRLF 定位。该脚本不渲染 Mermaid，也不代替原生操作验收。
