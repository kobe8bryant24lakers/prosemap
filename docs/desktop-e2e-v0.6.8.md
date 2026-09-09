# v0.6.8 desktop validation

Status: PR #11 merged as `f2f8e7b0dd3301a03da003ae544524cc1723902b`; tag v0.6.8 pushed. Release workflow 34186811405 succeeded on Windows and universal macOS. Published-package installation and the macOS regression checks listed below are complete. Windows runtime verification remains unavailable.

Publication note: machine-specific paths, local access/session details, and configured AI service identifiers are omitted. All document content described below is synthetic test data.

## Published installation — September 8, 2026

- All five release assets uploaded. Downloaded the published DMG and checksum to an isolated test directory.
- SHA-256 verification passed: `3ecad18ab271ee909f15530de3dd5e7678eccf6f5c52a23c4e227c79dada05dd`.
- Confirmed no ProseMap processes remained and the installed application was an ordinary directory reporting 0.6.7. Mounted the verified DMG read-only and checked its 0.6.8 version and x86_64/arm64 architectures.
- Removed only the old application bundle, retaining no old-App backup, and installed the complete release bundle. Installed metadata reports 0.6.8 and its binary is byte-identical to the mounted source. Documents, configuration and credentials were not removed.
- An initial Computer Use attempt was blocked by an access prerequisite. It was not counted as a UI pass; the prerequisite was resolved before the checks below.

## Installed release results

- Launched the installed application through Computer Use. Entered a dedicated synthetic document with `UNSAVED_INSTALLED_068` and a two-participant/two-message sequence diagram.
- Native application-menu Quit displayed the unsaved-document warning. Continue Editing retained the marker and Unsaved state. Command-Q displayed the same confirmation.
- Sequence deletion/shortcut regression: deleted 服务 with Backspace; 2 participants/2 messages became 1/0. Immediate Command-Z restored 2/2; immediate Command-Shift-Z returned to 1/0; Command-Z restored 2/2, with no extra focus-restoring click.
- Renamed 服务 to 安装版服务 using the canvas inline input. Source retained both messages and the original participant IDs. Applied and saved via native Save As to a dedicated synthetic Markdown fixture. On-disk read confirmed the complete marker and sequence content.
- Quit the saved document, relaunched, and reopened that file with the native picker. Saved status, renamed participant, both messages and rendered preview persisted.
- Initially showed Connect Model; after relaunch it displayed the existing model configuration. Settings inspection confirmed the intended test service; no key was displayed or changed. Cause of the initial unloaded state was not established; configuration was available for the subsequent AI checks.
- AI-sidebar screenshot at approximately 1229 output pixels showed format controls and AI actions on separate, non-overlapping rows.
- Sent an authorized synthetic-only AI request to append `AI_INSTALLED_068_OK`, with no attachments. Diff showed one added line while the editor stayed unchanged. Reject preserved Saved state and reported the original unchanged. Repeated the request, accepted the one-line addition and saved successfully.
- Installed-release template regression: all 11 templates exposed canvas objects and passed Backspace followed immediately by Command-Z, restoring the original object labels/counts (6, 5, 5, 3, 5, 2, 2, 10, 4, 7, 6 respectively in template-list order).
- Each template then received one new object, was switched to Source (with draft preview), returned to Canvas, and applied into the dedicated document through the separate New Diagram entrance. Expected edited counts were 7, 6, 6, 4, 6, 3, 3, 11, 5, 8, 7. Saved the document; disk inspection confirmed 12 Mermaid fences (the original sequence plus all 11 templates), original marker, renamed participant and accepted AI marker.
- Reloaded the saved document via the native picker. Opened all 12 preview diagrams individually in Canvas and verified their persisted object counts: 2, 7, 8, 5, 11, 3, 3, 6, 4, 6, 6, 7 in document order. All 12 passed; canceling each untouched workbench returned to the document.
- Test-harness caveat: two early add-count checks failed although refreshed UI showed the expected extra node. The first reader could count the repeated focused-element line, and immediate post-click snapshots can be stale. Anchored the reader to AX tree lines and separated/refreshed transition checks. No application failure was inferred from those premature checks; actual source/canvas/application/persistence results were subsequently verified.
- Fullscreen installed preview: wheel zoom changed 100%→136%; pointer dragging panned the diagram. Clicking the percentage restored its original centered 100% view; Escape returned to the document.
- All nine format toolbar actions (heading, bold, italic, link, inline code, list, quote, table, code block) changed the editor and immediate Command-Z restored the exact prior editor text. Saved after the cycles.
- Started a synthetic AI continuation-style custom request, clicked Stop Generation while running, observed `生成已停止，文档没有被修改。` and retained Saved state. Rejected/closed the stopped diff.
- Native Open Folder selected the dedicated v0.6.8 directory and displayed its Markdown document in the file sidebar.
- September 9 resume: entered an invalid Mermaid draft with an unclosed node, clicked Apply, observed a parse error while the workbench remained open. Cancel prompted to discard the draft. After discarding, the editor remained Saved with all 12 diagram entrances and original/AI markers; invalid text was absent.
- Live AI action entrances: selected the 21-character synthetic marker and ran Polish; the model returned no text changes, and Reject preserved the original. Cleared selection and ran Summarize on the 3,092-character synthetic document; completed diff showed +34/−173. Rejected it. Ran Continue on the same complete document; completed diff showed +11/−0. Rejected it and confirmed Saved state plus all 12 diagram entrances. These record functional request/scope/diff/reject behavior, not a guarantee about model output quality.
- Final persisted-file check retained 12 Mermaid fences, the original marker and the deliberately accepted AI marker; invalid draft text was absent. App left on the saved synthetic document, with no pending AI suggestion or diagram draft.

## Local production candidate — September 8, 2026

Target: the locally built optimized application bundle, whose metadata reports 0.6.8. This is not the downloaded universal release. Prior menu, toolbar and flowchart regressions on the same repair code before the version bump are recorded separately.

Computer Use selected a visible canvas object, pressed Backspace, read the resulting counts/focus, then pressed Command-Z with no intervening click. All 11 templates restored the selected object and original counts; canvas focus remained on the editor container after deletion.

| Template | Selected object | Objects before → deleted → undo | Relationships before → deleted → undo |
| --- | --- | --- | --- |
| Flowchart | 校验通过？ | 6 → 5 → 6 | 6 → 3 → 6 |
| 4+1 architecture | 场景视图 | 5 → 4 → 5 | 4 → 0 → 4 |
| Layered architecture | 业务服务 | 5 → 4 → 5 | 4 → 1 → 4 |
| Sequence | 客户端 | 3 → 2 → 3 | 4 → 0 → 4 |
| State | 审核中 | 5 → 4 → 5 | 5 → 2 → 5 |
| Class | User | 2 → 1 → 2 | 1 → 0 → 1 |
| ER | USER | 2 → 1 → 2 | 1 → 0 → 1 |
| Mind map | 用户价值 | 10 → 9 → 10 | 9 → 8 → 9 |
| Gantt | 方案设计 | 4 → 3 → 4 | 3 → 1 → 3 |
| Use case | 提交订单 | 7 → 6 → 7 | 5 → 2 → 5 |
| Package | 领域服务 | 6 → 5 → 6 | 5 → 1 → 5 |

No user document or credentials were changed. These are targeted deletion/undo regressions, not claims that every property, gesture, grammar or persistence combination was revalidated in v0.6.8.

## Coverage and remaining prerequisites

- Build/upload, checksum and complete App replacement are complete as recorded above.
- Installed-app launch succeeded; model configuration was confirmed without exposing credentials.
- Repaired Quit, all-template canvas deletion/undo and toolbar regressions passed in the installed release. All 11 template additions/source round trips/applications and all 12 saved-diagram canvas reopen checks passed. File/editor/fullscreen and AI outcomes are recorded above.
- This is observed functional coverage, not proof of every possible input, graph grammar or gesture combination. Alternate-provider live tests and controlled upstream AI error responses have not been rerun in this installed release.
- Windows runtime verification requires an available Windows environment; compilation alone is not counted as a Windows UI pass.
