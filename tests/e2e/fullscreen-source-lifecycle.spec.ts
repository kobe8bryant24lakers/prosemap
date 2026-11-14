import { expect, test, type Page } from '@playwright/test';
import { draftSource, launchDocument, openDiagram } from './helpers';

const initial = 'flowchart LR\n A["SYNTHETIC initial"] --> B["SYNTHETIC keep"]';
const latest = initial.replace('SYNTHETIC initial', 'SYNTHETIC latest 中文🧭');
const original = `# SYNTHETIC fullscreen lifecycle\n\n\`\`\`mermaid\n${initial}\n\`\`\`\n\nSYNTHETIC_END\n`;

// Browser IPC controls only the synthetic AI stream. Native SSE evidence is
// recorded separately. Rendering always uses the real Mermaid implementation.
async function setup(page: Page) {
  await launchDocument(page, original, 'SYNTHETIC_FULLSCREEN.md', 'ready', 'memory');
  await page.evaluate(() => {
    const w = window as any, invoke = w.__TAURI_INTERNALS__.invoke;
    w.__fullscreenAI = { streams: [], armed: false, events: [], release: null };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command === 'save_model_profiles') return 'memory';
      if (command === 'stream_ai') return new Promise<void>((resolve, reject) => {
        w.__fullscreenAI.streams.push({ send: (event: unknown) => args.onEvent.onmessage(event), resolve, reject });
      });
      return invoke(command, args);
    };
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '模型连接', exact: true });
  await settings.getByLabel('配置名称', { exact: true }).fill('SYNTHETIC fullscreen');
  await settings.getByLabel('API 地址', { exact: true }).fill('http://127.0.0.1:1/v1');
  await settings.getByLabel('模型名称', { exact: true }).fill('SYNTHETIC_MODEL');
  await settings.getByLabel('API 密钥', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
  await settings.getByRole('button', { name: '安全保存', exact: true }).click();
  await openDiagram(page); await page.getByRole('button', { name: 'AI 辅助', exact: true }).click();
  await expect(page.locator('.workbench-preview .mermaid-svg')).toContainText('SYNTHETIC initial');
}
async function start(page: Page) {
  await page.getByLabel('描述你想要的图', { exact: true }).fill('SYNTHETIC 修改首节点');
  await page.getByRole('button', { name: '生成图表草稿', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fullscreenAI.streams.length)).toBe(1);
}
async function finish(page: Page, source: string) {
  await page.evaluate(source => {
    const stream = (window as any).__fullscreenAI.streams[0];
    stream.send({ type: 'delta', text: source }); stream.send({ type: 'done' }); stream.resolve();
  }, source);
}
const dialog = (page: Page) => page.locator('.mermaid-fullscreen-dialog');
async function openFullscreen(page: Page) {
  await page.locator('.mermaid-workbench').getByRole('button', { name: '全屏查看图表', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}
async function holdFullscreen(page: Page) {
  await page.route(/\/lib\/mermaid-runtime\.ts(?:\?.*)?$/, async route => {
    const response = await route.fetch(), body = await response.text();
    const signature = 'export async function renderMermaid(id, source)';
    expect(body).toContain(signature);
    await route.fulfill({ response, body: body.replace(signature, 'async function realRenderMermaid(id, source)') + `
export async function renderMermaid(id, source) {
 const state = window.__fullscreenAI, held = state?.armed && id.includes('fullscreen');
 if (held) state.armed = false;
 const result = await realRenderMermaid(id, source);
 if (held) { state.events.push({ phase: 'held', id, source }); await new Promise(resolve => { state.release = resolve; }); }
 state?.events.push({ phase: 'delivered', held, id, source }); return result;
}
` });
  });
}

for (const invalid of [false, true]) {
 for (const overview of [false, true]) {
  test(`${overview ? 'overview' : 'fullscreen'} survives an AI ${invalid ? 'invalid response without changing source' : 'valid source update'}`, async ({ page }) => {
    await setup(page); await start(page); await openFullscreen(page);
    await expect(dialog(page).locator('.mermaid-fullscreen-svg svg')).toContainText('SYNTHETIC initial');
    if (overview) await page.getByRole('button', { name: '一屏总览', exact: true }).click();
    await finish(page, invalid ? 'SYNTHETIC_INVALID_SOURCE' : latest);
    await expect(page.locator('.workbench-ai-status')).toHaveClass(new RegExp(invalid ? 'error' : 'success'));
    await expect(dialog(page).locator('.mermaid-fullscreen-svg svg')).toContainText(invalid ? 'SYNTHETIC initial' : 'SYNTHETIC latest 中文🧭');
    if (overview) {
      await expect(dialog(page).locator('.mermaid-fullscreen-header small')).toContainText('总览中');
      await expect.poll(() => dialog(page).locator('.mermaid-fullscreen-svg').evaluate(el => parseFloat((el as HTMLElement).style.width))).toBe(100);
    }
    await page.keyboard.press('Escape'); expect(await draftSource(page)).toBe(invalid ? initial : latest);
    expect(await page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString())).toBe(original);
  });
 }
}

for (const reopen of [false, true]) {
  test(`late fullscreen result cannot replace ${reopen ? 'a reopened instance' : 'a new AI source'}`, async ({ page }) => {
    await holdFullscreen(page); await setup(page);
    if (!reopen) await start(page);
    await page.evaluate(() => { (window as any).__fullscreenAI.armed = true; });
    await openFullscreen(page);
    await expect.poll(() => page.evaluate(() => (window as any).__fullscreenAI.events.some((e: any) => e.phase === 'held'))).toBe(true);
    if (reopen) { await page.keyboard.press('Escape'); await openFullscreen(page); }
    else await finish(page, latest);
    const svg = dialog(page).locator('.mermaid-fullscreen-svg svg');
    await expect(svg).toContainText(reopen ? 'SYNTHETIC initial' : 'SYNTHETIC latest 中文🧭');
    const newest = await svg.getAttribute('id'), markup = await svg.evaluate(el => el.outerHTML);
    expect(await page.evaluate(() => (window as any).__fullscreenAI.events.find((e: any) => e.phase === 'held').id)).not.toBe(newest);
    await page.evaluate(() => (window as any).__fullscreenAI.release());
    await expect.poll(() => page.evaluate(() => (window as any).__fullscreenAI.events.some((e: any) => e.phase === 'delivered' && e.held))).toBe(true);
    await expect(svg).toHaveAttribute('id', newest!); expect(await svg.evaluate(el => el.outerHTML)).toBe(markup);
    await page.keyboard.press('Escape'); expect(await draftSource(page)).toBe(reopen ? initial : latest);
  });
}
