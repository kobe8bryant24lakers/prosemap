import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { connect, createServer } from 'node:net';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { startService } from '../collaboration/service.mjs';
import { isLocalAddress, parseSessionLink, serviceOrigin, sessionUrl, socketUrl } from '../lib/collaboration-address.ts';

test('remote invitations preserve the chosen transport and LAN plaintext requires a private address and synthetic mode', () => {
  for (const [http, ws] of [['http', 'ws'], ['https', 'wss']]) {
    const origin = serviceOrigin(http + '://example.org/', 'remote');
    assert.equal(socketUrl(origin), ws + '://example.org/sync');
    const link = { origin, mode: 'remote', room: '1'.repeat(32), token: 'a'.repeat(43) };
    assert.deepEqual(parseSessionLink(sessionUrl(link)), link);
  }
  for (const invalid of ['ftp://example.org', 'ws://example.org', 'http://user@example.org', 'http://example.org?key', 'http://example.org:0']) {
    assert.throws(() => serviceOrigin(invalid, 'remote'));
  }
  assert.throws(() => serviceOrigin('http://example.org', 'lan'));
  assert.throws(() => serviceOrigin('https://example.org/private', 'remote'));
  assert.equal(serviceOrigin('https://example.org/', 'remote'), 'https://example.org');
  assert.ok(isLocalAddress('fd00::23'));
  assert.equal(serviceOrigin('https://[fd00::23]:8787', 'lan'), 'https://[fd00::23]:8787');
  assert.equal(isLocalAddress('fd00::::23'), false);
  assert.throws(() => parseSessionLink('https://example.org/#session/remote/missing'));
  assert.throws(() => startService({ mode: 'lan', host: '127.0.0.1', origin: 'http://127.0.0.1' }), /synthetic-demo/);
  assert.throws(() => startService({ mode: 'remote', host: '127.0.0.1', origin: 'http://example.org', tls: {} }), /HTTPS public URL/);
  assert.throws(() => startService({ mode: 'remote', host: '192.168.1.10', origin: 'https://example.org' }), /loopback/);
});

for (const mode of ['lan', 'remote']) {
  test(mode + ' HTTP enforces transport consent, room permissions, expiry and durable edits', t => verifyRoomPermissions(t, mode));
}

async function verifyRoomPermissions(t, mode) {
  const root = mkdtempSync(join(tmpdir(), 'prosemap-synthetic-'));
  const dist = join(root, 'frontend');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), 'Synthetic frontend fixture');
  const portProbe = createServer().listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  const config = { mode, host: '127.0.0.1', origin, port, dist, dataDir: join(root, 'data'), demo: mode === 'lan', inviteLifetime: 3000 };
  let service = startService(config);
  await once(service.server, 'listening');
  const connections = new Set();
  t.after(async () => { for (const ws of connections) ws.terminate(); await service.close(); rmSync(root, { recursive: true, force: true }); });
  let client = 1;
  async function socket() {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/sync');
    connections.add(ws);
    const messages = [];
    ws.on('message', bytes => messages.push(JSON.parse(bytes)));
    await once(ws, 'open');
    return { ws, send: m => ws.send(JSON.stringify(m)), next: async type => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        while (!messages.some(m => m.type === type)) await once(ws, 'message', { signal: controller.signal });
        return messages.splice(messages.findIndex(m => m.type === type), 1)[0];
      } finally { clearTimeout(timer); }
    } };
  }
  const creds = () => ({ room: randomBytes(16).toString('hex'), token: randomBytes(32).toString('base64url') });
  const a = creds(), b = creds();
  const consent = mode === 'lan' ? { synthetic: true } : { allowPlaintext: true };
  const wrongConsent = mode === 'lan' ? { allowPlaintext: true } : { synthetic: true };
  async function create(room, key = service.createKey, transport = consent) {
    const s = await socket();
    s.send({ type: 'create', ...room, key, mode, ...transport, title: 'Synthetic fixture', markdown: 'Synthetic paragraph.' });
    return s;
  }
  async function joinRoom(room, expected = 'ready', transport = consent) {
    const s = await socket();
    s.send({ type: 'join', ...room, mode, ...transport, client: client++ });
    return [s, await s.next(expected)];
  }
  const probe = await socket();
  probe.send({ type: 'probe' });
  assert.deepEqual(await probe.next('service'), { type: 'service', service: 'prosemap-collaboration', protocol: 1, mode });
  await (await create(a, service.createKey, {})).next('denied');
  await (await create(a, service.createKey, wrongConsent)).next('denied');
  await (await create(a, 'synthetic-invalid-credential')).next('denied');
  await joinRoom(a, 'denied');
  for (const room of [a, b]) await (await create(room)).next('created');
  await joinRoom(a, 'denied', wrongConsent);
  const [owner, initial] = await joinRoom(a);
  assert.equal(initial.role, 'owner');
  async function invitation(action, role) {
    owner.send({ type: 'invite', action, role });
    return (await owner.next('invites')).invites[role];
  }
  const read = await invitation('issue', 'read');
  const edit = await invitation('issue', 'edit');
  const [reader, readonly] = await joinRoom({ room: a.room, token: read.token });
  assert.equal(readonly.role, 'read');
  assert.equal(readonly.invites, undefined);
  await joinRoom({ room: b.room, token: read.token }, 'denied');
  await joinRoom({ room: a.room, token: b.token }, 'denied');
  const body = new Y.Doc(); const text = body.getText('markdown');
  Y.applyUpdate(body, Buffer.from(initial.state, 'base64'));
  const before = Y.encodeStateVector(body);
  text.insert(text.length, ' Saved.');
  const update = { type: 'update', seq: 1, data: Buffer.from(Y.encodeStateAsUpdate(body, before)).toString('base64') };
  reader.send(update);
  await reader.next('denied');
  const [writer, unchanged] = await joinRoom({ room: a.room, token: edit.token });
  assert.equal(unchanged.state, initial.state);
  const [observer] = await joinRoom({ room: a.room, token: read.token });
  writer.send(update);
  await writer.next('ack'); await observer.next('update');
  writer.send({ type: 'invite', action: 'issue', role: 'edit' });
  await writer.next('denied');
  await invitation('revoke', 'read');
  await observer.next('denied');
  await joinRoom({ room: a.room, token: read.token }, 'denied');

  const second = await invitation('issue', 'read');
  const [expiring] = await joinRoom({ room: a.room, token: second.token });
  await new Promise(resolve => setTimeout(resolve, Math.max(0, second.expires - Date.now()) + 20));
  expiring.send({ type: 'ping' });
  await expiring.next('denied');
  await joinRoom({ room: a.room, token: second.token }, 'denied');

  // A retried create with the same credentials must never reseed the room.
  await (await create(a)).next('created');
  const idle = connect(port, '127.0.0.1');
  await once(idle, 'connect');
  const idleClosed = once(idle, 'close', { signal: AbortSignal.timeout(3000) }).catch(error => {
    if (error.code !== 'ECONNRESET') throw error;
  });
  await Promise.all([idleClosed, service.close()]);
  service = startService(config);
  await once(service.server, 'listening');
  const [, restored] = await joinRoom(a);
  const saved = new Y.Doc();
  Y.applyUpdate(saved, Buffer.from(restored.state, 'base64'));
  assert.equal(saved.getText('markdown').toString(), 'Synthetic paragraph. Saved.');
  const [, other] = await joinRoom(b);
  assert.equal(other.state === restored.state, false);
  const isolated = new Y.Doc();
  Y.applyUpdate(isolated, Buffer.from(other.state, 'base64'));
  assert.equal(isolated.getText('markdown').toString(), 'Synthetic paragraph.');
  await joinRoom({ room: a.room, token: read.token }, 'denied');
  for (const path of ['/create.key', '/rooms.sqlite', '/data/rooms.sqlite', '/assets/rooms.sqlite', '/.env', '/package.json']) {
    assert.equal((await fetch(origin + path)).status, 404);
  }
  body.destroy(); saved.destroy(); isolated.destroy();
}
