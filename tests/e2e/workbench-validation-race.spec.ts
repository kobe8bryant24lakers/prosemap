import { expect, test, type Page } from '@playwright/test';
import { draftSource, launchDocument, mod, openDiagram, savedSource } from './helpers';

const initial = 'flowchart LR\n  A["SYNTHETIC initial"] --> B["SYNTHETIC keep"]';
const oldValid = 'flowchart LR\n%% SYNTHETIC_HOLD\n  A["SYNTHETIC old"] --> B["SYNTHETIC keep"]';
const oldError = 'flowchart LR\n%% SYNTHETIC_HOLD\n  A[broken';
const latest = 'flowchart LR\n  A["SYNTHETIC latest"] --> B["SYNTHETIC keep"]';
const doc = `# SYNTHETIC parse delivery\n\n\`\`\`mermaid\n${initial}\n\`\`\`\n\nSYNTHETIC_TAIL\n`;

// Hold the completed real parser result, including a real rejection. This
// controls delivery order without claiming an actual CPU or native-app stall.
async function prepare(page: Page) {
  await page.addInitScript(() => { (window as any).__parseDelivery = { armed: false, events: [], release: null }; });
  await page.route(/\/lib\/mermaid-runtime\.ts(?:\?.*)?$/, async route => {
    const response = await route.fetch(), body = await response.text();
    const signature = 'export async function parseMermaid(source)';
    expect(body).toContain(signature);
    await route.fulfill({ response, body: body.replace(signature, 'async function realParseMermaid(source)') + `
export async function parseMermaid(source) {
  const state = window.__parseDelivery;
  const held = state.armed && source.includes('SYNTHETIC_HOLD');
  if (held) state.armed = false;
  state.events.push({ phase: 'started', source, held });
  let result, error, failed = false;
  try { result = await realParseMermaid(source); } catch (reason) { failed = true; error = reason; }
  if (held) {
    state.events.push({ phase: 'held', source, failed });
    await new Promise(resolve => { state.release = resolve; });
  }
  state.events.push({ phase: 'delivered', source, failed, held });
  if (failed) throw error;
  return result;
}
` });
  });
  await launchDocument(page, doc, 'SYNTHETIC_DELIVERY.md');
  await openDiagram(page);
}
async function arm(page: Page) { await page.evaluate(() => { const s = (window as any).__parseDelivery; s.armed = true; s.events = []; s.release = null; }); }
async function held(page: Page, failed: boolean) {
  await expect.poll(() => page.evaluate(() => (window as any).__parseDelivery.events.find((e: any) => e.phase === 'held')?.failed)).toBe(failed);
}
async function release(page: Page) {
  await page.evaluate(() => (window as any).__parseDelivery.release());
  await expect.poll(() => page.evaluate(() => (window as any).__parseDelivery.events.some((e: any) => e.phase === 'delivered' && e.held))).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
const apply = (page: Page) => page.getByRole('button', { name: '应用到文档', exact: true });
async function source(page: Page, value: string) {
  await draftSource(page);
  await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(value);
}
async function unchanged(page: Page) { expect(await page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString())).toBe(doc); }

for (const oldFails of [false, true]) for (const latestFails of [false, true]) {
  test(`AI validation ignores old ${oldFails ? 'error' : 'success'} after latest ${latestFails ? 'error' : 'success'}`, async ({ page }) => {
    await prepare(page);
    await page.getByRole('button', { name: 'AI 辅助', exact: true }).click();
    await page.getByRole('button', { name: '手动编辑', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'AI 生成结果源码编辑器', exact: true });
    await arm(page); await editor.fill(oldFails ? oldError : oldValid); await held(page, oldFails);
    const current = latestFails ? 'SYNTHETIC_LATEST_INVALID' : latest;
    await editor.fill(current);
    const validation = page.locator('.workbench-ai-validation');
    await expect(validation).toHaveClass(new RegExp(latestFails ? 'error' : 'valid'));
    const message = await validation.textContent();
    await release(page);
    await expect(validation).toHaveText(message!);
    await expect(editor).toHaveValue(current);
    await unchanged(page);
  });
}

test('double apply while a real large parse result is held inserts exactly one diagram', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: '关闭图表工作台', exact: true }).click();
  await page.locator('.cm-content').click(); await page.keyboard.press(`${mod}+End`);
  await page.getByRole('button', { name: '新建图表', exact: true }).first().click();
  const large = 'flowchart TD\n%% SYNTHETIC_HOLD\n' + Array.from({ length: 120 }, (_, i) => `N${i}[SYNTHETIC ${i}] --> N${i + 1}`).join('\n');
  await source(page, large); await arm(page); await apply(page).dblclick(); await held(page, false);
  await expect(apply(page)).toBeDisabled(); await unchanged(page);
  expect(await page.evaluate(() => (window as any).__parseDelivery.events.filter((e: any) => e.phase === 'started').length)).toBe(1);
  await release(page); await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
  const saved = await savedSource(page);
  expect(saved.split(large)).toHaveLength(2);
  expect(saved.match(/```mermaid/g)).toHaveLength(2);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await savedSource(page)).toBe(doc);
});

for (const failed of [false, true]) {
  test(`editing source invalidates a held apply ${failed ? 'error' : 'success'}`, async ({ page }) => {
    await prepare(page); await source(page, failed ? oldError : oldValid); await arm(page); await apply(page).click(); await held(page, failed);
    await source(page, latest); await release(page);
    expect(await draftSource(page)).toBe(latest);
    await expect(page.locator('.workbench-footer .error')).toHaveCount(0); await unchanged(page);
    await apply(page).click(); await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
    expect(await savedSource(page)).toBe(doc.replace(initial, latest));
  });
}

test('template replacement invalidates the pending apply result', async ({ page }) => {
  await prepare(page); await source(page, oldValid); await arm(page); await apply(page).click(); await held(page, false);
  await page.getByRole('button', { name: '模板', exact: true }).click();
  await page.locator('.workbench-template-grid button').filter({ hasText: '时序图' }).click();
  await page.getByRole('button', { name: '替换草稿', exact: true }).click();
  const chosen = await draftSource(page); expect(chosen).toContain('sequenceDiagram');
  await release(page); expect(await draftSource(page)).toBe(chosen); await unchanged(page);
});

for (const discard of [false, true]) {
  test(`close during apply ${discard ? 'discards and isolates a new session' : 'keeps the draft without late application'}`, async ({ page }) => {
    await prepare(page); await source(page, oldValid); await arm(page); await apply(page).click(); await held(page, false);
    await page.getByRole('button', { name: '关闭图表工作台', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText('停止应用并关闭');
    await page.getByRole('button', { name: discard ? '取消应用并关闭' : '继续编辑', exact: true }).click();
    if (discard) await openDiagram(page);
    await release(page); expect(await draftSource(page)).toBe(discard ? initial : oldValid); await unchanged(page);
    if (!discard) { await apply(page).click(); await expect(page.locator('.mermaid-workbench')).toHaveCount(0); expect(await savedSource(page)).toBe(doc.replace(initial, oldValid)); }
  });
}

test('a real formatting result changes the captured document and rejects stale workbench application', async ({ page }) => {
  const compact = '{"synthetic":true,"value":1}';
  const original = doc.replace('\n\n```mermaid', `\n\n\`\`\`json\n${compact}\n\`\`\`\n\n\`\`\`mermaid`);
  const formatted = original.replace(compact, '{\n  "synthetic": true,\n  "value": 1\n}');
  await page.addInitScript(() => { (window as any).__formatDelivery = { ready: false, release: null }; });
  await page.route(/\/lib\/code-blocks\.ts(?:\?.*)?$/, async route => {
    const response = await route.fetch(), body = await response.text();
    const signature = 'export async function formatCode(source, language)';
    expect(body).toContain(signature);
    await route.fulfill({ response, body: body.replace(signature, 'async function realFormatCode(source, language)') + `
export async function formatCode(source, language) {
  const result = await realFormatCode(source, language);
  await new Promise(resolve => { window.__formatDelivery.release = resolve; window.__formatDelivery.ready = true; });
  return result;
}
` });
  });
  await launchDocument(page, original, 'SYNTHETIC_VERSION.md');
  await page.locator('.cm-content').click(); await page.keyboard.press(`${mod}+Home`);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press(`${mod}+Shift+F`);
  await expect.poll(() => page.evaluate(() => (window as any).__formatDelivery.ready)).toBe(true);
  await openDiagram(page); await source(page, latest);
  await page.evaluate(() => (window as any).__formatDelivery.release());
  await expect.poll(() => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString())).toBe(formatted);
  await apply(page).click();
  await expect(page.locator('.toast')).toHaveText('文档已发生变化，请重新打开图表工作台');
  expect(await draftSource(page)).toBe(latest);
  expect(await page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString())).toBe(formatted);
  await page.getByRole('button', { name: '关闭图表工作台', exact: true }).click();
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
  await openDiagram(page); await source(page, latest); await apply(page).click();
  expect(await savedSource(page)).toBe(formatted.replace(initial, latest));
});
