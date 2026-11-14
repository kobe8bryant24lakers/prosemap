# Publication and acceptance requirements

- The user explicitly authorized a privacy review, PR, merge and release of v0.11.1 on 2026-11-14, superseding the earlier local-only acceptance gate for this release. Preserve the incomplete acceptance status in the PR and release notes. Record tool-limited and unsupported cases honestly; never count partial evidence as a pass. Any later release must follow the user's current publication instructions.
- Before every public push, inspect every outgoing commit, its author/committer metadata, and the complete diff for personal information and credentials. Check local filesystem paths, personal email addresses, phone numbers, API keys, tokens, private URLs, and images or screenshots that could reveal private content.
- Review changed images visually and verify that generated artifacts, runtime logs, environment files and credentials are excluded. Synthetic test data must be identifiable as synthetic.
- Use repository-relative links in committed documentation and a public GitHub identity with a GitHub noreply address for agent-created commits.
- Removing private data only in the latest tree is insufficient if it remains in an earlier unpublished commit. Clean the entire outgoing commit range, then repeat the inspection. Do not rewrite already-published history without explicit user authorization.
- Publish only after this inspection is clean and the user's current publication instructions permit it. Keep private audit details and raw local evidence out of public commits.
