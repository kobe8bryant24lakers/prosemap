# Queued editor and preview improvements

Local validation on macOS, 2026-11-16. Baseline: merged document outline commit `067ebb2`. This implementation validation did not change the signing configuration or installed application and is not a release acceptance report. The subsequent authorized v0.12.1 release is documented in [release notes](releases/v0.12.1.md).

## Behavior

- Markdown toolbar: Increase indent / Decrease indent reuse CodeMirror's commands and the existing two-space indent unit. The retained selection and editor focus survive the click. Each button press is isolated in history, including rapid successive presses. A caret-only selection affects the current line; a selection ending at the start of the next line excludes that next line, following CodeMirror.
- Sequence canvas: a dragged message uses the horizontal preview arrow's timeline coordinate at the drag origin. Its position is compared with the actual displayed message rows, including compressed layouts and self messages. Source insertion occurs immediately before the following message, inside that message's existing control block. The final slot appends after closed blocks. Existing click-to-connect actions retain their append behavior.
- Sequence source preservation: a single inserted message inherits the following message's indentation, while existing message text, directives, comments, whitespace and line endings remain unchanged. Reordered/deleted message slots are reconciled before insertion. Undo restores the original source.
- Mermaid previews: inline and fullscreen canvases support unmodified wheel zoom and primary-button dragging. Inline zoom keeps a stable viewport and pans its SVG to reveal clipped regions. Zoom anchors at the mouse position; existing zoom/reset buttons remain available. Dragging uses a threshold and suppresses accidental clicks, while ordinary double-click editing remains available. Body scrolling outside the diagram remains normal.

The canvas currently displays message rows rather than individual control/directive rows. It cannot distinguish every possible placement on either side of a directive between two message rows, or target an empty control block. Use source editing for those exact placements. Unsupported Mermaid syntax retains the existing source-only behavior.

## Reproduction and regression evidence

Before implementation, Chromium reproduced all three issues with the new focused interaction tests: missing indentation control, inserted message appearing at the end, and no wheel scaling in the inline preview. Subsequent tests exposed rapid toolbar actions coalescing into one undo entry; history isolation fixes that behavior.

New regression files:

- [Editor and sequence interactions](../tests/e2e/queued-editor-polish.spec.ts): single/multiple/reverse selections, line-boundary selections, outdent without content loss, focus and undo/redo; message insertion between existing rows, at block entry/interior/exit, exact source preservation, canvas history, document history and rendered preview; preview wheel/pan and outside-body scrolling.
- [Preview boundaries and whitespace](../tests/e2e/queued-preview-boundaries.spec.ts): actual clipped-node hit testing after pan, zoom-out/reset, double-click editing, mixed indentation, caret-only indentation and keyboard toolbar activation.
- [Sequence logic](../tests/sequence-insertion.test.mjs): 17 cases covering nested blocks/branches, LF/CRLF, beginning/middle/end insertion, compressed rows, insertion after reorder/delete, duplicate/self messages, an empty timeline, no final newline and source history.

Final results: **594 logic tests passed; 132 browser tests passed (66 Chromium and 66 WebKit); no skipped tests in these runs.** Typecheck, lint and production frontend build passed. The build emitted a bundle-size advisory for chunks above 500 kB.

```sh
npm run test:mermaid
npm run typecheck
npm run lint
npm run build
npm run test:e2e -- tests/e2e/queued-editor-polish.spec.ts tests/e2e/canvas-sequence-lifeline.spec.ts tests/e2e/canvas-sequence-source-reorder.spec.ts tests/e2e/markdown-shortcuts.spec.ts tests/e2e/fullscreen-overview.spec.ts tests/e2e/fullscreen-dismiss-focus.spec.ts tests/e2e/preview-stale-entry.spec.ts
npm run test:e2e -- tests/e2e/queued-preview-boundaries.spec.ts tests/e2e/preview-and-boundaries.spec.ts tests/e2e/fullscreen-readable-zoom.spec.ts tests/e2e/sequence-marker-shape.spec.ts
```

The first browser group passed 84/84; the second passed 48/48. The entire repository browser suite was not run. Remote branch and open-PR checks found no duplicate active implementation; the original checkout was left unchanged. The isolated local branch is `codex/kobe-editor-preview-polish`.

## Scope of evidence

Playwright runs real CodeMirror, Mermaid rendering, pointer/wheel input, selection and history in local Chromium and WebKit. Only desktop IPC is mocked using identifiable synthetic documents. These checks do not establish installed native WebView behavior or physical mouse/trackpad behavior. No installed App was replaced, no real Keychain was accessed, and no native historical acceptance was repeated.

The implementation was initially completed locally; publication was subsequently authorized. Signing configuration remains unchanged. Raw logs, reports, screenshots, caches and built assets remain excluded from commits.
