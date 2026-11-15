import { expect, test, type Page } from '@playwright/test';
import { launchDocument, mod, savedSource } from './helpers';

const json = JSON.stringify({ synthetic: true, items: Array.from({ length: 240 }, (_, id) => ({ id, label: `SYNTHETIC_${id}_中文` })) });
const invalid = json.slice(0, -1) + ',"broken":]';
const documentFor = (source: string) => `# SYNTHETIC formatting race\n\n\`\`\`json\n${source}\n\`\`\`\n\nSYNTHETIC_END\n`;
const changedMessage = '文档已变化，请重新格式化';
const editorText = (page: Page) => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString() as string);

// Run real Prettier, retaining its exact result or error until the test releases
// it. This controls delivery order in a browser; it is not native-app evidence.
async function holdFirstFormat(page: Page) {
  await page.addInitScript(() => {
    (window as any).__formatRace = { remaining: 1, events: [], ready: false };
  });
  await page.route(/\/lib\/code-blocks\.ts(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    const body = await response.text();
    const signature = 'export async function formatCode(source, language)';
    expect(body).toContain(signature);
    await route.fulfill({ response, body: body.replace(signature, 'async function formatCodeUncontrolled(source, language)') + `
export async function formatCode(source, language) {
  const state = window.__formatRace;
  const held = source.includes('"synthetic":true') && state.remaining-- > 0;
  state.events.push({ phase: 'started', held, language, length: source.length });
  let result, error, failed = false;
  try { result = await formatCodeUncontrolled(source, language); }
  catch (reason) { error = reason; failed = true; }
  if (held) {
    state.events.push({ phase: 'held', held, failed, result, error: failed ? String(error) : null });
    await new Promise(resolve => { state.release = resolve; state.ready = true; });
  }
  state.events.push({ phase: 'delivered', held, failed });
  if (failed) throw error;
  return result;
}
` });
  });
}

async function beginFormat(page: Page, failed: boolean) {
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+Home`);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press(`${mod}+Shift+F`);
  await expect.poll(() => page.evaluate(() => (window as any).__formatRace.ready)).toBe(true);
  const events = await page.evaluate(() => (window as any).__formatRace.events);
  expect(events.filter((event: any) => event.phase === 'held')).toHaveLength(1);
  expect(events.find((event: any) => event.phase === 'held').failed).toBe(failed);
  expect(events.some((event: any) => event.phase === 'delivered')).toBe(false);
}

async function releaseFormat(page: Page) {
  await page.evaluate(() => (window as any).__formatRace.release());
  await expect.poll(() => page.evaluate(() => (window as any).__formatRace.events.some((event: any) => event.phase === 'delivered' && event.held))).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const outcome of ['success', 'error'] as const) {
  for (const transition of ['continue typing', 'open different text', 'open identical text'] as const) {
    test(`late format ${outcome} after ${transition} preserves the current document`, async ({ page }, info) => {
      const original = documentFor(outcome === 'success' ? json : invalid);
      await holdFirstFormat(page);
      await launchDocument(page, original, 'SYNTHETIC_FORMAT_A.md');
      await beginFormat(page, outcome === 'error');
      let expected = original;
      if (transition === 'continue typing') {
        await page.locator('.cm-content').click();
        await page.keyboard.press(`${mod}+End`);
        await page.keyboard.type('SYNTHETIC_LATER_INPUT');
        expected += 'SYNTHETIC_LATER_INPUT';
      } else {
        expected = transition === 'open identical text' ? original : '# SYNTHETIC different document\n\nSYNTHETIC_TARGET_B\n';
        await page.evaluate(content => {
          const state = (window as any).__acceptance;
          state.nextFile = { path: '/acceptance/SYNTHETIC_FORMAT_B.md', name: 'SYNTHETIC_FORMAT_B.md', content };
          state.disk[state.nextFile.path] = content;
        }, expected);
        await page.getByRole('button', { name: '打开文件', exact: true }).click();
        await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('SYNTHETIC_FORMAT_B');
      }
      expect(await editorText(page)).toBe(expected);
      await releaseFormat(page);
      await info.attach('real-format-delivery', { body: JSON.stringify(await page.evaluate(() => (window as any).__formatRace.events)), contentType: 'application/json' });
      expect(await editorText(page)).toBe(expected);
      await expect(page.locator('.toast')).toHaveText(changedMessage);
      await expect(page.locator('.saved-state')).toContainText(transition === 'continue typing' ? '未保存' : '已保存到本地');
      expect(await savedSource(page)).toBe(expected);
      const destination = transition === 'continue typing' ? 'A' : 'B';
      expect(await page.evaluate(() => (window as any).__acceptance.saved.at(-1).path)).toBe(`/acceptance/SYNTHETIC_FORMAT_${destination}.md`);
      if (transition !== 'continue typing') expect(await page.evaluate(() => (window as any).__acceptance.disk['/acceptance/SYNTHETIC_FORMAT_A.md'])).toBe(original);
    });
  }
}

test('editing then undoing while format waits still invalidates the old document version', async ({ page }) => {
  const original = documentFor(json);
  await holdFirstFormat(page);
  await launchDocument(page, original, 'SYNTHETIC_FORMAT_A.md');
  await beginFormat(page, false);
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.type('SYNTHETIC_TEMPORARY');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await editorText(page)).toBe(original);
  await releaseFormat(page);
  expect(await editorText(page)).toBe(original);
  await expect(page.locator('.toast')).toHaveText(changedMessage);
});

for (const outcome of ['success', 'error'] as const) {
  test(`unchanged document still receives its genuine format ${outcome}`, async ({ page }) => {
    const original = documentFor(outcome === 'success' ? json : invalid);
    await holdFirstFormat(page);
    await launchDocument(page, original, 'SYNTHETIC_FORMAT_A.md');
    await beginFormat(page, outcome === 'error');
    await releaseFormat(page);
    if (outcome === 'success') {
      expect(await editorText(page)).toBe(documentFor(JSON.stringify(JSON.parse(json), null, 2)));
      await expect(page.locator('.toast')).toHaveText('JSON 代码已格式化，可撤销');
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      expect(await editorText(page)).toBe(original);
    } else {
      expect(await editorText(page)).toBe(original);
      await expect(page.locator('.toast')).toContainText('格式化失败');
      await expect(page.locator('.toast')).not.toContainText(changedMessage);
      await expect(page.locator('.toast')).not.toContainText('SYNTHETIC_0');
      const bounds = await page.locator('.toast').boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    }
  });
}
