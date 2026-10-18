# Linux desktop packaging

Linux support is prepared for x86-64 desktop systems with WebKitGTK 4.1. CI builds on Ubuntu 22.04 and produces a Debian package and an AppImage. These changes have not yet been run on a Linux release runner or accepted on a Linux desktop; no Linux download has been published by this change.

## Build locally

Use Node.js 22.13+ and Rust 1.98 (the CI toolchain) on Linux. Ubuntu 22.04 build dependencies:

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libwebkit2gtk-4.1-dev \
  libssl-dev libdbus-1-dev libxdo-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf libfuse2 xdg-utils
npm ci
npm run desktop:build:linux
```

Tauri automatically merges `src-tauri/tauri.linux.conf.json` on Linux. Outputs are under `src-tauri/target/release/bundle/deb/` and `src-tauri/target/release/bundle/appimage/`. Building on macOS does not produce a Linux binary with this command. Linux ARM64, RPM, Flatpak and Snap are not included in the release workflow.

Ubuntu 22.04 is the selected build baseline to limit glibc compatibility requirements. AppImage does not guarantee compatibility with every Linux distribution; test each supported distribution. See the official [Tauri Debian](https://v2.tauri.app/distribute/debian/), [AppImage](https://v2.tauri.app/distribute/appimage/) and [prerequisites](https://v2.tauri.app/start/prerequisites/) documentation.

## Runtime integration

- HTTPS/HTTP/mail links use `xdg-open`, passing the validated URL as a single argument without a shell.
- Model credentials use the synchronous Secret Service backend with encrypted D-Bus transport. The desktop session must provide an unlocked Secret Service (for example GNOME Keyring) and a session D-Bus. Missing/locked credential storage produces an error; there is no plaintext fallback. The previous platform feature configuration would have selected keyring's mock backend on Linux; see [keyring feature documentation](https://docs.rs/keyring/3.6.3/keyring/).
- Native file dialogs use the existing `rfd` integration; desktop portal availability and file association behavior require runtime acceptance on the target desktop environment.
- Debian dependencies add D-Bus, OpenSSL, `xdg-utils` and CA certificates to Tauri's automatic GTK/WebKitGTK dependencies.

## CI and publishing

1. Commit the intended release source, then run **Build Linux desktop packages** manually on that branch. This builds and retains `ProseMap-Linux-x64` artifacts for 14 days without publishing a release.
2. Download and extract the artifact, then verify `sha256sum --check SHA256SUMS-Linux.txt`. GitHub artifact archives do not preserve executable permission; use `chmod +x ProseMap-Linux-x64-v*.AppImage` before launching.
3. Complete desktop acceptance below before treating Linux as supported.
4. Prepare a new release version consistently in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`, plus `docs/releases/v<VERSION>.md`.
5. Push the corresponding `v<VERSION>` tag. The existing desktop release workflow first creates the pre-release through its Windows job; Linux and macOS then attach their own verified assets. A Linux failure does not imply the other platform assets failed; inspect the Linux job explicitly.

Linux release assets are `ProseMap-Linux-x64-v<VERSION>.deb`, `ProseMap-Linux-x64-v<VERSION>.AppImage`, and `SHA256SUMS-Linux.txt`. CI checks version consistency, Rust formatting/tests/targets, frontend checks, Debian architecture/version, executable architecture, nonempty assets and checksums. Packages are unsigned; checksums detect download corruption and are not publisher signatures.

## Desktop acceptance before first release

- Install the `.deb` and launch the AppImage as a normal desktop user.
- Open/save/reopen [the complex Markdown fixture](fixtures/complex-markdown.md), including its relative image and Unicode path names; exercise native file/folder dialogs.
- Save a model profile, restart, confirm it persists, then remove the test profile. Check a locked/unavailable keyring produces an actionable error.
- Open an HTTPS link and a mail link through desktop defaults; launch a Markdown file from the file manager.
- Verify Chinese fonts, all seven Mermaid types, canvas editing, shortcuts, unsaved-close confirmation, and the 900×600 minimum window size.
- Exercise the target desktop's X11/Wayland session and keep distribution/version/results with the release notes.
