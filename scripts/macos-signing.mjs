import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Match Apple certificate families that securityd assigns to a stable team
// partition. Self-signed code still receives a per-build cdhash partition.
export const developerIdRequirement = 'anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists';
export const keychainSigningRequirement = `(${developerIdRequirement}) or (anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.1] exists and (certificate leaf[field.1.2.840.113635.100.6.1.12] exists or certificate leaf[field.1.2.840.113635.100.6.1.7] exists))`;

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error || result.status}`);
  return result.stdout;
}

export function appleIdentity(output) {
  const matches = [...output.matchAll(/\b([A-Fa-f0-9]{40}) "((?:Developer ID Application|Apple Development|Mac Developer):[^"]+)"/g)];
  const identities = [...new Map(matches.map(match => [match[1].toUpperCase(), match[2]])).values()];
  if (identities.length > 1) throw new Error('Multiple Apple signing identities exist. Set APPLE_SIGNING_IDENTITY to the intended identity.');
  return identities[0] ?? null;
}

export function findAppleIdentity() {
  return appleIdentity(run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']));
}

export function verifyStableSignature(app, { distribution = false } = {}) {
  const requirement = distribution ? developerIdRequirement : keychainSigningRequirement;
  try {
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--test-requirement', requirement, app]);
  } catch {
    throw new Error('Keychain builds require an Apple-issued signing identity with a stable team partition. Self-signed and ad-hoc builds are not update-safe; use the separate memory-only development build.');
  }
  const result = spawnSync('/usr/bin/codesign', ['-d', '-r-', '--verbose=4', app], { encoding: 'utf8' });
  const details = result.stdout + result.stderr;
  if (result.status !== 0 || /Signature=adhoc|designated => cdhash/.test(details)
    || !/designated =>.*anchor apple/.test(details)) {
    throw new Error('This build lacks an Apple certificate-bound designated requirement. Do not install it over the Keychain build.');
  }
  return details.split('\n').find(line => line.includes('designated =>'));
}

export function signingEnvironment(env, identity) {
  const selected = env.APPLE_SIGNING_IDENTITY?.trim() || identity;
  if (!selected || !/^(?:Developer ID Application:|Apple Development:|Mac Developer:|[A-Fa-f0-9]{40}$)/.test(selected)) {
    throw new Error('An Apple-issued signing identity is required for Keychain continuity. Set APPLE_SIGNING_IDENTITY, or use npm run desktop:build:dev for session-only development credentials.');
  }
  if (env.CI && !selected.startsWith('Developer ID Application:')) throw new Error('Public macOS builds require a Developer ID Application identity.');
  return { ...env, APPLE_SIGNING_IDENTITY: selected };
}

function main() {
  const [action, ...args] = process.argv.slice(2);
  if (process.platform !== 'darwin') throw new Error('macOS signing commands require macOS.');
  if (action === 'check') {
    signingEnvironment(process.env, process.env.APPLE_SIGNING_IDENTITY ? null : findAppleIdentity());
    console.log('Apple signing identity selected. The build also verifies the actual certificate chain.');
  } else if (action === 'verify') {
    if (!args[0] || !existsSync(args[0])) throw new Error('Supply an existing app bundle.');
    console.log(verifyStableSignature(args[0], { distribution: Boolean(process.env.CI) }));
  } else throw new Error('Use check or verify <app>.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
