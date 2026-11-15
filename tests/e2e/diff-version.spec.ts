import { test, expect, type Page } from '@playwright/test';
import { launchDocument, mod } from './helpers';

const compact = '{"synthetic":true,"value":1}';
const formatted = '{\n  "synthetic": true,\n  "value": 1\n}';
const documentFor = (json: string) => `# SYNTHETIC DIFF VERSION\n\n\`\`\`json\n${json}\n\`\`\`\n\nSYNTHETIC_TARGET\n`;
const source = (page: Page) => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString() as string);

// Real Prettier output is held unchanged. Only delivery order and native IPC
// are controlled; this suite does not represent installed-app input evidence.
async function prepare(page: Page, original: string, selected: boolean, en: boolean) {
  await page.addInitScript(() => { (window as any).__diffVersion = { release: null, held: false, delivered: false }; });
  await page.route(/\/lib\/code-blocks\.ts(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    const body = await response.text();
    const signature = 'export async function formatCode(source, language)';
    expect(body).toContain(signature);
    await route.fulfill({ response, body: body.replace(signature, 'async function realFormatCode(source, language)') + `
export async function formatCode(source, language) {
  const result = await realFormatCode(source, language);
  const state = window.__diffVersion;
  state.result = result;
  state.held = true;
  await new Promise(resolve => { state.release = resolve; });
  state.delivered = true;
  return result;
}
` });
  });
  await launchDocument(page, original, 'SYNTHETIC_DIFF_VERSION.md', 'ready', 'memory');
  await page.evaluate(response => {
    const w = window as any, invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command === 'stream_ai') {
        args.onEvent.onmessage({ type: 'delta', text: response });
        args.onEvent.onmessage({ type: 'done' });return;
      }
      return invoke(command, args);
    };
  }, selected ? 'SYNTHETIC_RESULT' : original.replace('SYNTHETIC_TARGET', 'SYNTHETIC_RESULT'));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('模型名称', { exact: true }).fill('SYNTHETIC_MODEL');
  await page.getByLabel('API 密钥', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
  await page.getByRole('button', { name: '安全保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  if (en) await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
}

async function generate(page: Page, selected: boolean, en: boolean) {
  if (selected) {
    await page.locator('.cm-content').click();
    await page.keyboard.press(`${mod}+End`);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Shift+Home');
    expect(await page.locator('.cm-content').evaluate(el => { const v = (el as any).cmTile.root.view; const s = v.state.selection.main; return v.state.sliceDoc(s.from, s.to); })).toBe('SYNTHETIC_TARGET');
  }
  await page.getByRole('button', { name: en ? 'AI writing assistant' : 'AI 文字助手', exact: true }).click();
  await page.getByRole('button', { name: en ? 'Generate suggestion' : '生成建议', exact: true }).click();
  await expect(page.getByRole('button', { name: en ? 'Accept and replace' : '接受并替换', exact: true })).toBeEnabled();
}
async function save(page: Page) {
  const count = await page.evaluate(() => (window as any).__acceptance.saved.length);
  await page.keyboard.press(`${mod}+s`);
  await expect.poll(() => page.evaluate(() => (window as any).__acceptance.saved.length)).toBe(count + 1);
  return page.evaluate<string>(() => (window as any).__acceptance.saved.at(-1).content);
}
for (const en of [false, true]) for (const selected of [false, true]) {
  for (const sameText of [false, true]) {
    test(`proposal rejects a later format ${sameText ? 'same text' : 'changed text'} ${selected ? 'selection' : 'document'} ${en ? 'en' : 'zh'}`, async ({ page }, info) => {
      const original = documentFor(sameText ? formatted : compact);
      await prepare(page, original, selected, en);
      await page.locator('.cm-content').click();
      await page.keyboard.press(`${mod}+Home`);
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
      await page.keyboard.press(`${mod}+Shift+F`);
      await expect.poll(() => page.evaluate(() => (window as any).__diffVersion.held)).toBe(true);
      await generate(page, selected, en);
      await page.evaluate(() => {
        const w = window as any; w.__diffVersion.before = (document.querySelector('.cm-content') as any).cmTile.root.view.state.doc;
        w.__diffVersion.release();
      });
      await expect.poll(() => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc !== (window as any).__diffVersion.before)).toBe(true);
      expect(await source(page)).toBe(documentFor(formatted));
      await expect(page.locator('.toast')).toContainText(en ? 'formatted' : '已格式化');
      await page.getByRole('button', { name: en ? 'Accept and replace' : '接受并替换', exact: true }).click();
      await expect(page.locator('.diff-modal')).toHaveCount(0);
      await expect(page.locator('.toast')).toHaveText(en ? 'The document has changed. Generate a new suggestion.' : '文档已发生变化，请重新生成建议');
      expect(await source(page)).toBe(documentFor(formatted));
      expect(await save(page)).toBe(documentFor(formatted));
      await info.attach('real-format-result', { body: JSON.stringify({ sameText, original, formatted: await page.evaluate(() => (window as any).__diffVersion.result) }), contentType: 'application/json' });
    });
  }
  test(`unchanged proposal accepts and undoes ${selected ? 'selection' : 'document'} ${en ? 'en' : 'zh'}`, async ({ page }) => {
    const original = documentFor(formatted);
    await prepare(page, original, selected, en);
    await generate(page, selected, en);
    await page.getByRole('button', { name: en ? 'Accept and replace' : '接受并替换', exact: true }).click();
    expect(await save(page)).toBe(original.replace('SYNTHETIC_TARGET', 'SYNTHETIC_RESULT'));
    await page.getByRole('button', { name: en ? 'Undo' : '撤销', exact: true }).click();
    expect(await save(page)).toBe(original);
  });
}
