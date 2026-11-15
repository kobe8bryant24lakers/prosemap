import { test, expect, type Page } from '@playwright/test';
import { launchDocument, mod, savedSource } from './helpers';

const source = '# Synthetic shortcuts\n\nalpha beta\n\nomega\n';

async function selectRange(page: Page, from: number, to: number) {
  await page.locator('.cm-content').focus();
  await page.keyboard.press(`${mod}+Home`);
  for (let i = 0; i < from; i++) await page.keyboard.press('ArrowRight');
  const key = from <= to ? 'Shift+ArrowRight' : 'Shift+ArrowLeft';
  for (let i = 0; i < Math.abs(to - from); i++) await page.keyboard.press(key);
}

async function saveWithoutMovingFocus(page: Page) {
  const count = await page.evaluate(() => (window as any).__acceptance.saved.length);
  await page.keyboard.press(`${mod}+s`);
  await expect.poll(() => page.evaluate(() => (window as any).__acceptance.saved.length)).toBe(count + 1);
  return page.evaluate<string>(() => (window as any).__acceptance.saved.at(-1).content);
}

test('italic shortcut takes precedence over syntax selection and toggles the retained toolbar selection', async ({ page }) => {
  await launchDocument(page, source);
  const start = source.indexOf('alpha');
  await selectRange(page, start, start + 5);
  await page.getByRole('button', { name: '斜体', exact: true }).click();
  expect(await saveWithoutMovingFocus(page)).toBe(source.replace('alpha', '*alpha*'));
  await page.keyboard.press(`${mod}+i`);
  expect(await saveWithoutMovingFocus(page)).toBe(source);
  await page.keyboard.press(`${mod}+i`);
  expect(await saveWithoutMovingFocus(page)).toBe(source.replace('alpha', '*alpha*'));
  await page.keyboard.press(`${mod}+z`);
  expect(await saveWithoutMovingFocus(page)).toBe(source);
  await page.keyboard.press(`${mod}+Shift+z`);
  expect(await saveWithoutMovingFocus(page)).toBe(source.replace('alpha', '*alpha*'));
});

test('italic shortcut preserves bold markers for reverse selections and selects the empty placeholder', async ({ page }) => {
  const bold = source.replace('alpha', '**alpha**');
  await launchDocument(page, bold);
  const start = bold.indexOf('alpha');
  await selectRange(page, start + 5, start);
  await page.keyboard.press(`${mod}+i`);
  expect(await saveWithoutMovingFocus(page)).toBe(source.replace('alpha', '***alpha***'));
  await page.keyboard.press(`${mod}+i`);
  expect(await saveWithoutMovingFocus(page)).toBe(bold);
  await selectRange(page, bold.indexOf('omega'), bold.indexOf('omega'));
  await page.keyboard.press(`${mod}+i`);
  expect(await saveWithoutMovingFocus(page)).toBe(bold.replace('omega', '*文字*omega'));
  await page.keyboard.insertText('Synthetic replacement');
  expect(await saveWithoutMovingFocus(page)).toBe(bold.replace('omega', '*Synthetic replacement*omega'));
});

test('Markdown shortcut priority preserves bold and link toggles without editing from another input', async ({ page }) => {
  await launchDocument(page, source);
  const start = source.indexOf('alpha');
  for (const [key, formatted] of [['b', '**alpha**'], ['k', '[alpha](https://)']]) {
    await selectRange(page, start, start + 5);
    await page.keyboard.press(`${mod}+${key}`);
    expect(await saveWithoutMovingFocus(page)).toBe(source.replace('alpha', formatted));
    await page.keyboard.press(`${mod}+${key}`);
    expect(await saveWithoutMovingFocus(page)).toBe(source);
  }
  await page.getByRole('textbox', { name: '文档名称', exact: true }).focus();
  await page.keyboard.press(`${mod}+i`);
  expect(await savedSource(page)).toBe(source);
});
