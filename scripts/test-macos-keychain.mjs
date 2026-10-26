import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, copyFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { findAppleIdentity, verifyStableSignature } from './macos-signing.mjs';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.stderr || result.error || result.status}`);
  return result.stdout;
}

if (process.platform !== 'darwin') throw new Error('This integration test requires macOS.');
const identity = process.env.APPLE_SIGNING_IDENTITY || findAppleIdentity();
if (!identity || identity === '-') throw new Error('Install an Apple-issued signing identity first.');
const directory = mkdtempSync(join(tmpdir(), 'prosemap-keychain-qa-'));
const service = `com.prosemap.keychain-qa.${randomUUID()}`;
const source = fileURLToPath(new URL('./macos-keychain-probe.c', import.meta.url));
const first = join(directory, 'first');
const updated = join(directory, 'updated');
const impostor = join(directory, 'same-identifier-adhoc');
const installed = join(directory, 'installed');
const probe = (binary, action) => JSON.parse(run(binary, [action, service]));
let created = false;
try {
  for (const [binary, revision] of [[first, 1], [updated, 2]]) {
    run('/usr/bin/xcrun', ['clang', source, '-framework', 'Security', '-framework', 'CoreFoundation', '-Wno-deprecated-declarations', `-DPROBE_REVISION=${revision}`, '-o', binary]);
    run('/usr/bin/codesign', ['--force', '--sign', identity, '--identifier', 'com.prosemap.keychain-probe', '--timestamp=none', binary]);
  }
  const firstRequirement = verifyStableSignature(first);
  const updatedRequirement = verifyStableSignature(updated);
  assert.equal(firstRequirement, updatedRequirement, 'Updated code must retain its designated requirement');
  copyFileSync(first, installed);
  assert.equal(probe(first, 'create').status, 0, 'The signed first version must create its own synthetic item');
  created = true;
  const firstRead = probe(first, 'read');
  const updatedRead = probe(updated, 'read');
  // Also check a replacement at the original path, as in an application update.
  const sameCodeRead = probe(installed, 'read');
  copyFileSync(updated, `${first}.replacement`);
  renameSync(`${first}.replacement`, first);
  const replacedRead = probe(first, 'read');
  console.log(JSON.stringify({ firstRead, updatedRead, sameCodeRead, replacedRead }));
  assert.equal(firstRead.matches, true);
  assert.equal(sameCodeRead.matches, true, 'The original signed code must also read after moving');
  assert.equal(firstRead.revision, 1);
  assert.equal(replacedRead.revision, 2, 'The replacement must execute the changed binary');
  assert.equal(replacedRead.matches, true, 'Replacement at the original path must read without any authorization UI');
  assert.equal(updatedRead.matches, true, 'Updated signed code must read without any authorization UI');
  copyFileSync(updated, impostor);
  run('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'com.prosemap.keychain-probe', impostor]);
  const rejected = probe(impostor, 'read');
  assert.notEqual(rejected.status, 0, 'A matching identifier alone must not grant access');
  assert.equal(rejected.matches, false);
  console.log(JSON.stringify({ firstRead: true, changedBuildReadWithoutPrompt: true, stableRequirement: true, sameIdentifierAdhocRejected: true }));
} finally {
  try {
    if (created) assert.equal(probe(installed, 'delete').status, 0, 'Clean up the synthetic item');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
