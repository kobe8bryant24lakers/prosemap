# v0.6.7 validation

## Scope

Existing product views: basic flowchart, 4+1 architecture, layered architecture, sequence, state, class, ER, mind map, Gantt, use case, and package structure.

## Automated checks

- ESLint, TypeScript, the complete Node test suite, production Vite build, and whitespace checks.
- Every existing template with ordinary comments: parse, edit a label, serialize, and reopen without node or edge loss.
- Actual workbench component rendering for every template and common imported class/ER/state/mind map variants: verify canvas, editing toolbar, and editable objects, and absence of the read-only fallback.
- Sequence source preservation: Unicode references, notes, nested branches/loops, parallel/optional/critical blocks, boxes, activation, reference deletion guards, new/deleted messages, and participant order.
- Actual installed Mermaid grammar for nested sequence edits. Browser-dependent box color/sanitizer behavior is not mocked in the Node grammar test.
- Group bounds and nested ownership; caret insertion; fullscreen zoom math; existing graph, AI context, and scroll regressions.

## Browser checks performed

These checks used isolated local browser documents; existing user documents were not overwritten.

- Complex imported sequence with leading comment, Unicode participants, Note, loop, alt/else, and activation: open from document preview, rename participant, edit message, switch between source and canvas, apply, and confirm successful rendering with original control structure.
- Imported Chinese class diagram with direction and separate member statements: edit class name and member, apply, confirm rendered result.
- Imported Chinese ER diagram with direction: edit entity name and primary-key field, apply, confirm rendered result.
- Imported state diagram: rename an isolated state, apply, confirm it remains present with the connected states.
- Plain-text-root mind map: rename root, apply, confirm hierarchy renders.
- Gantt template: edit task name and duration, apply, confirm task/dependency preview renders.
- Use case and nested package templates: canvas and actual Mermaid preview rendering; insertion at a captured middle-of-document caret (earlier checks).
- Fullscreen sequence: wheel zoom from 100% to 136%, drag to pan, reset restores both 100% and the centered position; no diagram scrollbars visible.

## Remaining release checks and limitations

- Not every advanced Mermaid construct is visually editable. Unsupported constructs continue to retain the complete source and use the explicit source-editing fallback; this is not a claim of universal Mermaid grammar coverage.
- Sequence control statements are preserved and inspectable, not directly draggable/editable as control-frame objects. New messages append after existing statements.
- Full browser interaction cycles have not been repeated independently for every architecture template. Component rendering and round-trip coverage include all of them.
- Inline document-wheel scrolling and all three new-diagram entry points still need the remaining UI checks before release.
- Native Rust checks and Windows/universal macOS package builds must pass in the release workflow. Local cargo is currently unavailable.
- Vite reports the existing large-chunk warning; the production build succeeds.
