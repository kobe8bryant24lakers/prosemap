# ProseMap

<!-- impeccable:product-schema 1 -->

## Platform

web

The application is a React interface in a Tauri desktop shell. The product
website is a static introduction on GitHub Pages, not a hosted editor.

## Users

Developers and technical writers working with Markdown and diagrams are the
inferred primary audience for the product introduction. This audience is based
on the repository's workflows; it is not a separately confirmed product strategy.

## Product Purpose

Keep writing, visual Mermaid editing, document questions and reviewable AI
suggestions in one local desktop workspace. The current introduction should
make those workflows clear and invite people to try the tool.

## Capabilities and Constraints

- Markdown files and pasted images remain in ordinary local folders.
- Editor, preview, split and focus views serve writing and reading.
- Mermaid has templates, a visual canvas, source editing and optional AI help.
- AI supports document Q&A, text changes and explicitly selected references.
  Changes require acceptance; AI requests send content to the configured provider.
- OpenAI-compatible and Anthropic endpoints and multiple model profiles are supported.
- English and Simplified Chinese are available in the application.
- v0.17.0 is a desktop preview. Sharing creates a Markdown copy on an explicitly
  started LAN or remote service. The desktop distribution formats and remaining
  native acceptance cases are recorded in the release notes.
- The repository is MIT licensed. Model service usage is separate.

## Evidence on Hand

- [Release notes](docs/releases/v0.17.0.md) record current behavior and validation limits.
- [User guide](docs/guide.md) describes workflows and detailed constraints.
- [Application design](DESIGN.md) records the existing neutral and blue interface.
- Product screenshots use the actual frontend with explicitly synthetic documents
  and model responses. They do not establish installed desktop acceptance.

## Brand Commitments

Keep the ProseMap name and the recognizable visual language of the current UI.
Use concrete demonstrations, accurate download availability and plain language.
Do not invent testimonials, usage metrics or performance claims.
