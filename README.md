# ProseMap

> Write in flow. See the structure.

ProseMap is a local-first AI Markdown and Mermaid editor for macOS and Windows. It combines focused writing, live visual preview, native file and folder workflows, and reviewable AI-assisted edits in a single desktop application.

The application interface is currently localized in Simplified Chinese. The repository documentation and project metadata are maintained in English.

## Highlights

- Open individual Markdown files or browse every Markdown document in a local folder.
- Edit Markdown with a responsive desktop-first workspace and live preview.
- Render Mermaid diagrams locally in strict security mode.
- Create or revise Mermaid flowcharts, sequence diagrams, state diagrams, class diagrams, ER diagrams, Gantt charts, and mind maps with natural-language instructions.
- Use AI on the full document or a selection for polishing, continuation, summarization, and custom transformations.
- Review streamed AI output as a line-by-line diff before accepting or rejecting it.
- Connect to OpenAI-compatible Chat Completions endpoints or Anthropic Claude Messages endpoints.
- Save safely back to the original file or export with Save As.

## Desktop support

| Platform | Status |
| --- | --- |
| macOS 11+ on Apple silicon | Built and locally verified |
| Windows 10/11 | Tauri, NSIS, MSI, file association, and WebView2 configuration included; native Windows build verification is still required |
| macOS on Intel | Source-compatible; a dedicated x86_64 or universal build is still required |
| iOS and Android | Tauri library entry point reserved for future work; not implemented or verified |

## Local development

### Prerequisites

- Node.js 22.13 or newer
- Rust stable
- macOS: Xcode Command Line Tools
- Windows: Rust MSVC toolchain, Visual Studio C++ Build Tools, Windows SDK, and WebView2

Install dependencies and start the desktop application:

```bash
npm ci
npm run desktop:dev
```

The Vite development server only binds to `127.0.0.1`. It is an implementation detail of the local Tauri development workflow, not a hosted web product.

## Build

### macOS

```bash
npm run desktop:build -- --bundles app,dmg
```

Production distribution requires Apple Developer signing and notarization.

### Windows

```powershell
npm ci
npm run desktop:build:windows
```

Production distribution requires a Windows code-signing certificate. Windows installers should be built and tested on a real Windows machine or Windows CI runner.

## Validation

```bash
npm run lint
npm run typecheck
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
```

## Architecture

ProseMap embeds a React interface compiled by Vite inside a Tauri 2 desktop shell. No hosted site, web API route, or remote application UI is required.

The Rust layer exposes a deliberately small native surface:

- User-authorized Markdown file and folder access
- Original-path saving and Save As
- Operating-system file association launch targets
- HTTPS model requests and streaming cancellation

Platform-specific configuration lives in:

- `src-tauri/tauri.macos.conf.json`
- `src-tauri/tauri.windows.conf.json`

## AI providers

ProseMap supports:

- OpenAI-compatible Chat Completions endpoints
- Anthropic Claude Messages endpoints

Provider settings and API keys live only in the current application process. They are cleared when the application exits and are never written to source files, local storage, cookies, or application logs.

AI features require network access to the provider selected by the user. Local editing, file management, Markdown preview, and Mermaid rendering do not require an online application service.

## Security model

- API endpoints must use standard HTTPS on a public domain.
- Credentials in URLs, query strings, fragments, redirects, private IP addresses, and local network destinations are rejected.
- Validated DNS results are pinned to the outgoing model request.
- Upstream errors are size-limited and API keys are redacted.
- File access is limited to paths explicitly selected by the user or delivered through an operating-system file association.
- Workspace traversal skips symlinks and applies file count, depth, extension, and size limits.
- Saves use a synchronized temporary sibling followed by atomic replacement, protecting the original document from partial writes.
- Markdown preview does not execute raw HTML.
- Mermaid output is rendered in strict mode and sanitized before insertion into the page.
- AI edits are applied only after explicit acceptance in the diff view.

## License

ProseMap is available under the [MIT License](LICENSE).
