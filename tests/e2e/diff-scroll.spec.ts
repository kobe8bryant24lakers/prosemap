import { test, expect, type Page } from '@playwright/test';
import { launchDocument, mod } from './helpers';

const longLine = 'SYNTHETIC_LONG_START ' + 'abcdef0123456789_'.repeat(100) + ' SYNTHETIC_LONG_END\n';
const original = '# SYNTHETIC DIFF SCROLL\n' + Array.from({ length: 120 }, (_, i) => `SYNTHETIC A ${i}: Review.\n`).join('') + longLine + 'SYNTHETIC_END\n';
const modified = original.replaceAll('SYNTHETIC A ', 'SYNTHETIC B ');

async function prepare(page: Page, locale: 'en' | 'zh-CN') {
  await launchDocument(page, original, 'synthetic-diff-scroll.md', 'ready', 'memory');
  await page.evaluate((response) => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command === 'stream_ai') {
        args.onEvent.onmessage({ type: 'reasoning_delta', text: 'SYNTHETIC reasoning\n'.repeat(30) });
        args.onEvent.onmessage({ type: 'delta', text: response });
        args.onEvent.onmessage({ type: 'done' });
        return;
      }
      return invoke(command, args);
    };
  }, modified);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('模型名称', { exact: true }).fill('SYNTHETIC_MODEL');
  await page.getByLabel('API 密钥', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
  await page.getByRole('button', { name: '安全保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  if (locale === 'en') await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
}

async function geometry(page: Page) {
  return page.locator('.diff-content').evaluate(e => {
    const footer = document.querySelector('.diff-footer')!;
    const r = footer.getBoundingClientRect();
    return { top: e.scrollTop, left: e.scrollLeft, width: e.clientWidth, height: e.clientHeight, sw: e.scrollWidth, sh: e.scrollHeight, footer: { x: r.x, y: r.y, width: r.width, height: r.height }, reachable: [...footer.querySelectorAll('button')].every(b => {
      const r = b.getBoundingClientRect();
      return !b.disabled && r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }) };
  });
}

async function savedSource(page: Page) {
  const count = await page.evaluate(() => (window as any).__acceptance.saved.length);
  await page.keyboard.press(`${mod}+s`);
  await expect.poll(() => page.evaluate(() => (window as any).__acceptance.saved.length)).toBe(count + 1);
  return page.evaluate<string>(() => (window as any).__acceptance.saved.at(-1).content);
}

for (const locale of ['en', 'zh-CN'] as const) for (const size of [{ width: 1440, height: 900 }, { width: 620, height: 560 }]) {
  test(`long diff scroll keeps review actions reachable ${locale} ${size.width}`, async ({ page }) => {
    await prepare(page, locale);
    await page.setViewportSize(size);
    const en = locale === 'en';
    for (const accept of [false, true]) {
      await page.getByRole('button', { name: en ? 'AI writing assistant' : 'AI 文字助手', exact: true }).click();
      await page.getByRole('button', { name: en ? 'Generate suggestion' : '生成建议', exact: true }).click();
      await expect(page.getByRole('button', { name: en ? 'Accept and replace' : '接受并替换', exact: true })).toBeEnabled();
      await expect(page.locator('.diff-line.removed')).toHaveCount(120);
      await expect(page.locator('.diff-line.added')).toHaveCount(120);
      const start = await geometry(page);
      expect(start.reachable).toBe(true);
      expect(start.sh).toBeGreaterThan(start.height * 5);
      expect(start.sw).toBeGreaterThan(start.width * 5);
      await page.locator('.diff-content').hover();
      await page.mouse.wheel(0, 20000);
      await expect.poll(async () => (await geometry(page)).top).toBeGreaterThan(0);
      const bottom = await geometry(page);
      expect(bottom.footer).toEqual(start.footer);
      expect(bottom.reachable).toBe(true);
      await page.mouse.wheel(20000, 0);
      await expect.poll(async () => (await geometry(page)).left).toBeGreaterThan(0);
      const right = await geometry(page);
      expect(right.footer).toEqual(start.footer);
      expect(right.reachable).toBe(true);
      // The right end of the long line must be within the review viewport.
      await expect.poll(async () => {
        const g = await geometry(page); return Math.abs(g.sw - g.width - g.left);
      }).toBeLessThan(2);
      await page.getByRole('button', { name: en ? 'AI reasoning' : 'AI 思考过程' }).click();
      expect((await geometry(page)).reachable).toBe(true);
      await page.getByRole('button', { name: accept ? (en ? 'Accept and replace' : '接受并替换') : (en ? 'Reject' : '拒绝'), exact: true }).click();
      await expect(page.locator('.diff-modal')).toHaveCount(0);
      expect(await savedSource(page)).toBe(accept ? modified : original);
      if (accept) {
        await page.getByRole('button', { name: en ? 'Undo' : '撤销', exact: true }).click();
        expect(await savedSource(page)).toBe(original);
      }
    }
  });
}
