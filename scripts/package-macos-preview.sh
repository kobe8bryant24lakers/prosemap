#!/bin/bash
# Run from the release source directory after npm ci.
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Building the preview DMG requires macOS.' >&2
  exit 1
fi

version="$(node -p "require('./package.json').version")"
product='ProseMap Preview'
identifier='com.prosemap.editor.preview'
filename="ProseMap-macOS-Preview-universal-v$version.dmg"
output="$PWD/artifacts/macos-preview"
mkdir -p "$output"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

# Use the tagged editor with its session-only credential backend in a separate
# release-mode bundle. The regular app has its own identity and signing path.
config="$(node -e '
  const config = require("./src-tauri/tauri.dev.conf.json");
  config.productName = config.app.windows[0].title = process.argv[1];
  config.identifier = process.argv[2];
  process.stdout.write(JSON.stringify(config));
' "$product" "$identifier")"
unset APPLE_SIGNING_IDENTITY APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD
export CARGO_TARGET_DIR="$PWD/src-tauri/target/macos-preview"
export CARGO_PROFILE_RELEASE_STRIP=symbols
export CARGO_ENCODED_RUSTFLAGS="--remap-path-prefix=$HOME=/build/home"$'\x1f'"--remap-path-prefix=$(pwd -P)=/build/prosemap"
node node_modules/@tauri-apps/cli/tauri.js build --ci --no-sign \
  --target universal-apple-darwin --features dev-credentials --config "$config" --bundles app

app="$staging/image/$product.app"
mkdir "$staging/image"
ditto --noextattr --noacl --norsrc \
  "$CARGO_TARGET_DIR/universal-apple-darwin/release/bundle/macos/$product.app" "$app"
plist="$app/Contents/Info.plist"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")" == "$identifier" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")" == "$version" ]]
executable="$app/Contents/MacOS/prosemap"
# Apple's linker can retain local object paths in the Mach-O symbol table.
xcrun strip -S -x "$executable"
if LC_ALL=C grep -aFq -e "$HOME/" -e "$(pwd -P)/" "$executable"; then
  echo 'A local build path remains in the application binary.' >&2
  exit 1
fi
lipo "$executable" -verify_arch arm64 x86_64
codesign --force --sign - --timestamp=none "$app"
codesign --verify --all-architectures --deep --strict "$app"
ln -s /Applications "$staging/image/Applications"

hdiutil create -quiet -format UDZO -fs HFS+ -volname "$product" \
  -srcfolder "$staging/image" "$staging/$filename"
hdiutil verify "$staging/$filename"
(cd "$staging" && shasum -a 256 "$filename" > SHA256SUMS-macOS-Preview.txt)
mv "$staging/$filename" "$staging/SHA256SUMS-macOS-Preview.txt" "$output/"
echo "Created $output/$filename"
