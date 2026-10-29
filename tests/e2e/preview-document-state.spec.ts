import { test, expect } from '@playwright/test';
import { launchDocument, savedSource } from './helpers';

const source = '# Synthetic preview state\n\n[Missing heading](#missing-synthetic-heading)\n\n[Attachment](synthetic-attachment.txt)\n';

for (const action of ['open', 'reload', 'save-as'] as const) {
  test(`preview link errors belong to the document session: ${action}`, async ({ page }) => {
    await launchDocument(page, source);
    const error = page.locator('.preview-link-error');
    await page.getByRole('link', { name: 'Missing heading', exact: true }).click();
    await expect(error).toHaveText('未找到对应的文档标题');

    let expected = source;
    if (action === 'open') {
      expected = '# Synthetic replacement\n\nA different document.\n';
      await page.evaluate(content => {
        const state = (window as any).__acceptance;
        state.nextFile = { path: '/acceptance/replacement.md', name: 'replacement.md', content };
        state.disk[state.nextFile.path] = content;
      }, expected);
      await page.getByRole('button', { name: '打开文件', exact: true }).click();
      await expect(page.locator('.preview-pane').getByRole('heading', { name: 'Synthetic replacement', exact: true })).toBeVisible();
    } else if (action === 'reload') {
      await page.getByRole('button', { name: '重新载入', exact: true }).click();
      await expect(page.locator('.toast')).toContainText('已重新载入');
    } else {
      await page.getByRole('textbox', { name: '文档名称', exact: true }).fill('synthetic-copy');
      await page.getByRole('button', { name: '另存为', exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as any).__acceptance.saved.at(-1)?.path)).toBe('/acceptance/synthetic-copy.md');
    }
    await expect(error).toHaveCount(0);
    expect(await savedSource(page)).toBe(expected);
  });
}

test('a delayed attachment error cannot appear in a subsequently opened document', async ({ page }) => {
  await launchDocument(page, source);
  await page.evaluate(() => {
    const w = window as any, invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any) => {
      if (command === 'open_relative_file') {
        try { await new Promise((_resolve, reject) => { w.rejectOldAttachment = () => reject(new Error('Synthetic old-document attachment error')); }); }
        finally { w.oldAttachmentSettled = true; }
        return;
      }
      return invoke(command, args);
    };
  });
  await page.getByRole('link', { name: 'Attachment', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).rejectOldAttachment)).toBe('function');
  const replacement = '# Synthetic current document\n\nCurrent content stays intact.\n';
  await page.evaluate(content => {
    const state = (window as any).__acceptance;
    state.nextFile = { path: '/acceptance/current.md', name: 'current.md', content };
    state.disk[state.nextFile.path] = content;
  }, replacement);
  await page.getByRole('button', { name: '打开文件', exact: true }).click();
  await expect(page.locator('.preview-pane').getByRole('heading', { name: 'Synthetic current document', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).rejectOldAttachment());
  await expect.poll(() => page.evaluate(() => (window as any).oldAttachmentSettled)).toBe(true);
  expect(await savedSource(page)).toBe(replacement);
  await expect(page.locator('.preview-link-error')).toHaveCount(0);
});
