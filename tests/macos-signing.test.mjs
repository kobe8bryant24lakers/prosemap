import test from 'node:test';
import assert from 'node:assert/strict';
import { appleIdentity, signingEnvironment } from '../scripts/macos-signing.mjs';

const fingerprint = 'A'.repeat(40);
const identity = 'Developer ID Application: Synthetic (TEST)';
test('identity selection rejects self-signed certificates and ambiguous Apple identities', () => {
  assert.equal(appleIdentity(`1) ${fingerprint} "ProseMap Local Development"`), null);
  assert.equal(appleIdentity(`1) ${fingerprint} "${identity}"\n1) ${fingerprint} "${identity}"`), identity);
  assert.equal(appleIdentity('0 valid identities found'), null);
  assert.throws(() => appleIdentity(`1) ${fingerprint} "${identity}"\n2) ${'B'.repeat(40)} "Apple Development: Synthetic (TEST)"`), /Multiple/);
});
test('keychain builds reject ad-hoc, self-signed and development CI identities', () => {
  assert.throws(() => signingEnvironment({}, null), /Apple-issued/);
  assert.throws(() => signingEnvironment({ APPLE_SIGNING_IDENTITY: '-' }, identity), /Apple-issued/);
  assert.throws(() => signingEnvironment({ APPLE_SIGNING_IDENTITY: 'ProseMap Local Development' }, null), /Apple-issued/);
  assert.throws(() => signingEnvironment({ CI: 'true' }, fingerprint), /Developer ID/);
  assert.throws(() => signingEnvironment({ CI: 'true', APPLE_SIGNING_IDENTITY: 'Apple Development: Synthetic (TEST)' }, null), /Developer ID/);
  assert.equal(signingEnvironment({}, identity).APPLE_SIGNING_IDENTITY, identity);
  assert.equal(signingEnvironment({ CI: 'true', APPLE_SIGNING_IDENTITY: identity }, null).APPLE_SIGNING_IDENTITY, identity);
});
