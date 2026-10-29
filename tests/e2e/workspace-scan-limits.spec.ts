import { test, expect } from '@playwright/test';
import { launchDocument, savedSource } from './helpers';

const source = '# Synthetic workspace scan\n\nCurrent document stays intact.\n';

test('bounded workspace lists show count and both scan limits in either language', async ({ page }) => {
  await launchDocument(page, source);
  await page.evaluate(() => {
    const w = window as any, invoke = w.__TAURI_INTERNALS__.invoke;
    w.scanWorkspace = {
      root: '/synthetic-scan', name: 'Synthetic scan',
      files: Array.from({ length: 2000 }, (_, index) => {
        const name = `synthetic-${String(index).padStart(4, '0')}.md`;
        return { path: `/synthetic-scan/${name}`, name, relativePath: name };
      }),
      scanLimits: { fileCount: 2000, depth: 12 },
    };
    w.__TAURI_INTERNALS__.invoke = (command: string, args: any) => command === 'pick_markdown_folder'
      ? Promise.resolve(w.scanWorkspace) : invoke(command, args);
  });
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  const status = page.locator('.file-scan-status');
  await expect(status).toContainText('已列出 2,000 个文件');
  await expect(status).toContainText('本次扫描达到 2,000 个文件上限，可能还有文件未显示。');
  await expect(status).toContainText('超过 12 层的子文件夹未扫描。');
  await expect(page.locator('.file-list button')).toHaveCount(2000);
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await expect(status).toContainText('Files listed: 2,000');
  await expect(status).toContainText('This scan reached the 2,000-file limit. Additional files may be omitted.');
  await expect(status).toContainText('Folders deeper than 12 levels were not scanned.');
  await page.setViewportSize({ width: 900, height: 600 });
  await page.locator('.file-list button').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.file-list button').last()).toBeVisible();
  const info = await status.boundingBox();
  const list = await page.locator('.file-list').boundingBox();
  expect(info && list && info.y + info.height <= list.y + 1 && list.height > 100).toBe(true);
  await page.evaluate(() => { (window as any).scanWorkspace = { root: '/synthetic-empty', name: 'Synthetic empty', files: [], scanLimits: { fileCount: null, depth: null } }; });
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  await expect(status).toHaveText('Files listed: 0');
  await expect(page.locator('.file-explorer-empty')).toHaveText('No Markdown files in this folder.');
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  expect(await savedSource(page)).toBe(source);
});

test('an empty bounded scan does not claim that the entire folder has no Markdown files', async ({ page }) => {
  await launchDocument(page, source);
  await page.evaluate(() => {
    const w = window as any, invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (command: string, args: any) => command === 'pick_markdown_folder'
      ? Promise.resolve({ root: '/synthetic-deep', name: 'Synthetic deep', files: [], scanLimits: { fileCount: null, depth: 12 } })
      : invoke(command, args);
  });
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await expect(page.locator('.file-explorer-empty')).toHaveText('扫描范围内没有 Markdown 文件。');
  await expect(page.locator('.file-scan-status')).toContainText('超过 12 层的子文件夹未扫描。');
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await expect(page.locator('.file-explorer-empty')).toHaveText('No Markdown files were found within the scan limits.');
});
