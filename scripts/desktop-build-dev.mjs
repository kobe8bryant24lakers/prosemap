import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal}).`);
  return result.stdout;
}

try {
  if (process.env.CI) throw new Error('The memory-only development bundle is for local use.');
  if (process.platform !== 'darwin') throw new Error('This bundle command targets macOS. Use desktop:dev for other platforms.');
  if (process.argv.length > 2) throw new Error('The development bundle uses fixed, isolated build settings; no extra arguments are accepted.');
  const env = { ...process.env };
  // An unrelated release identity must not cause certificate import or a
  // signing-key prompt for this explicit no-Keychain development mode.
  delete env.APPLE_SIGNING_IDENTITY;
  delete env.APPLE_CERTIFICATE;
  delete env.APPLE_CERTIFICATE_PASSWORD;
  const cli = fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url));
  run(process.execPath, [cli, 'build', '--debug', '--features', 'dev-credentials',
    '--config', 'src-tauri/tauri.dev.conf.json', '--no-sign', '--bundles', 'app'], { env });
  const app = fileURLToPath(new URL('../src-tauri/target/debug/bundle/macos/ProseMap Development.app', import.meta.url));
  const identifier = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', `${app}/Contents/Info.plist`], { encoding: 'utf8', stdio: 'pipe' }).trim();
  if (identifier !== 'com.prosemap.editor.dev') throw new Error('Refusing to ad-hoc sign a non-development application.');
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  console.log('ProseMap Development is ready. Credentials remain in process memory and are cleared on quit.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
