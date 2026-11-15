import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findAppleIdentity, signingEnvironment, verifyStableSignature } from './macos-signing.mjs';

try {
  const args = process.argv.slice(2);
  let env = process.env;
  if (process.platform === 'darwin') {
    if (args.includes('--no-sign')) throw new Error('Unsigned macOS updates lose Keychain access continuity. Use a persistent signing identity.');
    env = signingEnvironment(env, env.APPLE_SIGNING_IDENTITY ? null : findAppleIdentity());
  }
  if (env.CI && args.some(arg => arg.includes('dev-credentials') || arg === '--all-features')) throw new Error('Session-only development credentials cannot be included in a public build.');
  const cli = fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'build', ...args], { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (process.platform === 'darwin' && !args.includes('--no-bundle')) {
    const target = args.find(arg => arg.startsWith('--target='))?.slice(9) ?? args[args.indexOf('--target') + 1];
    const targetPrefix = args.some(arg => arg === '--target' || arg.startsWith('--target=')) ? `${target}/` : '';
    const profile = args.includes('--debug') ? 'debug' : 'release';
    const app = fileURLToPath(new URL(`../src-tauri/target/${targetPrefix}${profile}/bundle/macos/ProseMap.app`, import.meta.url));
    console.log(verifyStableSignature(app, { distribution: Boolean(env.CI) }));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
