import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { get as httpsGet } from 'node:https';
import { DatabaseSync } from 'node:sqlite';
import { createHash, X509Certificate } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { isLocalAddress, isLoopbackOrigin, parseSessionLink, sessionUrl, socketUrl } from '../lib/collaboration-address.ts';
import { chromium, webkit, expect } from '@playwright/test';

const lanHost = process.env.PROSEMAP_TEST_LAN_HOST || '127.0.0.1';
const synthetic = '# Synthetic collaboration fixture\n\nShared paragraph.\n\n' +
  '[Synthetic attachment](fixtures/only-local.txt)\n\n![Synthetic picture](fixtures/only-local.png)\n\n' +
  '\x60\x60\x60mermaid\nflowchart LR\n A[Draft] --> B[Review]\n\x60\x60\x60';
async function unusedPort(host = '127.0.0.1') {
  const server = createServer().listen(0, host);
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function serverProcess(mode, root, { tls = [], proxyScheme, host = mode === 'lan' ? lanHost : '127.0.0.1' } = {}) {
  assert.ok(isLocalAddress(host), 'Bind the synthetic test only to loopback or a private interface');
  const port = await unusedPort(host);
  const data = join(root, mode);
  const publicPort = proxyScheme ? await unusedPort() : port;
  const origin = (proxyScheme ?? (tls.length ? 'https' : 'http')) + '://' + host + ':' + publicPort;
  let child;
  return { origin, port, get key() { return readFileSync(join(data, 'create.key'), 'utf8').trim(); },
    async start() {
      child = spawn(process.execPath, ['--experimental-strip-types', 'collaboration/serve.mjs', '--mode', mode, '--host', host, '--port', String(port),
        '--data', data, '--public-url', origin, ...(mode === 'lan' ? ['--synthetic-demo'] : tls)], { stdio: ['ignore', 'pipe', 'pipe'] });
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Service startup timed out')), 10000);
        child.stdout.on('data', data => { if (String(data).includes('service ready')) { clearTimeout(timeout); resolve(); } });
        child.once('exit', code => { clearTimeout(timeout); reject(new Error('Service exited: ' + code)); });
      });
    },
    async stop() {
      if (!child || child.exitCode !== null || child.signalCode) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
      try { assert.equal((await exited)[0], 0, 'The service should stop and release its store promptly'); }
      finally { clearTimeout(timeout); }
    },
  };
}

function startTestProxy(binary, root, service, tlsFiles = []) {
  const tls = tlsFiles.length ? '\n  tls ' + tlsFiles.map(path => JSON.stringify(path)).join(' ') : '';
  const config = readFileSync('deploy/collaboration/Caddyfile', 'utf8')
    .replace('collab.example.org {', service.origin + ' {\n  bind 127.0.0.1' + tls)
    .replace('127.0.0.1:8787', '127.0.0.1:' + service.port);
  const file = join(root, 'Caddyfile');
  writeFileSync(file, '{\n admin off\n auto_https off\n skip_install_trust\n}\n' + config);
  const proxy = spawn(binary, ['run', '--config', file], { stdio: 'ignore', env: { ...process.env, XDG_DATA_HOME: root, XDG_CONFIG_HOME: root } });
  return async () => {
    if (proxy.exitCode !== null || proxy.signalCode) return;
    const exited = once(proxy, 'exit');
    proxy.kill('SIGTERM');
    await exited;
  };
}

async function openCopy(page, server, mode, appOrigin = server.origin, { configured, alternate } = {}) {
  let connections = 0;
  const frames = [];
  const connected = ws => {
    connections++;
    ws.on('framesent', ({ payload }) => frames.push(JSON.parse(String(payload))));
  };
  page.on('websocket', connected);
  await page.goto(appOrigin);
  if (mode === 'lan' && !isLoopbackOrigin(server.origin)) {
    assert.equal(await page.evaluate(() => window.isSecureContext), false);
  }
  await page.getByRole('textbox', { name: 'Document name' }).fill('Synthetic shared draft');
  await page.locator('.cm-content').fill(synthetic);
  assert.equal(connections, 0);
  await page.getByRole('button', { name: 'Share this document' }).click();
  if (configured) {
    await expect(page.getByLabel('Service location')).toHaveValue(mode);
    await expect(page.getByLabel('Service address')).toHaveValue(server.origin);
    if (alternate) {
      const chooser = page.getByLabel('Configured servers');
      await page.getByLabel('Creation key').fill('synthetic-never-sent');
      await chooser.selectOption(alternate);
      await expect(page.getByLabel('Creation key')).toHaveValue('');
      await expect(page.getByText(/Cannot connect/)).toBeVisible();
      await chooser.selectOption(server.origin);
    }
  } else {
    await page.getByLabel('Service location').selectOption(mode);
    await page.getByLabel('Service address').fill(server.origin);
  }
  await expect(page.getByText('ProseMap service online')).toBeVisible();
  await page.getByLabel('Creation key').fill(server.key);
  if (server.origin.startsWith('http:')) {
    await expect(page.getByRole('button', { name: 'Create shared copy' })).toBeDisabled();
    if (mode === 'lan' && isLoopbackOrigin(server.origin)) await expect(page.getByText(/To invite other devices, enter the host/)).toBeVisible();
    if (mode === 'lan') await capture(page, 'create');
    await page.getByRole('checkbox', { name: mode === 'lan' ? /synthetic test content/ : /HTTP sends the document and access credentials/ }).check();
  } else await expect(page.getByRole('checkbox')).toHaveCount(0);
  assert.ok(frames.length > 0);
  assert.ok(frames.every(m => Object.keys(m).length === 1 && m.type === 'probe'));
  page.off('websocket', connected);
  await page.getByRole('button', { name: 'Create shared copy' }).click();
  await expect(page.getByText('Saved to server', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manage invitations' }).click();
  if (mode === 'lan') await capture(page, 'invitations');
  const links = {};
  for (const [role, label] of [['edit', 'Edit invitation'], ['read', 'View invitation']]) {
    await page.getByRole('button', { name: 'Create ' + label.toLowerCase(), exact: true }).click();
    links[role] = await page.getByRole('textbox', { name: label, exact: true }).inputValue();
  }
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  return links;
}
async function enter(page, url) {
  await page.goto(url);
  if (url.startsWith('http:')) await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Join session', exact: true }).click();
}
async function joinInApp(page, appOrigin, invite) {
  await page.goto(appOrigin);
  await page.locator('.cm-content').fill('# Synthetic private guest draft');
  await page.getByRole('button', { name: 'Join shared document' }).click();
  const form = page.getByRole('dialog', { name: 'Join shared document' });
  await expect(form.getByLabel('Invitation link')).toBeFocused();
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Join shared document' })).toBeFocused();
  await page.getByRole('button', { name: 'Join shared document' }).click();
  const sent = [];
  const captureProbe = ws => ws.on('framesent', ({ payload }) => sent.push(JSON.parse(String(payload))));
  page.on('websocket', captureProbe);
  await form.getByLabel('Invitation link').fill(new URL(invite).origin);
  await form.getByLabel('Invitation link').blur();
  await expect(form.getByRole('alert')).toContainText('complete document invitation');
  await expect(form.getByRole('button', { name: 'Join session', exact: true })).toBeDisabled();
  await form.getByLabel('Invitation link').fill(invite.replace(/^https?:/, 'ftp:'));
  await expect(form.getByRole('alert')).toContainText('full collaboration service origin');
  await form.getByLabel('Invitation link').fill(invite);
  await expect(form.getByText('ProseMap service online')).toBeVisible();
  assert.deepEqual(sent, [{ type: 'probe' }]);
  page.off('websocket', captureProbe);
  await expect(form.getByLabel('Creation key')).toHaveCount(0);
  if (invite.startsWith('http:')) {
    await expect(form.getByRole('button', { name: 'Join session', exact: true })).toBeDisabled();
    const consent = parseSessionLink(invite).mode === 'lan' ? /synthetic test content/ : /HTTP sends the document and access credentials/;
    await form.getByRole('checkbox', { name: consent }).check();
  } else await expect(form.getByRole('checkbox')).toHaveCount(0);
  await form.getByRole('button', { name: 'Join session', exact: true }).click();
  assert.equal(new URL(page.url()).origin, appOrigin);
}
const content = p => p.locator('.shared-workspace .cm-content');
const source = p => content(p).evaluate(el => el.cmTile.root.view.state.doc.toString());
async function insertAtParagraph(page, value) {
  // Place both carets through the actual view and type through normal editor input.
  await page.bringToFront();
  await content(page).getByText('Shared paragraph.', { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(value);
}

async function checkReadonlyWire(link, ca) {
  const { origin, room, token, mode } = parseSessionLink(link);
  const socket = new WebSocket(socketUrl(origin), { ca });
  const doc = new Y.Doc();
  try {
    await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'join', mode, room, token, client: doc.clientID }));
    const first = JSON.parse((await once(socket, 'message'))[0]);
    assert.equal(first.role, 'read');
    Y.applyUpdate(doc, Buffer.from(first.state, 'base64'));
    const vector = Y.encodeStateVector(doc);
    doc.getText('markdown').insert(0, 'Synthetic read-only write');
    const result = once(socket, 'close');
    socket.send(JSON.stringify({ type: 'update', seq: 1, data: Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString('base64') }));
    assert.equal((await result)[0], 4403);
  } finally { socket.terminate(); doc.destroy(); }
}

async function capture(page, name) {
  if (!process.env.PROSEMAP_COLLAB_CAPTURE) return;
  const directory = 'outputs/collaboration/review';
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: join(directory, name + '.png'),
    mask: [page.locator('.collab-copy input:visible'), page.getByRole('textbox', { name: 'Invitation link', exact: true })] });
}

test('remote HTTP works from settings and invitations and merges edits after a service restart', { timeout: 90000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'prosemap-synthetic-http-'));
  const caddy = process.env.PROSEMAP_TEST_CADDY;
  const app = await serverProcess('lan', root);
  const remote = await serverProcess('remote', root, caddy ? { proxyScheme: 'http' } : { host: lanHost });
  let browser, stopProxy;
  t.after(async () => {
    await browser?.close();
    await stopProxy?.();
    await Promise.all([app.stop(), remote.stop()]);
    rmSync(root, { recursive: true, force: true });
  });
  await Promise.all([app.start(), remote.start()]);
  if (caddy) {
    stopProxy = startTestProxy(caddy, root, remote);
    await expect.poll(() => fetch(remote.origin).then(r => r.status).catch(() => 0)).toBe(200);
  }
  browser = await chromium.launch();
  const owner = await browser.newPage(), writer = await browser.newPage(), reader = await browser.newPage();
  await owner.goto(app.origin);
  await owner.getByRole('button', { name: 'Settings', exact: true }).click();
  await owner.getByRole('button', { name: 'Configure remote servers' }).click();
  const settings = owner.getByRole('dialog', { name: 'Remote collaboration servers' });
  await settings.getByLabel('Service address (HTTP or HTTPS)').fill(remote.origin);
  await expect(settings.getByText('ProseMap service online')).toBeVisible();
  await settings.getByRole('button', { name: 'Save as default server' }).click();
  await owner.getByRole('button', { name: 'Close model settings' }).click();
  const links = await openCopy(owner, remote, 'remote', app.origin, { configured: true });
  assert.equal(parseSessionLink(links.edit).origin, remote.origin);
  assert.equal(parseSessionLink(links.edit).mode, 'remote');
  await joinInApp(writer, app.origin, links.edit);
  await reader.goto(remote.origin);
  if (!isLoopbackOrigin(remote.origin)) assert.equal(await reader.evaluate(() => window.isSecureContext), false);
  await reader.getByRole('button', { name: 'Share this document' }).click();
  await expect(reader.getByLabel('Service location')).toHaveValue('remote');
  await expect(reader.getByLabel('Service address')).toHaveValue(remote.origin);
  await enter(reader, links.read);
  await expect(content(reader)).toHaveAttribute('contenteditable', 'false');
  for (const client of [owner, writer, reader]) {
    await expect(client.getByText('Unencrypted HTTP connection', { exact: true })).toBeVisible();
    await expect(client.getByText('Unencrypted LAN · Synthetic content only')).toHaveCount(0);
  }
  await expect(owner.getByText('3 online', { exact: true })).toBeVisible();
  await app.stop();
  await insertAtParagraph(writer, ' [Synthetic live HTTP]');
  await expect.poll(() => source(owner)).toContain('[Synthetic live HTTP]');
  await remote.stop();
  for (const editor of [owner, writer]) {
    await expect(editor.getByText('Disconnected · Reconnecting…', { exact: true })).toBeVisible();
    await content(editor).focus();
    await editor.keyboard.press('End');
    await editor.keyboard.insertText(editor === owner ? ' [Synthetic HTTP owner]' : ' [Synthetic HTTP writer]');
  }
  await remote.start();
  for (const marker of ['[Synthetic live HTTP]', '[Synthetic HTTP owner]', '[Synthetic HTTP writer]']) {
    await expect.poll(() => source(reader)).toContain(marker);
  }
  const merged = await source(reader);
  for (const editor of [owner, writer]) {
    await expect.poll(() => source(editor)).toBe(merged);
    await expect(editor.getByText('Saved to server', { exact: true })).toBeVisible();
  }
  const download = reader.waitForEvent('download');
  await reader.getByRole('button', { name: 'Export .md' }).click();
  assert.equal(readFileSync(await (await download).path(), 'utf8'), merged);
  await owner.getByRole('button', { name: 'Manage invitations' }).click();
  await owner.getByRole('button', { name: 'Revoke edit invitation' }).click();
  await expect(writer.getByText('This invitation is invalid, expired or revoked.')).toBeVisible();
  await writer.getByRole('button', { name: 'Leave session' }).click();
  await expect(writer.locator('.cm-content')).toHaveText('# Synthetic private guest draft');
});

test('production clients converge, reconnect, export and isolate LAN and independent TLS services', { timeout: 150000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'prosemap-synthetic-browser-'));
  const cert = join(root, 'test-cert.pem'), key = join(root, 'test-key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', key, '-out', cert], { stdio: 'ignore' });
  const certificate = readFileSync(cert);
  const pin = createHash('sha256').update(new X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  const caddy = process.env.PROSEMAP_TEST_CADDY;
  const lan = await serverProcess('lan', root);
  const remote = await serverProcess('remote', root, caddy ? { proxyScheme: 'https' } : { tls: ['--cert', cert, '--key', key] });
  let chrome, safari, stopProxy;
  t.after(async () => {
    await Promise.all([chrome?.close(), safari?.close()]);
    await stopProxy?.();
    await Promise.all([lan.stop(), remote.stop()]);
    rmSync(root, { recursive: true, force: true });
  });
  await Promise.all([lan.start(), remote.start()]);
  if (caddy) {
    stopProxy = startTestProxy(caddy, root, remote, [cert, key]);
    assert.equal((await fetch('http://127.0.0.1:' + remote.port)).status, 404);
    assert.equal((await fetch('http://127.0.0.1:' + remote.port, { headers: { host: new URL(remote.origin).host } })).status, 404);
  }
  const checkTls = ca => new Promise((resolve, reject) => httpsGet(remote.origin, { ca }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject));
  await expect.poll(() => checkTls(certificate).catch(() => 0)).toBe(200);
  await assert.rejects(checkTls(undefined));
  chrome = await chromium.launch({ args: ['--ignore-certificate-errors-spki-list=' + pin] });
  safari = await webkit.launch();
  const page = async (browser = chrome) => (await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })).newPage();
  const owner = await page(), writer = await page(), reader = await page(safari);
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  const errors = [];
  const attachmentRequests = [];
  for (const p of [owner, writer, reader]) {
    p.on('pageerror', err => errors.push(err.message));
    p.on('request', req => { if (req.url().includes('only-local.')) attachmentRequests.push(req.url()); });
  }
  const links = await openCopy(owner, lan, 'lan');
  await enter(writer, links.edit);
  await enter(reader, links.read);
  await expect(content(reader)).toHaveAttribute('contenteditable', 'false');
  await expect(owner.getByText('3 online', { exact: true })).toBeVisible();
  await expect(reader.locator('.shared-workspace .markdown-body svg').first()).toBeVisible();
  assert.equal(await reader.locator('.shared-workspace a[href*="only-local"]').count(), 0);
  assert.equal(await reader.locator('.shared-workspace img').count(), 0);
  await content(writer).focus();
  const blockedFiles = await content(writer).evaluate(editor => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['Synthetic private attachment'], 'synthetic-attachment.txt', { type: 'text/plain' }));
    transfer.setData('text/plain', 'Synthetic clipboard file fallback');
    let fileReads = 0;
    const original = FileReader.prototype.readAsText;
    FileReader.prototype.readAsText = function (...args) { fileReads++; return original.apply(this, args); };
    try {
      const drop = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
      const paste = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
      editor.dispatchEvent(drop);
      editor.dispatchEvent(paste);
      return { drop: drop.defaultPrevented, paste: paste.defaultPrevented, fileReads };
    } finally { FileReader.prototype.readAsText = original; }
  });
  assert.deepEqual(blockedFiles, { drop: true, paste: true, fileReads: 0 });
  await expect(writer.getByText('Shared sessions accept text only. Attachments stay on this device.')).toBeVisible();
  assert.equal(await source(writer), synthetic);
  await content(writer).evaluate(editor => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', '[Synthetic clipboard text]');
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => source(reader)).toContain('[Synthetic clipboard text]');
  await writer.keyboard.press(mod + '+z');
  await expect.poll(() => source(owner)).toBe(synthetic);
  await writer.bringToFront();
  await content(writer).getByText('Shared paragraph.', { exact: true }).click();
  await writer.keyboard.press('ArrowRight');
  await expect(owner.locator('.cm-ySelectionCaret').first()).toBeAttached();
  await capture(owner, 'desktop');
  if (process.env.PROSEMAP_COLLAB_CAPTURE) {
    await reader.setViewportSize({ width: 390, height: 844 });
    await reader.getByLabel('Interface language').selectOption('zh-CN');
    await capture(reader, 'mobile');
    await reader.getByLabel('界面语言').selectOption('en');
  }

  // Independent server with its own credentials, persistence and process lifetime.
  const remoteOwner = await page(), remoteWriter = await page();
  // Start in a separate app origin. Save the remote configuration before
  // sharing anything, including a temporarily offline server.
  await remoteOwner.goto(lan.origin);
  await remoteOwner.getByRole('button', { name: 'Settings', exact: true }).click();
  await remoteOwner.getByRole('button', { name: 'Configure remote servers' }).click();
  const settings = remoteOwner.getByRole('dialog', { name: 'Remote collaboration servers' });
  const offline = 'https://127.0.0.1:' + await unusedPort();
  await settings.getByLabel('Service address (HTTP or HTTPS)').fill(lan.origin + '/private');
  await expect(settings.getByText('Enter the full collaboration service origin.')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Save as default server' })).toBeDisabled();
  await settings.getByLabel('Service address (HTTP or HTTPS)').fill(lan.origin);
  await expect(settings.getByText(/Service mode mismatch/)).toBeVisible();
  await settings.getByLabel('Service address (HTTP or HTTPS)').fill(offline);
  await expect(settings.getByText(/Cannot connect/)).toBeVisible();
  await settings.getByRole('button', { name: 'Save as default server' }).click();
  await remoteOwner.getByRole('button', { name: 'Configure remote servers' }).click();
  await settings.getByLabel('Service address (HTTP or HTTPS)').fill(remote.origin);
  await expect(settings.getByText('ProseMap service online')).toBeVisible();
  await capture(remoteOwner, 'servers');
  await settings.getByRole('button', { name: 'Save as default server' }).click();
  await remoteOwner.getByRole('button', { name: 'Close model settings' }).click();
  const remoteLinks = await openCopy(remoteOwner, remote, 'remote', lan.origin, { configured: true, alternate: offline });
  const httpsPage = await page();
  await httpsPage.goto(remote.origin);
  await httpsPage.getByRole('button', { name: 'Join shared document' }).click();
  await httpsPage.getByLabel('Invitation link').fill(links.edit);
  await expect(httpsPage.getByText(/This HTTPS page cannot connect to an HTTP service/)).toBeVisible();
  await expect(httpsPage.getByRole('button', { name: 'Join session', exact: true })).toBeDisabled();
  await httpsPage.close();
  const otherRemoteOwner = await page();
  const otherLinks = await openCopy(otherRemoteOwner, remote, 'remote');
  await insertAtParagraph(otherRemoteOwner, ' [Synthetic second remote room]');
  await expect(otherRemoteOwner.getByText('Saved to server', { exact: true })).toBeVisible();
  assert.ok((await source(otherRemoteOwner)).includes('[Synthetic second remote room]'));
  await checkReadonlyWire(remoteLinks.read, certificate);
  assert.equal(await source(remoteOwner), synthetic);
  await joinInApp(remoteWriter, lan.origin, remoteLinks.edit);
  await expect(remoteOwner.getByText('2 online', { exact: true })).toBeVisible();
  const remoteReader = await page();
  await joinInApp(remoteReader, lan.origin, remoteLinks.read);
  await expect(content(remoteReader)).toHaveAttribute('contenteditable', 'false');
  await lan.stop();
  await expect(writer.getByText('Disconnected · Reconnecting…', { exact: true })).toBeVisible();
  await Promise.all([insertAtParagraph(owner, ' [LAN A]甲'), insertAtParagraph(writer, ' [LAN B]乙📝')]);
  await insertAtParagraph(remoteWriter, ' [Remote independent]');
  await expect.poll(() => source(remoteOwner)).toContain('[Remote independent]');
  await expect.poll(() => source(remoteReader)).toContain('[Remote independent]');
  await lan.start();
  await expect.poll(() => source(owner)).toContain('[LAN B]');
  await expect.poll(() => source(writer)).toContain('[LAN A]');
  const merged = await source(owner);
  assert.equal(await source(writer), merged);
  await expect.poll(() => source(reader)).toBe(merged);
  assert.equal((merged.match(/\[LAN [AB]\]/g) ?? []).length, 2);
  assert.ok(!merged.includes('[Remote independent]'));
  await owner.bringToFront();
  await content(owner).focus();
  await owner.keyboard.press(mod + '+z');
  await expect.poll(() => source(writer)).not.toContain('[LAN A]');
  assert.ok((await source(writer)).includes('[LAN B]乙📝'));
  await owner.keyboard.press(mod + '+Shift+z');
  await expect.poll(() => source(reader)).toBe(merged);

  const download = reader.waitForEvent('download');
  await reader.getByRole('button', { name: 'Export .md' }).click();
  const file = await download;
  assert.equal(file.suggestedFilename(), 'Synthetic shared draft-shared.md');
  assert.equal(readFileSync(await file.path(), 'utf8'), merged);
  await content(owner).focus(); await owner.keyboard.press(mod + '+a'); await owner.keyboard.press('Backspace');
  await expect(reader.getByText('The preview will appear when this shared document contains Markdown.')).toBeVisible();
  if (process.env.PROSEMAP_COLLAB_CAPTURE) {
    await reader.getByLabel('Interface language').selectOption('zh-CN');
    await expect(reader.getByText('共享文档有正文后，这里会显示预览。')).toBeVisible();
    await capture(reader, 'empty');
    await reader.getByLabel('界面语言').selectOption('en');
  }
  await owner.keyboard.press(mod + '+z');
  await expect.poll(() => source(reader)).toBe(merged);
  await owner.getByRole('button', { name: 'Manage invitations' }).click();
  await owner.getByRole('button', { name: 'Revoke view invitation' }).click();
  await expect(reader.getByText('This invitation is invalid, expired or revoked.')).toBeVisible();
  await expect(content(reader)).toHaveCount(0);
  await expect(reader.getByRole('button', { name: 'Export .md' })).toHaveCount(0);
  await owner.getByRole('button', { name: 'Close', exact: true }).click();
  await owner.getByRole('button', { name: 'Leave session' }).click();
  await expect(owner.getByRole('button', { name: 'Share this document' })).toBeVisible();
  assert.equal(await owner.locator('.cm-content').evaluate(el => el.cmTile.root.view.state.doc.toString()), synthetic);

  const remoteStart = await source(remoteOwner);
  await remote.stop();
  // Seed an already-expired invite in the stopped synthetic store. The service
  // unit test separately waits for a live invitation to reach its deadline.
  const stored = new DatabaseSync(join(root, 'remote', 'rooms.sqlite'));
  try {
    assert.equal(stored.prepare("UPDATE invites SET expires=? WHERE room=? AND role='read'")
      .run(Date.now() - 1000, parseSessionLink(remoteLinks.read).room).changes, 1);
  } finally { stored.close(); }
  await expect(remoteWriter.getByText('Disconnected · Reconnecting…', { exact: true })).toBeVisible();
  await content(remoteWriter).focus(); await remoteWriter.keyboard.press('Control+End'); await remoteWriter.keyboard.insertText(' TLS-reconnected');
  await remote.start();
  await expect(remoteReader.getByText('This invitation is invalid, expired or revoked.')).toBeVisible();
  await expect.poll(() => source(remoteOwner)).toContain('TLS-reconnected');
  assert.ok((await source(remoteOwner)).includes(remoteStart.trim().slice(0, 30)));
  await remoteOwner.getByRole('button', { name: 'Manage invitations' }).click();
  await remoteOwner.getByRole('button', { name: 'Revoke edit invitation' }).click();
  await expect(remoteWriter.getByText('This invitation is invalid, expired or revoked.')).toBeVisible();
  await expect(content(remoteWriter)).toHaveCount(0);
  await remoteWriter.getByRole('button', { name: 'Leave session' }).click();
  await expect(remoteWriter.locator('.cm-content')).toHaveText('# Synthetic private guest draft');
  const denied = await page();
  await enter(denied, remoteLinks.edit);
  await expect(denied.getByText('This invitation is invalid, expired or revoked.')).toBeVisible();
  assert.equal(await content(denied).count(), 0);
  await enter(denied, remoteLinks.read);
  await expect(denied.getByText('This invitation is invalid, expired or revoked.')).toBeVisible();
  await enter(denied, sessionUrl({ ...parseSessionLink(remoteLinks.edit), token: parseSessionLink(otherLinks.edit).token }));
  await expect(denied.getByText('This invitation is invalid, expired or revoked.')).toBeVisible();
  assert.equal(await content(denied).count(), 0);
  assert.ok(!(await source(otherRemoteOwner)).includes('TLS-reconnected'));
  // The same physical machine hosts two independent services. A token from the
  // other service has no authority, even when the document titles match.
  await enter(denied, remote.origin + '/#session/remote/' + links.read.split('/').slice(-2).join('/'));
  await expect(denied.getByText('This invitation is invalid, expired or revoked.')).toBeVisible();
  assert.equal(await content(denied).count(), 0);
  await remoteOwner.getByRole('button', { name: 'Close', exact: true }).click();
  await remote.stop();
  await expect(remoteOwner.getByText('Disconnected · Reconnecting…', { exact: true })).toBeVisible();
  await content(remoteOwner).focus(); await remoteOwner.keyboard.press('End'); await remoteOwner.keyboard.insertText(' [Synthetic unsynced draft]');
  await remoteOwner.getByRole('button', { name: 'Leave session' }).click();
  await expect(remoteOwner.getByRole('alertdialog')).toBeVisible();
  await remoteOwner.getByRole('button', { name: 'Keep editing' }).click();
  await expect.poll(() => source(remoteOwner)).toContain('Synthetic unsynced draft');
  await remoteOwner.getByRole('button', { name: 'Leave session' }).click();
  await remoteOwner.getByRole('button', { name: 'Discard pending edits and leave' }).click();
  await remoteOwner.getByRole('button', { name: 'Share this document' }).click({ timeout: 3000 });
  await expect(remoteOwner.getByRole('dialog', { name: 'Document collaboration' })).toBeVisible();
  await expect(remoteOwner.getByText(/Cannot connect/)).toBeVisible();
  await remote.start();
  await remoteOwner.getByRole('button', { name: 'Check service again' }).click();
  await expect(remoteOwner.getByText('ProseMap service online')).toBeVisible();
  await remoteOwner.getByRole('button', { name: 'Configure remote servers' }).click();
  await settings.getByRole('button', { name: 'Remove server ' + offline }).click();
  await settings.getByRole('button', { name: 'Save as default server' }).click();
  assert.deepEqual(await remoteOwner.evaluate(() => JSON.parse(localStorage.getItem('prosemap.collab.servers'))), [remote.origin]);
  assert.equal(await remoteOwner.evaluate(() => JSON.stringify(localStorage).includes('#session/')), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(attachmentRequests, []);
  assert.ok(existsSync(join(root, 'remote', 'rooms.sqlite')));
});
