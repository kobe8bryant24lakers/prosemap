# ProseMap v0.1.0 Desktop Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, verify, and publish unsigned ProseMap v0.1.0 preview packages for Apple silicon macOS and 64-bit Windows 11.

**Architecture:** Build the macOS arm64 app locally, package the verified app as DMG and ZIP, and build Windows NSIS/MSI installers on a tag-triggered native GitHub runner. The Windows workflow creates the public pre-release with its scoped GitHub token; the authenticated browser session then adds the macOS packages and a locally recomputed checksum manifest.

**Tech Stack:** Tauri 2.11, Rust stable, Node.js 22.13, npm, Vite, GitHub Actions, GitHub CLI inside the hosted runner, macOS `codesign`, `hdiutil`, `zip`, and SHA-256 tools.

---

## File Map

- Create `.github/workflows/release.yml`: verify and build Windows packages, normalize asset names, and create/update the GitHub pre-release.
- Create `docs/releases/v0.1.0.md`: public English release notes, platform requirements, and unsigned-package warnings.
- Generate ignored `artifacts/ProseMap-macOS-arm64-v0.1.0.dmg`: Apple silicon disk image.
- Replace ignored `artifacts/ProseMap-macOS-arm64-v0.1.0.zip`: Apple silicon ZIP archive built from the release commit.
- Download ignored `artifacts/ProseMap-Windows-x64-v0.1.0-setup.exe`: native Windows NSIS installer.
- Download ignored `artifacts/ProseMap-Windows-x64-v0.1.0.msi`: native Windows MSI installer.
- Generate ignored `artifacts/SHA256SUMS.txt`: checksums for all four packages.

### Task 1: Add English v0.1.0 Release Notes

**Files:**
- Create: `docs/releases/v0.1.0.md`
- Test: shell assertions against `docs/releases/v0.1.0.md`

- [ ] **Step 1: Run the failing existence check**

Run:

```bash
test -f docs/releases/v0.1.0.md
```

Expected: exit 1 because the release notes do not exist.

- [ ] **Step 2: Create the release notes**

Create `docs/releases/v0.1.0.md` with exactly:

````markdown
# ProseMap v0.1.0

ProseMap v0.1.0 is the first public preview of the local-first AI Markdown and Mermaid editor for macOS and Windows.

## Highlights

- Open individual Markdown files or entire local folders.
- Edit Markdown with a live visual preview.
- Create, preview, and revise Mermaid diagrams with AI assistance.
- Use OpenAI-compatible or Anthropic Claude providers with streaming responses.
- Apply polish, continuation, summary, or custom instructions to a selection or the full document.
- Review AI changes in a diff before accepting or rejecting them.
- Keep documents local; provider settings and API keys remain only in the current application process and are cleared on exit.

## Downloads

- `ProseMap-macOS-arm64-v0.1.0.dmg` — Apple silicon macOS installer image.
- `ProseMap-macOS-arm64-v0.1.0.zip` — Apple silicon macOS application archive.
- `ProseMap-Windows-x64-v0.1.0-setup.exe` — Windows 11 x64 NSIS installer.
- `ProseMap-Windows-x64-v0.1.0.msi` — Windows 11 x64 MSI installer.
- `SHA256SUMS.txt` — SHA-256 checksums for every package.

## Unsigned Preview Notice

These preview packages are not notarized by Apple and are unsigned on Windows.

- macOS may block the first launch. After verifying the checksum, right-click ProseMap and choose **Open**, or allow it from **System Settings > Privacy & Security**.
- Windows SmartScreen may show an unrecognized-app warning. After verifying the checksum, choose **More info > Run anyway** only if you trust this repository and download.

## Requirements

- macOS 11 or later on Apple silicon.
- Windows 11 x64. The installer downloads the Microsoft Edge WebView2 bootstrapper when required.

## Verify Downloads

Compare the SHA-256 output for the package you downloaded with its matching line in SHA256SUMS.txt before opening it.

macOS (run the command for the package you downloaded):

```bash
shasum -a 256 ProseMap-macOS-arm64-v0.1.0.dmg
shasum -a 256 ProseMap-macOS-arm64-v0.1.0.zip
```

Windows PowerShell:

```powershell
Get-FileHash .\ProseMap-Windows-x64-v0.1.0-setup.exe -Algorithm SHA256
Get-FileHash .\ProseMap-Windows-x64-v0.1.0.msi -Algorithm SHA256
```

ProseMap is released under the MIT License.
````

- [ ] **Step 3: Verify required release-note content**

Run:

```bash
rg -n "ProseMap v0.1.0|Unsigned Preview Notice|macOS 11|Windows 11 x64|SHA256SUMS.txt|MIT License" docs/releases/v0.1.0.md
```

Expected: every required phrase appears and the command exits 0.

- [ ] **Step 4: Commit the release notes**

```bash
git add docs/releases/v0.1.0.md
git commit -m "docs: add v0.1.0 release notes"
```

### Task 2: Add the Native Windows Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`
- Test: YAML parse and structural assertions against `.github/workflows/release.yml`

- [ ] **Step 1: Run the failing workflow existence check**

Run:

```bash
test -f .github/workflows/release.yml
```

Expected: exit 1 because the workflow does not exist.

- [ ] **Step 2: Create the Windows release workflow**

Create `.github/workflows/release.yml` with exactly:

```yaml
name: Release desktop packages

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  windows:
    name: Windows 11 x64
    runs-on: windows-latest
    timeout-minutes: 45

    steps:
      - name: Check out the tagged source
        uses: actions/checkout@v7
        with:
          persist-credentials: false

      - name: Set up Node.js
        uses: actions/setup-node@v7
        with:
          node-version: "22.13.0"
          cache: npm

      - name: Set up Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt

      - name: Verify tag and application versions
        shell: pwsh
        run: |
          $ErrorActionPreference = "Stop"
          $tagVersion = $env:GITHUB_REF_NAME.TrimStart([char]"v")
          $packageVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
          $tauriVersion = (Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
          $cargoMatch = Select-String -Path src-tauri/Cargo.toml -Pattern '^version = "([^"]+)"' | Select-Object -First 1
          $cargoVersion = $cargoMatch.Matches[0].Groups[1].Value

          if ($tagVersion -ne $packageVersion -or $tagVersion -ne $tauriVersion -or $tagVersion -ne $cargoVersion) {
            throw "Tag version $tagVersion does not match package=$packageVersion, tauri=$tauriVersion, cargo=$cargoVersion"
          }

      - name: Install frontend dependencies
        run: npm ci

      - name: Run frontend lint
        run: npm run lint

      - name: Run TypeScript checks
        run: npm run typecheck

      - name: Build the frontend
        run: npm run build

      - name: Check Rust formatting
        run: cargo fmt --manifest-path src-tauri/Cargo.toml -- --check

      - name: Run Rust tests
        run: cargo test --manifest-path src-tauri/Cargo.toml

      - name: Check all Rust targets
        run: cargo check --manifest-path src-tauri/Cargo.toml --all-targets

      - name: Build Windows installers
        run: npm run desktop:build -- --bundles nsis,msi

      - name: Normalize and verify Windows assets
        shell: pwsh
        run: |
          $ErrorActionPreference = "Stop"
          $version = $env:GITHUB_REF_NAME.TrimStart([char]"v")
          $exe = @(Get-ChildItem src-tauri/target/release/bundle/nsis -Filter *.exe -File)
          $msi = @(Get-ChildItem src-tauri/target/release/bundle/msi -Filter *.msi -File)

          if ($exe.Count -ne 1) { throw "Expected exactly one NSIS installer, found $($exe.Count)" }
          if ($msi.Count -ne 1) { throw "Expected exactly one MSI installer, found $($msi.Count)" }

          New-Item -ItemType Directory -Path release-assets -Force | Out-Null
          $exeTarget = "release-assets/ProseMap-Windows-x64-v$version-setup.exe"
          $msiTarget = "release-assets/ProseMap-Windows-x64-v$version.msi"
          Copy-Item -LiteralPath $exe[0].FullName -Destination $exeTarget
          Copy-Item -LiteralPath $msi[0].FullName -Destination $msiTarget

          foreach ($asset in @($exeTarget, $msiTarget)) {
            if ((Get-Item -LiteralPath $asset).Length -le 0) { throw "Release asset is empty: $asset" }
            Get-FileHash -LiteralPath $asset -Algorithm SHA256 | Format-List
          }

      - name: Create or update the GitHub pre-release
        shell: pwsh
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          $ErrorActionPreference = "Stop"
          $tag = $env:GITHUB_REF_NAME
          $version = $tag.TrimStart([char]"v")
          $notes = "docs/releases/$tag.md"
          $exe = "release-assets/ProseMap-Windows-x64-v$version-setup.exe"
          $msi = "release-assets/ProseMap-Windows-x64-v$version.msi"

          if (-not (Test-Path -LiteralPath $notes)) { throw "Missing release notes: $notes" }

          gh release view $tag --repo $env:GITHUB_REPOSITORY --json id *> $null
          $releaseExists = $LASTEXITCODE -eq 0

          if ($releaseExists) {
            gh release edit $tag --repo $env:GITHUB_REPOSITORY --title "ProseMap v$version" --notes-file $notes --prerelease
            if ($LASTEXITCODE -ne 0) { throw "Failed to update release metadata" }
            gh release upload $tag $exe $msi --repo $env:GITHUB_REPOSITORY --clobber
            if ($LASTEXITCODE -ne 0) { throw "Failed to upload Windows release assets" }
          } else {
            gh release create $tag $exe $msi --repo $env:GITHUB_REPOSITORY --verify-tag --title "ProseMap v$version" --notes-file $notes --prerelease
            if ($LASTEXITCODE -ne 0) { throw "Failed to create the GitHub pre-release" }
          }
```

- [ ] **Step 3: Parse the workflow as YAML**

Run:

```bash
ruby -e 'require "yaml"; YAML.parse_file(ARGV.fetch(0)); puts "valid YAML"' .github/workflows/release.yml
```

Expected: `valid YAML` and exit 0.

- [ ] **Step 4: Verify the workflow's security and release invariants**

Run:

```bash
rg -n "tags:|contents: write|persist-credentials: false|windows-latest|npm ci|cargo test|--bundles nsis,msi|GH_TOKEN|--verify-tag|--prerelease" .github/workflows/release.yml
```

Expected: every invariant appears and the command exits 0.

Run:

```bash
git diff --check
```

Expected: no output and exit 0.

- [ ] **Step 5: Commit the workflow**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add native Windows release workflow"
```

### Task 3: Run the Local Release Quality Gate

**Files:**
- Verify: `package-lock.json`
- Verify: `app/`, `components/`, `lib/`, and `src-tauri/`

- [ ] **Step 1: Install the exact locked frontend dependencies**

Run:

```bash
npm ci
```

Expected: exit 0 and no lockfile changes.

- [ ] **Step 2: Run all frontend checks**

Run each command separately:

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
npm run build
```

Expected: all three commands exit 0. The known Vite chunk-size warning is non-blocking.

- [ ] **Step 3: Run all Rust checks**

Run each command separately:

```bash
env RUSTUP_HOME=/private/tmp/prosemap-rustup CARGO_HOME=/private/tmp/prosemap-cargo PATH=/private/tmp/prosemap-cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

```bash
env RUSTUP_HOME=/private/tmp/prosemap-rustup CARGO_HOME=/private/tmp/prosemap-cargo PATH=/private/tmp/prosemap-cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin cargo test --manifest-path src-tauri/Cargo.toml
```

```bash
env RUSTUP_HOME=/private/tmp/prosemap-rustup CARGO_HOME=/private/tmp/prosemap-cargo PATH=/private/tmp/prosemap-cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin cargo check --manifest-path src-tauri/Cargo.toml --all-targets
```

Expected: formatting exits 0, all 8 Rust tests pass, and the all-targets check exits 0.

- [ ] **Step 4: Confirm release versions and repository state**

Run:

```bash
node --input-type=module -e 'import fs from "node:fs"; const p=JSON.parse(fs.readFileSync("package.json")); const t=JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json")); if(p.version!=="0.1.0"||t.version!=="0.1.0") process.exit(1); console.log("version 0.1.0")'
```

Expected: `version 0.1.0`.

Run:

```bash
git status --short --branch
```

Expected: `main` is ahead of `origin/main` only by the reviewed release commits and has no unstaged files.

### Task 4: Build and Verify the macOS arm64 Application

**Files:**
- Generate: `src-tauri/target/release/bundle/macos/ProseMap.app`

- [ ] **Step 1: Build the native macOS app bundle**

Run:

```bash
env RUSTUP_HOME=/private/tmp/prosemap-rustup CARGO_HOME=/private/tmp/prosemap-cargo PATH=/private/tmp/prosemap-cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin npm run desktop:build -- --bundles app
```

Expected: exit 0 and `src-tauri/target/release/bundle/macos/ProseMap.app` exists.

- [ ] **Step 2: Remove extended attributes and apply a fresh ad-hoc signature**

Run:

```bash
xattr -cr src-tauri/target/release/bundle/macos/ProseMap.app
```

```bash
codesign --force --deep --sign - --timestamp=none src-tauri/target/release/bundle/macos/ProseMap.app
```

Expected: both commands exit 0.

- [ ] **Step 3: Verify identity, version, architecture, and signature**

Run each command separately:

```bash
plutil -extract CFBundleIdentifier raw src-tauri/target/release/bundle/macos/ProseMap.app/Contents/Info.plist
```

Expected: `com.prosemap.editor`.

```bash
plutil -extract CFBundleShortVersionString raw src-tauri/target/release/bundle/macos/ProseMap.app/Contents/Info.plist
```

Expected: `0.1.0`.

```bash
file src-tauri/target/release/bundle/macos/ProseMap.app/Contents/MacOS/prosemap
```

Expected: `Mach-O 64-bit executable arm64`.

```bash
codesign --verify --deep --strict --verbose=2 src-tauri/target/release/bundle/macos/ProseMap.app
```

Expected: exit 0.

```bash
codesign -dv --verbose=4 src-tauri/target/release/bundle/macos/ProseMap.app
```

Expected: `Signature=adhoc` and `Identifier=com.prosemap.editor`.

### Task 5: Package and Verify the macOS DMG and ZIP

**Files:**
- Generate: `artifacts/ProseMap-macOS-arm64-v0.1.0.dmg`
- Replace: `artifacts/ProseMap-macOS-arm64-v0.1.0.zip`

- [ ] **Step 1: Create a clean DMG staging directory**

Run:

```bash
test ! -e /private/tmp/prosemap-dmg-staging-v0.1.0
```

```bash
mkdir /private/tmp/prosemap-dmg-staging-v0.1.0
```

```bash
ditto --norsrc --noextattr src-tauri/target/release/bundle/macos/ProseMap.app /private/tmp/prosemap-dmg-staging-v0.1.0/ProseMap.app
```

```bash
ln -s /Applications /private/tmp/prosemap-dmg-staging-v0.1.0/Applications
```

Expected: the staging directory contains `ProseMap.app` and an `Applications` symlink.

- [ ] **Step 2: Create the compressed DMG**

Run:

```bash
hdiutil create -volname ProseMap -srcfolder /private/tmp/prosemap-dmg-staging-v0.1.0 -ov -format UDZO artifacts/ProseMap-macOS-arm64-v0.1.0.dmg
```

Expected: exit 0 and a non-empty DMG exists.

- [ ] **Step 3: Create the metadata-free ZIP**

Run from `src-tauri/target/release/bundle/macos`:

```bash
env COPYFILE_DISABLE=1 zip -qry -X ../../../../../artifacts/ProseMap-macOS-arm64-v0.1.0.zip ProseMap.app
```

Expected: exit 0 and the final ZIP replaces the stale archive.

- [ ] **Step 4: Verify the ZIP contents and extracted signature**

Run:

```bash
unzip -t artifacts/ProseMap-macOS-arm64-v0.1.0.zip
```

Expected: no archive errors.

Run:

```bash
unzip -Z1 artifacts/ProseMap-macOS-arm64-v0.1.0.zip | rg '^__MACOSX/'
```

Expected: no output and exit 1, proving no `__MACOSX` entries exist.

Run:

```bash
test ! -e /private/tmp/prosemap-zip-verify-v0.1.0
```

```bash
mkdir /private/tmp/prosemap-zip-verify-v0.1.0
```

```bash
unzip -q artifacts/ProseMap-macOS-arm64-v0.1.0.zip -d /private/tmp/prosemap-zip-verify-v0.1.0
```

Then run:

```bash
codesign --verify --deep --strict --verbose=2 /private/tmp/prosemap-zip-verify-v0.1.0/ProseMap.app
```

Expected: exit 0.

- [ ] **Step 5: Mount and verify the DMG**

Run:

```bash
test ! -e /private/tmp/prosemap-dmg-verify-v0.1.0
```

```bash
mkdir /private/tmp/prosemap-dmg-verify-v0.1.0
```

```bash
hdiutil attach -readonly -nobrowse -mountpoint /private/tmp/prosemap-dmg-verify-v0.1.0 artifacts/ProseMap-macOS-arm64-v0.1.0.dmg
```

Then run:

```bash
test -d /private/tmp/prosemap-dmg-verify-v0.1.0/ProseMap.app
```

```bash
test -L /private/tmp/prosemap-dmg-verify-v0.1.0/Applications
```

```bash
codesign --verify --deep --strict --verbose=2 /private/tmp/prosemap-dmg-verify-v0.1.0/ProseMap.app
```

Detach the volume:

```bash
hdiutil detach /private/tmp/prosemap-dmg-verify-v0.1.0
```

Expected: all commands exit 0.

- [ ] **Step 6: Record preliminary macOS hashes**

Run:

```bash
shasum -a 256 artifacts/ProseMap-macOS-arm64-v0.1.0.dmg artifacts/ProseMap-macOS-arm64-v0.1.0.zip
```

Expected: two SHA-256 lines and exit 0.

### Task 6: Push the Release Infrastructure and Tag v0.1.0

**Files:**
- Verify: committed repository state
- Create: annotated Git tag `v0.1.0`

- [ ] **Step 1: Scan tracked release changes for accidental secrets**

Run:

```bash
git grep -nE 'ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY'
```

Expected: no matches and exit 1.

- [ ] **Step 2: Verify the exact release commit**

Run:

```bash
git status --short --branch
```

Expected: clean `main`, ahead of `origin/main` only by reviewed commits.

Run:

```bash
git log --oneline --decorate -5
```

Expected: the design, plan, release-note, and workflow commits appear above the original application commit.

- [ ] **Step 3: Push `main`**

Run:

```bash
git push origin main
```

Expected: exit 0 and `main` is synchronized with `origin/main`.

- [ ] **Step 4: Create and verify the annotated tag**

Run:

```bash
git tag -a v0.1.0 -m "ProseMap v0.1.0"
```

```bash
git cat-file -t v0.1.0
```

Expected: `tag`.

```bash
git rev-parse HEAD v0.1.0^{}
```

Expected: both lines contain the same commit SHA.

- [ ] **Step 5: Push only the version tag**

Run:

```bash
git push origin v0.1.0
```

Expected: exit 0 and the GitHub Actions Windows job starts.

### Task 7: Verify and Download the Windows Release Assets

**Files:**
- Download: `artifacts/ProseMap-Windows-x64-v0.1.0-setup.exe`
- Download: `artifacts/ProseMap-Windows-x64-v0.1.0.msi`

- [ ] **Step 1: Monitor the tag-triggered workflow**

Open `https://github.com/kobe8bryant24lakers/prosemap/actions` in the authenticated browser. Open the `Release desktop packages` run for `v0.1.0` and wait for the `Windows 11 x64` job to finish.

Expected: every verification/build step is green and the job concludes with success. If it fails, use `superpowers:systematic-debugging` before changing the workflow.

- [ ] **Step 2: Verify the pre-release metadata**

Open `https://github.com/kobe8bryant24lakers/prosemap/releases/tag/v0.1.0`.

Expected: public pre-release named `ProseMap v0.1.0`, English release notes, and both normalized Windows assets.

- [ ] **Step 3: Download both Windows assets from the public release**

Run each command separately with network access:

```bash
curl -fL https://github.com/kobe8bryant24lakers/prosemap/releases/download/v0.1.0/ProseMap-Windows-x64-v0.1.0-setup.exe -o artifacts/ProseMap-Windows-x64-v0.1.0-setup.exe
```

```bash
curl -fL https://github.com/kobe8bryant24lakers/prosemap/releases/download/v0.1.0/ProseMap-Windows-x64-v0.1.0.msi -o artifacts/ProseMap-Windows-x64-v0.1.0.msi
```

Expected: both downloads exit 0 and produce non-empty files.

- [ ] **Step 4: Verify Windows package formats and sizes**

Run:

```bash
file artifacts/ProseMap-Windows-x64-v0.1.0-setup.exe artifacts/ProseMap-Windows-x64-v0.1.0.msi
```

Expected: the EXE is a PE32+/Windows executable and the MSI is a Windows Installer/compound document.

Run:

```bash
du -h artifacts/ProseMap-Windows-x64-v0.1.0-setup.exe artifacts/ProseMap-Windows-x64-v0.1.0.msi
```

Expected: both files have non-zero sizes.

### Task 8: Generate Checksums and Complete the GitHub Pre-release

**Files:**
- Generate: `artifacts/SHA256SUMS.txt`
- Upload: five final release assets

- [ ] **Step 1: Generate one checksum manifest from the local verified copies**

Run from `artifacts/`:

```bash
shasum -a 256 ProseMap-macOS-arm64-v0.1.0.dmg ProseMap-macOS-arm64-v0.1.0.zip ProseMap-Windows-x64-v0.1.0-setup.exe ProseMap-Windows-x64-v0.1.0.msi > SHA256SUMS.txt
```

Expected: four lines in `SHA256SUMS.txt`.

- [ ] **Step 2: Verify all local files against the manifest**

Run from `artifacts/`:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

Expected: four `OK` results and exit 0.

- [ ] **Step 3: Upload the macOS packages and checksum manifest**

Open `https://github.com/kobe8bryant24lakers/prosemap/releases/edit/v0.1.0` in the authenticated browser. Upload:

```text
/Users/zhangyinbing/Documents/Codex/2026-08-23/markdown-studio/artifacts/ProseMap-macOS-arm64-v0.1.0.dmg
/Users/zhangyinbing/Documents/Codex/2026-08-23/markdown-studio/artifacts/ProseMap-macOS-arm64-v0.1.0.zip
/Users/zhangyinbing/Documents/Codex/2026-08-23/markdown-studio/artifacts/SHA256SUMS.txt
```

Keep the release marked as a pre-release, keep the existing English title and notes, wait until all uploads complete, then save the release.

Expected: the release page lists all five final assets.

### Task 9: Perform Final Download and Repository Verification

**Files:**
- Verify: five public GitHub Release assets
- Verify: local Git and remote tag state

- [ ] **Step 1: Download all release assets into a fresh temporary directory**

Run:

```bash
test ! -e /private/tmp/prosemap-release-verify-v0.1.0
```

```bash
mkdir /private/tmp/prosemap-release-verify-v0.1.0
```

Run each download separately:

```bash
curl -fL https://github.com/kobe8bryant24lakers/prosemap/releases/download/v0.1.0/ProseMap-macOS-arm64-v0.1.0.dmg -o /private/tmp/prosemap-release-verify-v0.1.0/ProseMap-macOS-arm64-v0.1.0.dmg
```

```bash
curl -fL https://github.com/kobe8bryant24lakers/prosemap/releases/download/v0.1.0/ProseMap-macOS-arm64-v0.1.0.zip -o /private/tmp/prosemap-release-verify-v0.1.0/ProseMap-macOS-arm64-v0.1.0.zip
```

```bash
curl -fL https://github.com/kobe8bryant24lakers/prosemap/releases/download/v0.1.0/ProseMap-Windows-x64-v0.1.0-setup.exe -o /private/tmp/prosemap-release-verify-v0.1.0/ProseMap-Windows-x64-v0.1.0-setup.exe
```

```bash
curl -fL https://github.com/kobe8bryant24lakers/prosemap/releases/download/v0.1.0/ProseMap-Windows-x64-v0.1.0.msi -o /private/tmp/prosemap-release-verify-v0.1.0/ProseMap-Windows-x64-v0.1.0.msi
```

```bash
curl -fL https://github.com/kobe8bryant24lakers/prosemap/releases/download/v0.1.0/SHA256SUMS.txt -o /private/tmp/prosemap-release-verify-v0.1.0/SHA256SUMS.txt
```

Expected: all five downloads exit 0.

- [ ] **Step 2: Verify the published checksums**

Run from `/private/tmp/prosemap-release-verify-v0.1.0/`:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

Expected: four `OK` results and exit 0.

- [ ] **Step 3: Re-run archive smoke checks on the downloaded macOS assets**

Run:

```bash
unzip -t /private/tmp/prosemap-release-verify-v0.1.0/ProseMap-macOS-arm64-v0.1.0.zip
```

Expected: no archive errors.

Run:

```bash
test ! -e /private/tmp/prosemap-published-dmg-v0.1.0
```

```bash
mkdir /private/tmp/prosemap-published-dmg-v0.1.0
```

```bash
hdiutil attach -readonly -nobrowse -mountpoint /private/tmp/prosemap-published-dmg-v0.1.0 /private/tmp/prosemap-release-verify-v0.1.0/ProseMap-macOS-arm64-v0.1.0.dmg
```

```bash
test -d /private/tmp/prosemap-published-dmg-v0.1.0/ProseMap.app
```

```bash
test -L /private/tmp/prosemap-published-dmg-v0.1.0/Applications
```

```bash
codesign --verify --deep --strict --verbose=2 /private/tmp/prosemap-published-dmg-v0.1.0/ProseMap.app
```

```bash
hdiutil detach /private/tmp/prosemap-published-dmg-v0.1.0
```

Expected: all commands exit 0.

- [ ] **Step 4: Verify Git synchronization and the public tag**

Run:

```bash
git status --short --branch
```

Expected: clean `main...origin/main`.

Run:

```bash
git ls-remote --tags origin refs/tags/v0.1.0 refs/tags/v0.1.0^{}
```

Expected: the annotated tag and peeled commit are both present.

- [ ] **Step 5: Verify final GitHub Release state in the browser**

Open `https://github.com/kobe8bryant24lakers/prosemap/releases/tag/v0.1.0` and confirm the tag, pre-release badge, English release notes, and all five asset names. Mark the release tab as the browser deliverable.

Expected: the public page is complete and every asset link is downloadable.

## Official References

- GitHub Checkout v7: https://github.com/actions/checkout
- GitHub Setup Node v7: https://github.com/actions/setup-node
- Tauri GitHub release pipelines: https://v2.tauri.app/distribute/pipelines/github/
- Tauri Windows installers: https://v2.tauri.app/distribute/windows-installer/
- Tauri macOS signing: https://v2.tauri.app/distribute/sign/macos/
