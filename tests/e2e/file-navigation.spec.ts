import { test, expect } from '@playwright/test';
import { launchDocument, savedSource } from './helpers';

const source = '# Synthetic workspace file\n\nOriginal content.\n';

test('saving into the open workspace adds and highlights the file without duplicates', async ({ page }) => {
  await launchDocument(page, source);
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await page.getByRole('button', { name: '关闭文件列表', exact: true }).click();
  await page.getByRole('textbox', { name: '文档名称', exact: true }).fill('new-copy');
  await page.getByRole('button', { name: '另存为', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('new-copy');
  await page.getByRole('button', { name: '本地文件', exact: true }).click();
  const files = page.locator('.file-list');
  await expect(files.getByRole('button', { name: 'new-copy.md', exact: true })).toHaveClass('active');
  expect(await savedSource(page)).toBe(source);
  expect(await savedSource(page)).toBe(source);
  await expect(files.getByRole('button')).toHaveCount(2);
  await expect(files.getByRole('button').first()).toHaveText('acceptance.md');
  await files.getByRole('button', { name: 'acceptance.md', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('acceptance');
  expect(await savedSource(page)).toBe(source);

  await page.evaluate(() => { (window as any).__acceptance.cancelSave = true; });
  await page.getByRole('textbox', { name: '文档名称', exact: true }).fill('cancelled');
  const savesBeforeCancel = await page.evaluate(() => (window as any).__acceptance.calls.filter((call: any) => call.command === 'save_local_markdown').length);
  await page.getByRole('button', { name: '另存为', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__acceptance.calls.filter((call: any) => call.command === 'save_local_markdown').length)).toBe(savesBeforeCancel + 1);
  await expect(files.getByRole('button')).toHaveCount(2);
  await page.evaluate(() => { const state = (window as any).__acceptance; state.cancelSave = false; state.saveError = 'Synthetic write failure'; });
  await page.getByRole('button', { name: '另存为', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('Synthetic write failure');
  await expect(files.getByRole('button')).toHaveCount(2);
});

test('a save finishing after the workspace changes cannot add a file to the wrong folder', async ({ page }) => {
  await launchDocument(page, source);
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await expect(page.locator('.file-list').getByRole('button', { name: 'acceptance.md', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const w = window as any, invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any) => {
      if (command === 'save_local_markdown') await new Promise<void>(resolve => { w.finishWorkspaceSave = resolve; });
      if (command === 'pick_markdown_folder') return Promise.resolve({ root: '/second-workspace', name: 'Second synthetic workspace', files: [] });
      return invoke(command, args);
    };
  });
  await page.getByRole('textbox', { name: '文档名称', exact: true }).fill('late-copy');
  await page.getByRole('button', { name: '另存为', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishWorkspaceSave)).toBe('function');
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await expect(page.locator('.file-explorer')).toContainText('Second synthetic workspace');
  await expect(page.locator('.toast')).toContainText('已打开文件夹 Second synthetic workspace');
  await page.evaluate(() => (window as any).finishWorkspaceSave());
  await expect(page.locator('.toast')).toContainText('已保存为 late-copy.md');
  await expect(page.locator('.file-explorer')).toContainText('此文件夹中没有 Markdown 文件');
  await expect(page.locator('.file-explorer').getByRole('button', { name: 'late-copy.md', exact: true })).toHaveCount(0);
});

test('native string errors retain the file rejection reason and retranslate with the UI', async ({ page }) => {
  await launchDocument(page, source);
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await expect(page.locator('.file-list').getByRole('button', { name: 'acceptance.md', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const w = window as any, invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
      if (command === 'pick_markdown_file' || command === 'read_local_markdown') return Promise.reject(w.fileRejection);
      if (command === 'pick_markdown_folder') return Promise.resolve({ root: '/acceptance', name: 'acceptance', files: [{ path: '/acceptance/rejected.md', name: 'rejected.md', relativePath: 'rejected.md' }] });
      return invoke(command, args);
    };
  });
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await expect(page.locator('.file-list').getByRole('button', { name: 'rejected.md', exact: true })).toBeVisible();
  for (const [zh, en] of [
    ['仅支持 UTF-8 编码的 Markdown 文件', 'Markdown files must use UTF-8 encoding'],
    ['Markdown 文件不能超过 16 MB', 'Markdown files must be no larger than 16 MB'],
  ]) for (const entry of ['打开文件', 'rejected.md']) {
    await page.evaluate(reason => { (window as any).fileRejection = reason; }, zh);
    await page.getByRole('button', { name: entry, exact: true }).click();
    await expect(page.locator('.toast')).toHaveText(zh);
    await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    await expect(page.locator('.toast')).toHaveText(en);
    await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
    await expect(page.locator('.toast')).toHaveText(zh);
    expect(await savedSource(page)).toBe(source);
    await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('acceptance');
  }
});
