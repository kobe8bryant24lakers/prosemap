# ProseMap

**English** | [简体中文](README.zh-CN.md)

### Write the thought. See the whole picture.

**A local-first Markdown and Mermaid desktop workspace.** Write solo or with a coauthor, turn ideas into editable diagrams, and review AI suggestions before applying them.

[Explore the product page](https://kobe8bryant24lakers.github.io/prosemap/) · [Download v0.17.0](https://github.com/kobe8bryant24lakers/prosemap/releases/tag/v0.17.0) · [User guide](docs/guide.md)

## Write together in Markdown

Choose **Share this document** to create a copy on a LAN host or remote server. Send an edit or read-only invitation. Your coauthor opens **Join** in ProseMap and pastes the link.

Edit the same paragraph, follow each other’s cursors and see the preview update as you write. Reconnecting merges pending edits from the open window. Your original file and attachments stay on your device. [Set up a shared writing session](docs/guide.md#shared-editing-sessions).

![Two editors online with a live selection and preview in a fictional release plan](website/assets/screenshots/shared-writing-en.webp)

## One document. More ways to think.

| When you want to… | ProseMap helps you… |
| --- | --- |
| Get an idea onto the page | Write with live preview, an outline, formatting shortcuts, syntax highlighting, and code-block formatting. Switch to focused writing or reading when you need room to think. |
| Explain how something works | Build a Mermaid diagram from a template, source, or an AI draft. Move nodes, connect ideas, search objects, and edit their properties on the canvas. |
| Understand a long document | Ask about the whole document or a selected passage, summarize it, and keep asking follow-up questions in **Document Q&A**. |
| Improve a draft without losing control | Compare original and suggested passages in **Changes**, inspect the full comparison, then accept the entire suggestion, reject it, or continue the conversation. |
| Give AI useful project context | Explicitly select up to 12 reference or source files from a local folder. Use the same selected context for writing and diagram assistance. |
| Keep your existing file workflow | Open Markdown files and folders, paste images into a sibling `images/` folder, and open relative attachments in their default apps. |

![ProseMap v0.16.0: Markdown source and live preview of a synthetic release plan](website/assets/screenshots/workspace-en.webp)

## Give the idea a shape

Write an architecture note and draw its relationships in the same place. The Mermaid workbench keeps **Canvas**, **Templates**, **AI assist**, and **Source** together. Flowcharts, sequence diagrams, state diagrams, class diagrams, ER models, mind maps, and Gantt plans have visual editing support.

![The Mermaid workbench with a selected decision node and its properties](website/assets/screenshots/canvas-en.webp)

The diagram stays Mermaid source inside your Markdown. Manual canvas positions belong to the current editing session; rendered previews use automatic layout. See [canvas controls and limits](docs/guide.md#canvas-controls).

**Try it:** download the [small release-plan example](website/assets/launch-plan.md), or explore the [traveling exhibition handbook](examples/traveling-exhibition.zh-CN.md) with eleven editable diagrams. Both are fictional projects made for learning and demonstration.

## Read it. Then ask it.

Open **AI assistant → Document Q&A** to summarize, clarify a passage, or ask what to do next. Follow-ups use the current document and the ongoing conversation. Answers stay in the document session; choose **Edit document** when you want a proposed change.

![Document Q&A beside the example plan, with a synthetic answer and a follow-up field](website/assets/screenshots/questions-en.webp)

## Make every change a choice

Ask for clearer wording, a continuation, a summary, or a custom edit. Read the draft as it streams, then compare the finished suggestion with the original. Accepting applies the complete suggestion; you can reject it or refine it through conversation first.

![Changes view showing original passages and synthetic AI suggestions before acceptance](website/assets/screenshots/review-en.webp)

The shared writing image shows two real v0.17.0 sessions editing a synthetic document. The other screenshots show the v0.16.0 production frontend with synthetic documents and model replies. Native file operations are simulated for capture; these images do not establish installed desktop acceptance.

## Start with a file you already have

1. **Install a desktop preview** from the table below, or build from source.
2. **Open a Markdown file or folder.** Try split view, focus mode, and a Mermaid diagram. Local editing and rendering work without an AI connection.
3. **Connect a model when you want help.** In Settings, add an OpenAI-compatible Chat Completions or Anthropic Messages connection. Save multiple profiles and switch while you work.

| Platform | v0.17.0 availability |
| --- | --- |
| Windows 10/11 x64 | [EXE installer](https://github.com/kobe8bryant24lakers/prosemap/releases/download/v0.17.0/ProseMap-Windows-x64-v0.17.0-setup.exe) · [MSI installer](https://github.com/kobe8bryant24lakers/prosemap/releases/download/v0.17.0/ProseMap-Windows-x64-v0.17.0.msi). Unsigned preview packages. |
| Linux x64 | [AppImage](https://github.com/kobe8bryant24lakers/prosemap/releases/download/v0.17.0/ProseMap-Linux-x64-v0.17.0.AppImage) · [DEB package](https://github.com/kobe8bryant24lakers/prosemap/releases/download/v0.17.0/ProseMap-Linux-x64-v0.17.0.deb). Native Linux runtime acceptance is pending. |
| macOS · Apple Silicon and Intel | [Download the universal preview DMG](https://github.com/kobe8bryant24lakers/prosemap/releases/download/v0.17.0/ProseMap-macOS-Preview-universal-v0.17.0.dmg). **ProseMap Preview** uses an ad-hoc signature without Apple notarization. Model credentials last until you quit. [Installation guide](docs/guide.md#macos). |

The app starts in English; **EN / 中文** switches to Simplified Chinese immediately without changing your document. Checksums are attached to the [release](https://github.com/kobe8bryant24lakers/prosemap/releases/tag/v0.17.0). Mobile apps are not implemented.

## Your files. Your model. Your decision.

- **Ordinary local files.** Markdown and relative image references remain portable. Local editing, preview, and Mermaid rendering work offline.
- **AI is optional.** When invoked, your chosen document scope, instructions, selected references, and relevant conversation go to your configured model provider. Selecting a folder does not send the whole repository.
- **Credentials use the OS store.** Production builds use macOS Keychain, Windows Credential Manager, or Linux Secret Service. Development builds use session-only credentials.
- **Context is explicit.** Reference selection is bounded and shown in the UI. Filters do not detect secrets embedded in source code; review files before sending them.

Model usage, including conversation compression, may incur provider charges. See the [AI and project-context guide](docs/guide.md#project-context-and-conversations) and [security model](docs/guide.md#security-model) for limits and endpoint behavior.

## Current release

**[v0.17.0](docs/releases/v0.17.0.md)** adds shared Markdown editing with live cursors, separate edit and read-only invitations, and reconnection to a persistent LAN or remote server. Sharing creates a separate copy after you confirm.

This is a **desktop preview**. Two macOS development clients exchanged and saved edits in synthetic documents. Installed Windows and Linux collaboration, physical cross-network use, and live-model quality remain unverified. The [release notes](docs/releases/v0.17.0.md), [native acceptance matrix](docs/v0.11.0-deep-acceptance.md), and [coverage audit](docs/v0.11.0-acceptance-audit.md) retain partial, tool-limited, and unsupported cases.

## Develop locally

Requires Node.js **22.13+**, Rust stable, and your platform's native build dependencies.

```bash
npm ci
npm run desktop:dev
```

The development app keeps model settings in memory for the session. ProseMap embeds React, CodeMirror, and Mermaid in a Tauri 2 shell; the public product page is a separate static introduction.

[Development prerequisites](docs/guide.md#local-development) · [Build instructions](docs/guide.md#build) · [Validation commands](docs/guide.md#validation) · [GitHub Pages maintenance](docs/github-pages.md)

## License

[MIT](LICENSE). Make something clear.
