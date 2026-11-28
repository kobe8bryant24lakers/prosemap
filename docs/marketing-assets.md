# Product image provenance

The workbench images in [website/assets/screenshots](../website/assets/screenshots/) show
the real v0.16.0 production frontend, captured from commit `d037a86` with
[capture-marketing.mjs](../scripts/capture-marketing.mjs). They are not generated
UI mockups. The viewport is 1440 × 900 at a 1.5 device scale, producing
2160 × 1350 images. Approved PNG captures are converted to WebP at quality 88.
Each WebP has a provenance sidecar.

The English and Chinese captures use the corresponding
[English](../website/assets/launch-plan.md) and
[Chinese](../website/assets/launch-plan.zh-CN.md) synthetic release-plan examples.
Both identify themselves as fictional. The selected model is named
`Synthetic demo`; no real account, credential, user folder or model output is used.

| Asset prefix | View and evidence |
| --- | --- |
| `workspace-` | Markdown source and live preview of the same document |
| `canvas-` | Mermaid canvas with the decision node selected and its properties visible |
| `questions-` | Document Q&A with an explicitly illustrative answer and a follow-up input |
| `review-` | Two synthetic wording changes, compared against their original passages |

The two `diagram-*.svg` assets are serialized from the application's actual
Mermaid rendering of the corresponding example source. The P favicon is a
vector adaptation of the existing in-application letter mark.

Only the native IPC boundary and model responses are substituted. The real
editor, preview, diagram canvas, assistant and comparison components render
unchanged. These captures demonstrate UI and workflows; they do not verify
native file operations, real provider quality or installed desktop acceptance.

Raw captures and verification output remain in the ignored `outputs/` directory.
Inspect every replacement image visually and keep provenance and simulation
disclosures current before publishing.

## Shared writing

The two `shared-writing-*.webp` images show the v0.17.0 production frontend.
Two independent Chromium sessions joined a temporary loopback collaboration
service and edited the same paragraph in the fictional launch plan. The crop
starts at the participant and save-status bar. It includes the guest’s live
selection, the Markdown source and the preview.

To reproduce, run `npm run build` and
`node --experimental-strip-types scripts/capture-shared-writing.mjs` with
Playwright Chromium installed. Convert the two PNGs in `outputs/marketing/`
to WebP at quality 88. Each published image is 2000 × 1280 pixels and has a
provenance sidecar. The invitation and creation credentials exist only in the
temporary capture session.
