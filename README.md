# 墨流 Markdown Studio

墨流是一款桌面优先的中文 Markdown 智能编辑器，支持实时预览、Mermaid 可视化、OpenAI-compatible 与 Anthropic Claude 流式调用，以及所有 AI 修改的差异确认。

私有在线版本：<https://moliu-markdown-studio.ko8e24lakers.chatgpt.site>

## 本地运行

要求 Node.js 22.13 或更高版本。

```bash
npm ci
npm run dev
```

打开终端显示的本地地址即可使用。模型密钥仅保存在当前页面内存中，刷新页面后清除。

## Windows 桌面端

桌面端当前是 Windows-first 的联网 Tauri 2 安全壳：它只加载已发布的墨流 HTTPS 地址，不授予远程页面任何原生系统权限。安装包不包含离线编辑资源，启动与 AI 功能都需要网络。请在 Windows 10/11 构建机安装 Rust MSVC 工具链、Visual Studio C++ Build Tools、Windows SDK 与 WebView2，然后运行：

```powershell
npm ci
npm run desktop:dev
npm run desktop:build -- --bundles nsis
```

MSI 构建可使用 `npm run desktop:build -- --bundles msi`。生产分发前应在 Windows 构建机完成代码签名，并提交首次成功构建生成的 `src-tauri/Cargo.lock`。当前 Rust 入口兼容移动初始化，但尚未生成或验证 iOS/Android 工程；后续可增加 macOS、iOS 与 Android 平台配置。

## 安全说明

- 密钥不写入源码、localStorage、IndexedDB、Cookie 或服务端日志。
- 浏览器通过同源接口将密钥放在一次性请求头中转发给模型服务。
- 自定义 OpenAI-compatible 地址必须使用公开 HTTPS 域名；本地地址、IP 地址、凭据、非标准端口和重定向会被拒绝。
- 导入的 Markdown 不执行原始 HTML；Mermaid 使用严格安全模式并在渲染前清洗 SVG。
- AI 建议必须先经过差异预览，只有用户明确接受后才会写入文档。
