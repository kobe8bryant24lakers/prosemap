// Run after npm run build. All documents, invitations and identities are disposable.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { startService } from '../collaboration/service.mjs';

const output = fileURLToPath(new URL('../outputs/marketing/', import.meta.url));
await mkdir(output, { recursive: true });
const listener = createServer().listen(0, '127.0.0.1');
await once(listener, 'listening');
const { port } = listener.address();
await new Promise(resolve => listener.close(resolve));
const origin = 'http://127.0.0.1:' + port;
const dataDir = await mkdtemp(join(tmpdir(), 'prosemap-synthetic-capture-'));
const service = startService({ mode: 'remote', host: '127.0.0.1', origin, port, dataDir,
  dist: fileURLToPath(new URL('../dist/', import.meta.url)) });
let browser;

async function selectPhrase(page, phrase, select = true) {
  const editor = page.locator('.shared-workspace .cm-content');
  await editor.focus();
  await editor.evaluate((el, { phrase, select }) => {
    const view = el.cmTile.root.view;
    const start = view.state.doc.toString().indexOf(phrase);
    if (start < 0) throw new Error('Synthetic paragraph missing');
    view.dispatch({ selection: { anchor: select ? start : start + phrase.length, head: start + phrase.length } });
  }, { phrase, select });
}

try {
  await once(service.server, 'listening');
  browser = await chromium.launch();
  for (const locale of ['en', 'zh-CN']) {
    const en = locale === 'en';
    const body = await readFile(new URL('../website/assets/launch-plan' + (en ? '' : '.zh-CN') + '.md', import.meta.url), 'utf8');
    const author = await browser.newPage({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 2 });
    const guest = await browser.newPage();
    await author.goto(origin);
    await author.locator('.cm-content').fill(body);
    await author.getByRole('button', { name: 'Share this document' }).click();
    await author.getByLabel('Creation key').fill(service.createKey);
    await author.getByRole('checkbox', { name: /HTTP sends the document/ }).check();
    await author.getByRole('button', { name: 'Create shared copy' }).click();
    await author.getByRole('button', { name: 'Manage invitations' }).click();
    await author.getByRole('button', { name: 'Create edit invitation' }).click();
    const invitation = await author.getByRole('textbox', { name: 'Edit invitation', exact: true }).inputValue();
    await author.getByRole('button', { name: 'Close', exact: true }).click();
    await guest.goto(invitation);
    await guest.getByRole('checkbox', { name: /HTTP sends the document/ }).check();
    await guest.getByRole('button', { name: 'Join session', exact: true }).click();
    await expect(author.getByText('2 online', { exact: true })).toBeVisible();
    if (!en) await author.locator('.shared-workspace').getByLabel('Interface language').selectOption(locale);

    const original = en ? 'Turn a rough release note into a plan the whole team can follow.' : '把一份粗略的发布笔记，写成团队都能读懂的行动计划。';
    const first = en ? 'Before we publish, check the draft' : '发布前，一起校对初稿';
    const second = en ? ' and review the diagram together.' : '，再核对流程图。';
    await selectPhrase(author, original);
    await author.keyboard.insertText(first);
    await expect(guest.locator('.shared-workspace .markdown-body')).toContainText(first);
    await selectPhrase(guest, first, false);
    await guest.keyboard.insertText(second);
    await expect(author.locator('.shared-workspace .markdown-body')).toContainText(first + second);
    await selectPhrase(guest, en ? 'review the diagram' : '核对流程图');
    await expect(author.locator('.cm-ySelectionCaret').first()).toBeVisible();
    await expect(author.locator('.shared-workspace .mermaid-svg svg g.node').first()).toBeVisible();
    await expect(author.getByText(en ? 'Saved to server' : '已保存到服务器', { exact: true })).toBeVisible();
    const bar = await author.locator('.shared-subbar').boundingBox();
    assert.ok(bar);
    // Include the live participant count, cursor, source and preview. Exclude the connection header.
    await author.screenshot({ path: join(output, 'shared-writing-' + locale + '.png'),
      clip: { x: 0, y: Math.floor(bar.y), width: 1000, height: 640 }, animations: 'disabled' });
    await Promise.all([author.context().close(), guest.context().close()]);
  }
} finally {
  await browser?.close();
  await service.close();
  await rm(dataDir, { recursive: true, force: true });
}
