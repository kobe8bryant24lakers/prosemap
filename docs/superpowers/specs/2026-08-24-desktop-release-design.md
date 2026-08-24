# ProseMap v0.1.0 Desktop Release Design

## Objective

Publish reproducible, unsigned preview packages for ProseMap v0.1.0 on Apple silicon macOS and 64-bit Windows 11. The public GitHub pre-release must contain native installers, English release notes, and SHA-256 checksums without committing credentials or binary artifacts to the repository.

## Current State

- The repository is public at `kobe8bryant24lakers/prosemap`.
- `main` is clean and currently has no tags or GitHub Releases.
- `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` all declare version `0.1.0`.
- The host Mac is Apple silicon and can build a native arm64 Tauri application.
- The repository has a tag-triggered Windows release workflow whose implementation is authoritative in `.github/workflows/release.yml`.
- The host has no Apple Developer ID identity, Windows code-signing certificate, or notarization credentials.
- The existing macOS ZIP predates the current Git commit and fails strict Gatekeeper verification, so it will not be reused.

## Chosen Architecture

Use a hybrid native build:

1. Build the macOS arm64 application locally from the exact release commit.
2. Build Windows x64 NSIS and MSI installers on a GitHub-hosted Windows runner.
3. Push an annotated `v0.1.0` tag to trigger the Windows workflow.
4. Let the workflow create a public GitHub pre-release and upload the Windows installers.
5. Upload the locally verified macOS DMG and ZIP through the authenticated GitHub browser session.
6. Download the Windows assets, recompute every checksum locally, and upload one `SHA256SUMS.txt` covering all four packages.

This approach keeps both builds native, preserves Apple silicon support, avoids unreliable Windows cross-compilation, and requires no personal access token in the repository or command history.

## Repository Changes

Create or amend only the release infrastructure, scoped build configuration, and documentation needed for repeatability:

- `.github/workflows/release.yml` builds Windows packages for version tags and publishes a pre-release with the workflow-scoped `GITHUB_TOKEN`.
- `package.json` provides a dedicated Windows bundle script so fixed Tauri arguments do not cross the PowerShell/npm argument-forwarding boundary.
- `README.md` documents the same shell-safe Windows build entry point used by CI.
- `docs/releases/v0.1.0.md` contains English release notes and unsigned-package installation warnings.
- `docs/superpowers/plans/2026-08-24-desktop-release.md` records the exact verification and publication sequence; the workflow file remains the sole source of truth for CI implementation.
- `.gitignore` ignores `/.worktrees/` so isolated release worktrees cannot become tracked release inputs.
- `eslint.config.mjs` ignores `.worktrees/**` so repository-level lint does not traverse nested isolated worktrees.
- `src-tauri/tauri.conf.json` associates macOS document opening only with `net.daringfireball.markdown`, avoiding an over-broad claim on all plain-text documents.

Generated installers remain under the ignored `artifacts/` directory and must not be committed.

## macOS Build and Packaging

Run the production checks and Tauri build from the release commit with the existing isolated Rust homes. Build an arm64 `.app`, recursively remove extended attributes, and apply a fresh ad-hoc signature. Verify the bundle with strict `codesign` checks and confirm the executable is Mach-O arm64.

Package the verified application twice:

- `ProseMap-macOS-arm64-v0.1.0.dmg`
- `ProseMap-macOS-arm64-v0.1.0.zip`

The DMG contains `ProseMap.app` and an Applications shortcut. The ZIP is created without Finder metadata or resource-fork sidecar files. Neither package is notarized, so the release notes must explain the expected Gatekeeper warning.

## Windows Build and Packaging

The tag-triggered workflow runs on `windows-latest` with Node.js 22.13.0 and Rust 1.98.0. Every GitHub Action is pinned to an immutable 40-character commit SHA with a human-readable version comment. The job installs locked npm dependencies, runs frontend and Rust verification, then calls the dedicated `desktop:build:windows` package script. That script owns the fixed `nsis` and `msi` Tauri arguments, avoiding PowerShell/npm argument-forwarding differences while leaving the generic desktop build script unchanged.

Normalize the outputs to:

- `ProseMap-Windows-x64-v0.1.0-setup.exe`
- `ProseMap-Windows-x64-v0.1.0.msi`

The workflow must fail if either installer is missing or empty. The installers remain unsigned, so the release notes must explain the expected Windows SmartScreen warning.

## Release Publication

The annotated tag is `v0.1.0`, and the GitHub Release title is `ProseMap v0.1.0`. It is marked as a pre-release because the packages are not commercially signed or notarized.

Final release assets:

- `ProseMap-macOS-arm64-v0.1.0.dmg`
- `ProseMap-macOS-arm64-v0.1.0.zip`
- `ProseMap-Windows-x64-v0.1.0-setup.exe`
- `ProseMap-Windows-x64-v0.1.0.msi`
- `SHA256SUMS.txt`

Release notes and repository-facing text remain entirely in English.

## Security Boundaries

- No API key, signing certificate, password, personal access token, or notarization credential is added to source files, workflow files, shell arguments, release notes, or logs.
- GitHub Actions receives only the repository-scoped `GITHUB_TOKEN` with `contents: write` permission.
- Every third-party and GitHub-authored Action reference is pinned to an immutable commit SHA rather than a mutable tag.
- The workflow is triggered only by version tags and does not run untrusted pull-request code with write permission.
- Release binaries are generated from the tagged public commit.
- Binary outputs remain ignored by Git.

## Failure Handling

- Do not create or push the version tag until local lint, type checks, frontend build, Rust formatting, Rust tests, Rust checks, and the macOS bundle build pass.
- If the Windows workflow fails, inspect the job logs, fix the workflow on `main`, delete no published artifacts, and create a new release commit before moving the tag only if the pre-release has not been distributed.
- Do not upload a macOS package that fails strict signature verification or contains the wrong architecture.
- Do not publish the release as stable while either platform remains unsigned.
- Do not claim Windows installation validation beyond native Windows CI unless the installer is also exercised on a Windows 11 machine or VM.

## Verification and Acceptance Criteria

The release is complete only when all of the following are true:

- Local frontend lint, TypeScript checks, production build, Rust formatting, Rust tests, and Rust checks pass from the tagged commit.
- The macOS app reports version `0.1.0`, identifier `com.prosemap.editor`, arm64 architecture, and a valid ad-hoc signature after extended attributes are removed.
- The DMG mounts successfully and contains the verified app plus an Applications shortcut.
- The ZIP extracts successfully without `__MACOSX` entries.
- The Windows GitHub Actions job succeeds and produces non-empty NSIS and MSI packages.
- The GitHub pre-release is public and points at tag `v0.1.0`.
- All five expected assets are downloadable.
- Locally recomputed SHA-256 hashes match `SHA256SUMS.txt`.
- The repository worktree is clean and `main` is synchronized with `origin/main` after publication.

## Deferred Production Requirements

Apple Developer ID signing and notarization, Windows Authenticode signing, and hands-on installation testing on Windows 11 are intentionally deferred. They require external certificates, credentials, or hardware that are not currently available.
