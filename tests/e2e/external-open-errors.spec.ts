import { expect, test } from '@playwright/test';
import { launchDocument } from './helpers';

const original = '# SYNTHETIC external open\n\n```mermaid\nflowchart TD\n  A["SYNTHETIC_A"] --> B["SYNTHETIC_B"]\n```\n';
const encodingError = '仅支持 UTF-8 编码的 Markdown 文件';

for (const locale of ['zh-CN', 'en'] as const) {
  test(`external invalid file reports an error and preserves both drafts (${locale})`, async ({ page }) => {
    await launchDocument(page, original, 'SYNTHETIC_external.md');
    if (locale === 'en') await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    const dirty = original + '\nSYNTHETIC_UNSAVED\n';
    await page.locator('.cm-content').fill(dirty);
    await page.getByRole('button', { name: locale === 'en' ? 'Edit diagram on the visual canvas' : '在可视化画布中编辑图表', exact: true }).click();
    await page.locator('.workbench-tabs').getByRole('button', { name: locale === 'en' ? 'Source' : '源码', exact: true }).click();
    const source = page.getByRole('textbox', { name: locale === 'en' ? 'Mermaid source editor' : 'Mermaid 源码编辑器', exact: true });
    const draft = (await source.inputValue()).replace('SYNTHETIC_A', 'SYNTHETIC_DRAFT');
    await source.fill(draft);
    await page.evaluate(message => (window as any).__acceptance.emit('local-open-error', message), encodingError);
    await expect(page.locator('.toast')).toHaveText(locale === 'en' ? 'Markdown files must use UTF-8 encoding' : encodingError);
    await expect(source).toHaveValue(draft);
    expect((await page.locator('.cm-line').allTextContents()).join('\n')).toBe(dirty);
    expect(await page.evaluate(() => (window as any).__acceptance.saved)).toEqual([]);
    await expect(page.locator('.confirmation-dialog')).toHaveCount(0);
  });
}

test('a successful external open still replaces a clean document after an error', async ({ page }) => {
  await launchDocument(page, original, 'SYNTHETIC_external.md');
  await page.evaluate(message => (window as any).__acceptance.emit('local-open-error', message), encodingError);
  await expect(page.locator('.toast')).toHaveText(encodingError);
  const next = { path: '/acceptance/SYNTHETIC_next.md', name: 'SYNTHETIC_next.md', content: '# SYNTHETIC next document' };
  await page.evaluate(document => (window as any).__acceptance.emit('local-opened', { kind: 'file', document }), next);
  await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('SYNTHETIC_next');
  await expect(page.locator('.cm-content')).toHaveText(next.content);
});
