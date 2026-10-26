# macOS signing and Keychain continuity

ProseMap's normal desktop build stores model credentials under the Keychain service `com.prosemap.editor.model-config`. Updates must preserve both the signing requirement and a stable Keychain partition. The bundle identifier alone is insufficient.

An ad-hoc signature uses a designated requirement tied to the code hash. A self-signed certificate stabilizes that requirement, but modern macOS still assigns this code a **per-build `cdhash` partition**. A new binary can therefore request authorization again even with the same certificate and the same installation path. Apple's [securityd client identification](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/clientid.cpp) and [partition validation](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/acls.cpp) explain this additional check. The older [TN2206 discussion of designated requirements](https://developer.apple.com/library/archive/technotes/tn2206/) does not alone establish current Keychain continuity for self-signed builds.

## Normal builds with Keychain

Install an Apple-issued signing identity and its private key. Keep the same Apple team and compatible designated requirement across updates. Supported local certificate families include Developer ID Application and Apple-issued Mac development identities; the build verifies the actual certificate chain, rather than trusting a certificate's display name.

```bash
npm run macos:signing:check
npm run desktop:build -- --bundles app,dmg
```

If multiple identities exist, select the intended identity with `APPLE_SIGNING_IDENTITY`. The build rejects `--no-sign`, ad-hoc identities and local self-signed names, then verifies the signed bundle against Apple's certificate requirements. Do not re-sign the result with `codesign --sign -`. There is no automatic fallback to a different credential store.

The signing key's first use may require a macOS authorization dialog. Enter the Mac password only in that system dialog, never in a repository file, terminal command or chat. Existing model items from older ad-hoc builds can also request authorization when moving to the Apple-signed app. Their values are preserved. The application does not delete items, grant all applications access, change trust roots or alter partition lists to suppress prompts.

The earlier local self-signed identity is not used for normal Keychain builds. A self-signed identity must not be presented as a fix for repeated authorization after updates.

## Public builds

Configure `APPLE_SIGNING_IDENTITY` with a **Developer ID Application** identity. CI imports its certificate through Tauri's `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD` secrets. Never commit these values or signing material. The workflow fails without the required identity and the built signature must satisfy the Developer ID certificate requirement. See [Tauri's macOS signing guide](https://tauri.app/distribute/sign/macos/).

Developer ID signing, notarization, certificate rotation and cross-update access need verification in the release environment. The tests below do not substitute for notarization. All v0.11.1 work remains local until the complete acceptance and publication requirements are satisfied.

## Development without Keychain

`npm run desktop:dev` explicitly enables the `dev-credentials` Cargo feature and uses the separate `com.prosemap.editor.dev` identity and **ProseMap Development** window title. Model profiles remain in process memory, support switching, and disappear on exit. The development backend does not read, migrate or overwrite OS credentials. The settings dialog and save result explain the session-only behavior. There is no plaintext-file fallback.

For a standalone local macOS development bundle:

```bash
npm run desktop:build:dev
```

This creates `src-tauri/target/debug/bundle/macos/ProseMap Development.app`. The wrapper excludes release certificate import/signing settings, checks the development bundle identifier and applies an ad-hoc signature without using a private signing key. This is appropriate only because this separate build never accesses Keychain. It does not replace the normal app or register as a Markdown file handler. Keep using the development app when no suitable Apple signing identity is available.

## Verification

```bash
npm run macos:signing:verify -- path/to/ProseMap.app
node scripts/test-macos-keychain.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo test --manifest-path src-tauri/Cargo.toml --lib --features dev-credentials
```

The native probe compiles two different binaries, signs both with the same identity, checks their signature requirements, and creates an isolated synthetic item. The updated binary must read it both from a different path and after replacing the first binary at its original path. System authorization UI is disabled **only for the probe process**, so a needed prompt is a failure. A same-identifier ad-hoc binary must be rejected. The probe accepts only its dedicated QA service prefix and cleans up its synthetic item; it never reads a real model key.

## Local validation status — 2026-10-26

The installed normal app was confirmed to use an ad-hoc signature. After the user authorized the local signing key, the self-signed integration experiment **failed**: revision 1 read its synthetic item successfully, while revision 2 returned `errSecAuthFailed` (`-25293`) both from another path and after replacement at the original path. Both versions had the same designated requirement. The synthetic item was cleaned up. This result prompted the stronger Apple-certificate build requirement above.

No usable Apple-issued signing identity is currently available on the test Mac. Normal Keychain update/reinstallation verification is **pending**, not passed. The user selected completion of the separate memory-only development mode. The Rust system backend (39 tests), Rust memory backend (41 tests), model/settings browser suite (28 tests), signing-policy tests, lint and typecheck have passed. The standalone development bundle also passed a native save/reopen/quit/relaunch check using a synthetic profile: the profile remained available during the session, the key stayed masked, the UI stated session-only storage, and the profile was absent after restart. The separate development app was installed and launched successfully. The normal installed app and its credentials were left intact.

The 494-item acceptance work has not been declared complete. No public push, PR, tag or release has occurred.
