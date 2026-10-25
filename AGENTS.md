# Publication and acceptance requirements

- Keep the v0.11.1 deep-acceptance work local until all 494 matrix items have been evaluated and required fixes and retests are complete. Do not push, open a public PR, tag or publish a release before then. Record tool-limited and unsupported cases honestly; never count partial evidence as a pass.
- Before every public push, inspect every outgoing commit, its author/committer metadata, and the complete diff for personal information and credentials. Check local filesystem paths, personal email addresses, phone numbers, API keys, tokens, private URLs, and images or screenshots that could reveal private content.
- Review changed images visually and verify that generated artifacts, runtime logs, environment files and credentials are excluded. Synthetic test data must be identifiable as synthetic.
- Use repository-relative links in committed documentation and a public GitHub identity with a GitHub noreply address for agent-created commits.
- Removing private data only in the latest tree is insufficient if it remains in an earlier unpublished commit. Clean the entire outgoing commit range, then repeat the inspection. Do not rewrite already-published history without explicit user authorization.
- Publish only after this inspection is clean and the user's current publication instructions permit it. Keep private audit details and raw local evidence out of public commits.
