import { test, expect } from '@playwright/test';
import { launchDocument, mod, savedSource } from './helpers';

test('status counts visible Unicode characters and updates without changing source', async ({ page }) => {
  await launchDocument(page, '中文 😀\n');
  const status = page.locator('.statusbar');
  await expect(status).toContainText('3 字');
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.insertText('👨‍👩‍👧‍👦 e\u0301 🇨🇳 👍🏽\n');
  await expect(status).toContainText('7 字');
  await page.keyboard.insertText('```js\nconst x = 1;\n```\n');
  // Non-whitespace source punctuation and code still count.
  await expect(status).toContainText('24 字');
  expect(await savedSource(page)).toBe('中文 😀\n👨‍👩‍👧‍👦 e\u0301 🇨🇳 👍🏽\n```js\nconst x = 1;\n```\n');
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await expect(status).toContainText('24 chars');
});

test('status follows the selection head in both directions and resets for another file', async ({ page }) => {
  await launchDocument(page, 'one\ntwo\nthree\nfour\n');
  const status = page.locator('.statusbar');
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+Home`);
  await page.keyboard.press('Shift+ArrowDown');
  await expect(status).toContainText('行 2 ·');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(status).toContainText('行 3 ·');
  await page.keyboard.press('ArrowLeft');
  await expect(status).toContainText('行 1 ·');
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.press('Shift+ArrowUp');
  await expect(status).toContainText('行 4 ·');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(status).toContainText('行 3 ·');
  await page.evaluate(() => { (window as any).__acceptance.nextFile = { path: '/acceptance/second.md', name: 'second.md', content: 'Second synthetic file' }; });
  await page.getByRole('button', { name: '打开文件', exact: true }).click();
  await expect(status).toContainText('行 1 ·');
  await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('second');
});
