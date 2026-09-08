# v0.6.7 installed desktop end-to-end validation

Status: release and clean application installation completed; installed-app UI validation in progress. Browser and unit-test results do not count as installed-app passes.

## Current assessment

- All 11 existing templates have editable canvases, source round trips and object add/undo/redo coverage. Detailed per-type operations and persistence are recorded below; this does not establish every possible control combination or all Mermaid grammars.
- Confirmed failures: native Quit bypasses dirty-document confirmation; narrow editor toolbar overlap with AI panel. Keyboard interaction issue: immediate Command-Z after deleting a canvas node does not restore it until canvas focus is re-established by clicking blank canvas.
- Earlier coordinate failures recovered after raising the app window; do not treat them as a continuing blanket blocker. Earlier Gantt ID duplication was not reproduced with exact paste after recovery; do not label it a proven serializer bug.
- Pending prerequisites: Windows runtime and alternate-provider live tests have no available environment/credentials. Fine-grained remaining per-view gesture combinations and negative AI service responses are not marked passed. User explicitly authorized the attachment-bearing live AI request on September 7; its result is recorded below when observed.
- Published application is still v0.6.7. The user subsequently authorized fixes for the three confirmed defects. Local repair-candidate testing is recorded separately below; it is not a claim that the published/installed release has been updated.

## Local repair candidate regression (2026-09-08)

- Target: `src-tauri/target/debug/bundle/macos/ProseMap.app`, local debug candidate with version still 0.6.7. `/Applications/ProseMap.app` remains the published build. No credentials were configured in the candidate.
- First runtime-exit-only fix failed native Quit regression. Inspection showed Cocoa's predefined Quit directly invokes `terminate:`. Replaced only that default menu item with a regular menu event and standard Command-Q accelerator, requesting the existing guarded window close.
- Computer Use confirmed the new menu's Quit uses `fireMenuItemAction:`. With `UNSAVED_QUIT_GUARD` visibly pending, native Quit displayed the unsaved-document confirmation. Continue Editing preserved both marker and Unsaved state. Command-Q showed the same confirmation; a repeated Command-Q did not bypass it. Explicit Discard and Close exited, and relaunch returned to the welcome document.
- With an unchanged welcome document but a newly added canvas node (8→9), Command-Q displayed the distinct unapplied-diagram-draft warning. Continue Editing retained the new node and draft.
- Canvas keyboard deletion: on `A[Alpha] --> B[Beta]`, selected Beta and pressed Backspace, observing 1 node/0 edges and focus on the canvas container. Immediate Command-Z, with no intervening click, restored 2 nodes/1 edge. Immediate Command-Shift-Z removed them again; Command-Z restored them. Clicking the inspector Delete button followed immediately by Command-Z also restored the node and edge.
- AI sidebar layout: at the same approximately 1229-pixel window width that reproduced overlap in the installed release, candidate screenshot showed format buttons and AI actions on separate non-overlapping rows, with all nine format actions exposed. Other narrow breakpoints remain to check.
- Automated regression after the menu change: complete Mermaid/JavaScript suite, typecheck and lint succeeded; Rust unit tests passed 23/23. The three new tests are structural guards, not substitutes for the native UI observations above. Candidate debug app packaging succeeded.
- Additional narrow-window screenshots at approximately 922 and 792 output pixels retained the format actions without overlap; clicked Insert Table and used Command-Z. The AI panel overlays the preview at these existing responsive breakpoints, so this is not a claim that every pane stays simultaneously visible.
- Production build (`src-tauri/target/release/bundle/macos/ProseMap.app`) succeeded and was launched separately, with its running binary path confirmed. Build emitted an environment warning about missing libLLVM for symbol stripping, but produced a runnable optimized bundle. In that bundle, dirty-document Command-Q confirmation and cancellation preserved the test diagram. Backspace then immediate Command-Z restored 2 nodes and 1 edge. With both document and diagram draft pending, Quit displayed the combined warning; explicit Discard and Close was used on this synthetic test.
- Pending: clean Quit needs process-level confirmation; eventual published-install retesting remains. Dock/system termination is not covered by the native menu/Command-Q result. The repair release is being prepared as v0.6.8; it has not yet been published or installed.

## Observed results (2026-09-06)

- Release run 34008457869 attempt 2 succeeded on Windows and universal macOS; all five assets are uploaded.
- Downloaded published DMG and SHA256SUMS-macOS.txt to `/private/tmp/prosemap-release-0.6.7.Zq5mBw`. `shasum -a 256 -c` passed; DMG SHA-256 is `3b5a315d02ed797c84a61e5a4afa1d9cda9ae96e082586f79ba24db458b4fae1`.
- Quit v0.4.1 through computer use; it exited without a save prompt. Removed only `/Applications/ProseMap.app` after checking its version and non-symlink status; no backup retained, no document/configuration data removed.
- Installed the complete app from the verified read-only mounted DMG; installed bundle version is 0.6.7, binary includes x86_64 and arm64. Ejected the DMG and launched the installed app through computer use. The new fullscreen control is present and enabled after rendering.
- Created dedicated synthetic fixtures under `/private/tmp/prosemap-release-0.6.7.Zq5mBw/e2e`. Opened `workflow.md` through the app's native file picker. The filename, heading, text, table, JSON code fence and end marker appeared in the editor/preview.
- In the installed editor, moved to document end, inserted a table with the toolbar, observed the unsaved indicator, clicked Save, and observed local-save confirmation. Persisted file verification is recorded separately from UI actions.
- Model configuration prerequisite: the previous app displayed a configured model, but v0.6.7 currently shows Connect Model and empty model settings. No credential was revealed, removed, or replaced. Asked the user to configure a test provider in-app before live AI validation; settings dialog left open for that purpose. Cause has not yet been diagnosed.

## Additional installed-app results (resumed September 6)

- Computer use is available again. The app now displays the configured `x-ai/grok-4.6` model; the earlier missing-configuration prerequisite is no longer current. No configuration was changed during this resumed run.
- Class diagram: selected User, changed the first member to `+String desktopId`, used Rename and the visibly rendered inline input to rename the displayed class to `d`, confirmed `class User["d"]` and the changed member in the source tab and rendered preview. Applied to the document and saved through the native Save As dialog as `canvas-installed-e2e.md` in the test directory.
- All 11 templates were opened in the installed app, including sequence. Every template exposed editable canvas objects; source-to-canvas return worked without a read-only fallback. Class source editing was covered by the explicit edit cycle above.
- All 11 templates passed add-object, Undo, Redo, Undo UI cycles. Verified object counts for sequence 3→4→3→4; state 5→6→5→6; ER 2→3→2→3; mind map 10→11→10→11; class 2→3→2→3; Gantt 4→5→4→5; use case 7→8→7→8; package 6→7→6→7. Flowchart and both architecture templates also restored their original object counts after Undo and added one after Redo (ignore the duplicated focused-element line in native AX output when counting).
- Canceling the final scratch diagram showed a discard confirmation. Chose Discard Draft for this disposable test draft and returned to the saved test document.
- Live AI generation has NOT run: security review rejected the attempted request pending explicit payload/recipient authorization. Read only the visible endpoint/model, without revealing the key: OpenRouter `https://openrouter.ai/api/v1`, `x-ai/grok-4.6`. Asked permission to send the synthetic `canvas-installed-e2e` document (821 characters) for live generation/cancellation/diff tests. No test is marked passed for this blocked action.
- Remaining: drag/resize/connection details, diagram-specific controls, save/reopen for every view, further file/editor/fullscreen workflows, and authorized live AI cases. This is not a completed full-function pass.

## Navigation and authorized AI results

- Installed-app fullscreen class preview: observed initial centered 100% view, wheel zoom to 136%, drag pan, and percentage reset restoring both centered position and 100%. Escape returned to the document. No internal diagram scrollbars were visible.
- Scrolling over the inline class diagram moved the document and synchronized the editor while diagram zoom stayed at 100%.
- Observed layout issue: with AI sidebar expanded at the current approximately 1229-pixel-wide window, editor toolbar labels overlap. This is a visual defect, not a full responsive-layout pass; further reproduction/fix is pending.
- User explicitly authorized live AI tests after the earlier safety rejection, then confirmed comprehensive validation. Authorization is for synthetic test content using the configured OpenRouter service, not real user documents.
- First real custom AI request returned an added `AI桌面验证成功。` line in the diff. Verified the editor did not contain the new line before acceptance. Clicking Reject produced `已拒绝建议，原文保持不变`.
- Second synthetic append request: clicked Accept and Replace, verified the marker entered the editor and the unsaved indicator appeared, clicked Save and observed local-save confirmation. A read-only persisted-file check confirmed both the marker and existing class/member content remain.
- Third synthetic request: clicked Stop Generation during the request; observed `生成已停止，文档没有被修改。`. No real user content was sent in these three tests.
- Reopened `canvas-installed-e2e.md` with the native Open dialog after discarding the stopped suggestion. The UI confirmed the file opened; the editor retained `AI桌面验证成功。`, `class User["d"]`, and `+String desktopId`, and the class preview rendered.

## File protection, formatting, and node manipulation

- Native Open Folder loaded the dedicated e2e directory and listed its three Markdown files. Switching to second.md worked. Appended one disposable `x`, tried to switch to workflow.md, and observed the unsaved-change confirmation. Continue Editing preserved second.md and the unsaved `x`; Discard and Open switched to workflow.md. Only the disposable test edit was discarded.
- Toolbar checks: heading, bold, italic, link, inline code, list, quote, and fenced code block each inserted their expected sample content in the installed editor; Command-Z removed each operation. Native AX text decorates rich text with additional formatting markers; those decorations are not treated as literal file contents.
- Reopened the saved class diagram from preview. Dragged class d from the center toward the left; screenshots confirmed the node moved and its relationship curved to follow it.
- Deleted class d: canvas reported one remaining class and zero relationships. Undo restored both class objects. Auto Arrange was invoked afterward; detailed layout comparison and persistence of manual positions remain unverified.
- Earlier format-test attempt was blocked by a usage limit before this resumed successful run. No passes were inferred from the blocked attempt.

## Relationship and diagram-specific edit results

- Class relationship mode: clicked Order then d and verified the source gained `Order --> User`. Discarded this disposable draft without modifying the saved class diagram.
- Gantt: changed the selected requirements task duration to `4d` and toggled Critical. Verified source `需求确认 :done, crit, req, 2026-01-01, 4d` and retained `方案设计 :design, after req, 5d`. Applied into the synthetic document and saved successfully.
- Gantt input caveat: native automated setValue initially produced `1d4d`; ordinary keyboard Select All → `4` → `d` correctly yielded `4d`. Do not classify this as an application defect without further reproduction; the malformed automated input was corrected before applying.
- ER: changed first USER field to `string desktop_id PK`, added a field (`string new_field`), verified `USER ||--o{ ORDER : creates` remained in source and the actual preview rendered all fields. Applied into the synthetic document and saved successfully.
- Permission checks temporarily timed out/encountered usage limits during this work; blocked attempts were not counted as completed tests.

## Hierarchy and isolated-state results

- Mind map: selected the root and clicked Child Topic. Source contained `Mind11["新主题"]` directly below the root at the child indentation, while all original branches remained. Actual preview included the new topic; applied and saved the test document.
- State: added an unconnected ordinary state. Source included `state "新状态" as State6`; applied and saved, then reopened the current diagram from the editor toolbar. Canvas still showed the isolated state alongside the original states and start/end objects.
- Package: changed App group title to `桌面测试应用`, dissolved Presentation using its explicit preserve-contents action. Group count changed 4→3 while all six nodes remained; source placed Pages and Controllers directly in App, preserving Domain and Infrastructure nesting. Preview rendered nodes/dependencies; applied and saved the synthetic document.

## Use case and sequence application results

- Use case: added an actor and a use case using dedicated buttons. Source retained the system boundary and include/extend edges, and actual preview displayed the new objects. Applied and saved the synthetic document.
- Sequence: selected the first message, changed its text to `桌面消息验证`, and moved it later. Source order became App→API, User→App (edited message), API→App, App→User. Applied and saved.

## Additional AI modes

- On the synthetic 30-character second.md fixture, Polish, Continue, and Summarize each returned reviewable suggestions. Continue added one paragraph; Summarize changed one sentence. Rejected each suggestion without modifying the original.
- Main AI diagram generation returned a valid flowchart with start, input check, success/failure edges, and finish. Accepted, saved, and opened the generated fence in the installed canvas; all three nodes were editable.
- Workbench AI direction-change request succeeded: source became `flowchart LR` and retained both success/failure edges. Applied and saved.

## Context and invalid-source checks

- Added the synthetic workflow.md through the native context-file picker; UI showed its filename and 258 characters. Removed it and confirmed the attachment removal control disappeared.
- Attachment-bearing AI request was blocked by review requiring payload-specific authorization. Asked explicitly about sending synthetic second.md (158 characters) plus workflow.md (258 characters) to the configured OpenRouter endpoint/model. Do not count the blocked request as passed or resend until resolved.
- Entered invalid `flowchart TD` / `A[` in a disposable new draft. Preview showed a parse error; Apply produced a parse error in the workbench and did not leave the workbench or insert into the document.
- Entered a valid pie fixture, which is outside the 11 existing canvas templates. Canvas correctly disclosed its read-only fallback and source-preservation limitation. This confirms unsupported grammar handling, not universal support for all Mermaid diagram types.

## Native quit defect and restart

- With second.md open, appended disposable `x q` and observed the Unsaved indicator. Selected native ProseMap → Quit ProseMap. App exited without any observed save confirmation. Relaunch opened the welcome document, not the dirty document. The persisted second.md did not contain the disposable edit. Treat native Quit losing unsaved changes as a failed data-protection case; only synthetic edits were lost.
- Configured model `x-ai/grok-4.6` remained present after restarting the installed v0.6.7 app. No credential was revealed or changed.

## Continued native UI checks

- Window Close differs from native Quit: with disposable unsaved text, Close displayed the confirmation. Continue Editing preserved the edit; Discard and Close closed the window. Relaunch succeeded. The data-loss defect above is specifically the native Quit path.
- Settings: entered an invalid endpoint (`not-a-url`), observed Save disabled, canceled, reopened settings and verified the original OpenRouter endpoint/model remained. Credentials stayed masked and unchanged.
- Complex sequence fixture: Chinese identifiers, comment, `box`, `Note over`, nested `loop`/`alt`/`else`, and activation/deactivation were preserved after participant display rename to `D`. Actual preview rendered the preserved control structures. Applied and saved through native Save As to `complex-sequence-e2e.md`; reopening its preview canvas retained D and both participants.
- Copy Source was exercised by pasting the copied sequence back into the disposable source editor; the sequence and control structures remained intact and rendered. A life-line bottom drag was attempted, but dimension persistence is not established and is not counted as passed.
- Canvas controls: hand-drawn selected and standard deselected; snapping toggled off; zoom increased from 84% to 94%, reset showed 100%, Fit invoked. Sequence Self Message added `用户->>用户: 新消息`, preserving the surrounding complex source and rendering in preview.
- Restore Opened Content removed the disposable self-message and returned the original 16-line complex sequence with D and all control structures intact.
- 4+1 architecture: changed direction to LR and Logical node to data shape; duplicated the selected node (six objects), deleted the copy (five objects), verified `Logical[("逻辑视图：领域模型与核心抽象")]` and original relationships in source. Applied, saved, and reopened through Edit Current Diagram; all five architecture views remained editable.
- Layered architecture: changed direction to right, applied, saved, and reopened through Edit Current Diagram; client, gateway, service, database and external service were present as editable objects.
- Both architecture cases were added to the synthetic `complex-sequence-e2e.md`, not user documents. The subsequent native Open operation for `canvas-installed-e2e.md` is unfinished: computer use reported that the Mac is locked and automatic unlock failed. Resume after manual unlock, inspect the current Open dialog before acting, then finish remaining checks. This is a prerequisite blocker, not a completed full-function validation.

## Resumed installed UI validation (September 7)

- Desktop access resumed on the user's Continue request. No password prompt was observed. The stale native Open sheet initially produced `failedToGetWindowIDForElement`; Escape closed it, and a fresh Open → Go to Folder/path → Return successfully loaded `canvas-installed-e2e.md`. Do not attribute the earlier lock failure to ProseMap reinstallation.
- After reloading from disk, reopened sequence, use case, package, state, mind map, ER, Gantt and class from their individual preview Edit buttons. All exposed editable canvas objects. Sequence retained `桌面消息验证` and the changed message order; use case retained new actor/use case; state retained isolated new state; mind map retained its new topic; class retained d.
- Created `insertion-e2e.md` with Save As, then replaced only this disposable copy with three text markers. Sidebar canvas entrance inserted at document start; preview New Diagram inserted at end; editor toolbar New Diagram inserted between middle paragraph and end marker. All three original markers remained, all three diagrams were visible in editor content, and Save completed.
- Mermaid safety rejection checks in a disposable draft: `click A "https://example.com"` → unsupported clickable-link instruction; init directive → unsupported Mermaid initialization; `<b>HTML</b>` label → unsupported HTML tags. Each Apply stayed in the workbench with explicit error feedback; none was applied to the document. No external link was opened.
- Editor selection: selected exactly `target` between BEFORE/AFTER. Bold changed only the selected word; Command-Z reverted it and Command-Shift-Z restored it. Screenshot confirmed normal Markdown preview displays `<b>RAW_HTML_MARKER</b>` as literal text, not an interpreted tag.
- Authorized live AI selection test: assistant reported 6 selected characters. Custom request returned target → SELECTED_OK in the review dialog. Accept changed only the selection, preserving BEFORE/AFTER, bold delimiters, heading, and raw-HTML text. Saved as separate `selection-e2e.md`, leaving the on-disk insertion fixture intact.
- Finder integration: selected selection-e2e.md and used File → Open. Finder lists ProseMap (default) (0.6.7); the app subsequently displayed `已打开 selection-e2e.md`. No password dialog appeared. Finder also lists older ProseMap versions; no conclusion about caches versus other build copies, and no deletion performed.
- Window resize attempt did not execute: Computer Use returned `windowNotFoundAtPosition`. Screenshot at the current size is available, but resizing remains unverified rather than passed.
- Gantt detailed controls: selected core development, changed section to 桌面开发, toggled Active and added a subsequent task. Existing milestone and new task followed the changed task reference, and preview rendered.
- **Gantt ID discrepancy (needs reproduction outside the input automation path):** native setValue produced an appended ref; then ordinary Select All → x resulted in source xx. Repeated with fresh verified selection xx, pressed y, observed input Value y, pressed Tab (input still y), switched to Source and observed yy with both downstream refs after yy. Not a pass: distinguish delayed input/composition from an application serialization defect before assigning cause. Applied to a separate synthetic `gantt-id-e2e.md` for evidence; no original/user document changed.
- State-specific: Next State from 草稿 created State6 and its transition; added start and end connections after selecting the ordinary state. Source retained original transitions and added 草稿→State6, [*]→State6, State6→[*]; rendered, applied, saved.
- Corner syntax: `classDiagram` with standalone Chinese class members exposed two editable member fields and retained its comment/source on round trip. Plain text mind-map root plus two children exposed editable objects; Add Sibling produced a third same-depth child. Applied and saved the mind map.
- ER-specific: deleted ORDER amount field, created a linked entity; source retained PK/FK fields and added ORDER→ENTITY3 with one-to-many relation. Applied and saved.
- Coordinate recovery: resetting the CUA session alone did not resolve windowNotFoundAtPosition. On a later continued turn, used the native window's exposed Raise action; coordinate dragging then worked. Moved ER USER left and observed its curved relationship follow. Changed target cardinality to one-or-many, reversed relationship, confirmed `ORDER }|--|| USER : creates`, rendered and saved.
- Native Zoom Window changed the visible window size (approximately 1229 to 1538 screenshot pixels wide), with both editor and preview readable. This verifies this size transition, not every possible responsive breakpoint.
- Gantt ID follow-up after window recovery: exact paste of `desktop_task` yielded the identical input and source ref, and both downstream `after desktop_task` references. Saved corrected test data. Earlier duplicated keystroke results remain an input-path anomaly, not a confirmed serializer defect.
- Sequence pointer controls: screenshot confirmed bottom life-line handle moved down (about 582→629), Undo enabled; participant dragged left. Selected first message, changed type to asynchronous and reversed it; source `App-)User: 提交请求` and actual preview confirmed the change.

- Save-error path: a read-only file in a writable directory still saved through replacement, so that attempt did not test failure. Created a separate directory and file with no write permission; Save displayed `文件保存失败，请重试`, retained the pending edit and Unsaved indicator, and the on-disk original was unchanged. Native Save As to a writable location recovered all pending text into `recovered-save-e2e.md`.
- Canvas keyboard test: Tab from Start created a connected seventh node. After clicking a visible node, Backspace deleted it. Immediate Command-Z did not restore it; clicking blank canvas followed by Command-Z restored it. Treat focus-dependent immediate undo as an interaction issue, not an unconditional shortcut pass. Discarded the test draft without changing the saved document.
- Flowchart pointer test: moved Input/接收请求 left; screenshot confirmed the node moved and both incoming/outgoing curves followed. Discarded this layout-only scratch draft. Installed app is left on saved `recovered-save-e2e.md` with no dirty scratch dialog.
- An explicit attachment authorization question was presented again during this resumed run; no answer has arrived yet. Do not send the attachment-bearing live request on the basis of an unanswered preselected option.
- Subsequent user answer explicitly allowed the request. Opened second.md (158 characters), attached workflow.md (258 characters), and sent the custom request to the configured OpenRouter/grok model. The prompt requested the attachment's heading and JSON version without supplying those values. Final diff added `附件验证：桌面端验证 0.6.7`, establishing successful attachment context delivery. Rejected the suggestion; app displayed `已拒绝建议，原文保持不变` and remained Saved. This resolves the earlier attachment authorization/testing blocker.
- Package ownership: selected Pages, changed its owner from Presentation to Domain using the canvas dropdown. Source placed Pages inside Domain and preserved all original dependencies and other nested groups.
- Use-case relationship: selected the include edge, changed style to emphasized and reversed endpoints; source became `Login ==>|«include»| Order`, retaining the separate extend relation. Actual preview rendered. Discarded these disposable semantic/layout edits instead of changing the saved fixture.
- After the attachment test, removed workflow.md from the AI context and closed the panel. App remains on saved second.md, with no pending draft or AI suggestion. A separate permission question asks whether the user wants the confirmed defects fixed; no implementation authority is inferred from attachment-upload approval.

## Computer-use test matrix

The matrix is not complete. Only the specific actions recorded above have passed; remaining actions are pending. Record actual observed results, failures, and unavailable prerequisites separately; do not infer passes from implementation or automated tests.

1. Launch, window resize, navigation panels, close/relaunch, unsaved-change confirmation.
2. Open Markdown file, open folder, browse/switch files, save original, Save As, reopen persisted content, file-association launch. Use a dedicated test directory only.
3. Edit text and selections; heading, bold, italic, link, inline code, list, quote, table, code-block toolbar actions; undo/redo and keyboard shortcuts.
4. Markdown live preview: headings, lists, tables, code fences, links, safe raw-HTML handling; synchronized scrolling and responsive editor/preview layout.
5. Each of the 11 existing Mermaid templates: create, select, rename, add/remove objects and relationships where exposed, drag/resize where exposed, undo/redo, source/canvas round trip, apply, save and reopen. Cover flowchart, 4+1 architecture, layered architecture, sequence, state, class, ER, mind map, Gantt, use case, and package structure.
6. Diagram-specific controls: sequence participants/messages/activation and preserved frames; state entry/exit/isolated states; class members; ER fields/keys; mind map hierarchy; Gantt dates/durations/dependencies; use-case actors/relations/boundaries; nested package ownership/dissolution.
7. Canvas connection mode, selection/deletion, snapping, direction, automatic layout, fit, zoom, standard/hand-drawn style, keyboard operations, cancelled edits.
8. Three creation entrances and editing an existing fence; insert at start/middle/end without replacing unrelated content.
9. Inline diagram scrolling and zoom buttons; fullscreen pointer-anchored wheel zoom, drag pan, reset, close, copy source.
10. Ordinary comments, Unicode identifiers, isolated states, standalone class members, plain mind-map root, structured sequences; invalid syntax and unsupported constructs must preserve source and show clear feedback.
11. Settings: provider/endpoint/model configuration, masked credentials, save/cancel, persistence after restart, validation errors. Never expose keys or replace existing configuration without a recoverable plan.
12. AI: polish, continue, summarize, custom edit, diagram generation/editing, source and canvas AI entrances; whole-document/selection scope; context add/remove; streaming, cancel, errors, diff reject/accept and original-text preservation. Use synthetic test content only; mark missing provider access as blocked, not passed.

## Evidence and boundaries

- Execute application interactions with computer use against the installed desktop app, not the development browser.
- Shell checks may verify downloaded artifacts, app version, and persisted test files, but are not substitutes for UI interactions.
- Record app version, platform, test inputs, expected/actual outcome, and relevant screenshot evidence when available.
- A macOS pass does not establish Windows runtime behavior. Windows UI testing requires an available Windows environment.
- Report limitations honestly: visual editing for existing views does not imply every advanced Mermaid grammar construct is directly editable.
