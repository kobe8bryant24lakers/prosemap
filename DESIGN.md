# ProseMap interface

ProseMap is a desktop writing workspace. The document stays visually prominent;
file navigation, formatting and AI assistance support the current task.
The interface uses neutral surfaces, restrained blue interaction states and
the platform's system fonts. It does not load remote fonts or decorative assets.

## Shared tokens

The implementation source is [app/globals.css](app/globals.css).

| Role | Token | Value |
| --- | --- | --- |
| Primary text / Save action | `--ink` | `#20242c` |
| Body text | `--ink-soft` | `#353c48` |
| Secondary text | `--muted` | `#586170` |
| Captions | `--muted-light` | `#626c7a` |
| Document surface | `--white` | `#ffffff` |
| Panel surface | `--paper` | `#f7f8fa` |
| Grouped controls | `--paper-deep` | `#eef0f4` |
| Dividers | `--line` | `#e2e5eb` |
| Control borders | `--line-strong` | `#c8ced8` |
| Selection, focus, links | `--accent` | `#365f9d` |
| Selected background | `--accent-soft` | `#edf2fa` |

Existing `--green*` variables alias the shared accent for compatibility with
diagram controls. New interface styles should use semantic accent tokens.
Diagram content, syntax highlighting, errors and diff additions/deletions retain
their own meaningful colors.

## Composition

- Keep document identity and save status visible at every window width.
- Group layout modes in one segmented control; keep navigation and disk reload
  separate from that group.
- Group formatting by task. At editor widths of 475px or less, keep undo, redo,
  search and the Format disclosure on the first row. Reveal other commands below
  without moving the selection. When the rail is hidden, keep an AI entry in
  the view bar and diagram insertion available from the editor.
- Bound reading content to 860px, including gutters. Use 15px preview prose,
  14px editor text, 13px interface labels and 12px supporting text. Headings use
  the system sans with a 30px document title, reduced to 26px in narrow panes.
- Focus writing and reading use one centered column (up to 80ch). Leave the file
  name, save state, Save and Exit focus at hand. Entering and leaving focus
  preserves the selection, reading position, side panels and assistant drafts.
- File navigation shares the left panel with the outline. Search includes the
  relative path, reports matching counts and offers an explicit reset.
- AI actions use a compact selector. Put instructions before conversation and
  references; keep model setup and generation in a non-scrolling footer. In
  windows no taller than 700px, use a native action select to preserve input space.
- At 820px and below, place document identity on a second header row and show
  side panels over the workspace. At 560px and below, expose file navigation in
  the view bar and stack the editor and preview vertically in the combined view.

## Diagram workbench

Keep canvas, templates, AI and source in the same named navigation across window sizes. On the canvas, keep creation, connection, search, history and zoom available. The secondary tool row can fold on small screens. Selection updates a separately scrolling properties panel; it must not pan or zoom the diagram. Explicitly locating an object by name or ID may pan, but must preserve zoom, layout and undo history. Use the same panel for nodes, relations, entity fields, message order and task dependencies. Always surface validation errors next to the Apply action, including in compact layouts.

## Interaction

Use Lucide icons consistently. Icon-only controls need accessible names and
tooltips. Keep visible focus indicators, selected/expanded semantics and normal
keyboard navigation. DOM order should follow visual order.

Save reports pending, saved and unsaved states; asynchronous completion must not
clear newer edits. Show partial suggestions as a draft; compare only completed
proposals. Start with changed passages, label old and proposed text, and link
line numbers to the full comparison. Keep the decision buttons visible while
scrolling, and disable replacement when the texts match. Command/Control +
Enter submits an instruction; plain Enter inserts a newline and IME confirmation
never submits.

Use short color transitions for hover/press feedback. Respect reduced motion.
Do not animate document layout or add entrance choreography to working panels.

## Verification

Check Chinese and English, wide and compact desktop windows, narrow combined
views, keyboard focus, long document/file names, empty search results and pending
or failed operations. Browser tests substitute native IPC and do not establish
installed desktop acceptance. Keep local screenshots and raw validation output
under the ignored `outputs/` directory.
