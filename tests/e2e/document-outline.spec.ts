import { expect, test } from '@playwright/test';
import { editorSource, launchDocument, mod } from './helpers';

// All document content here is synthetic; native file IPC uses the shared stub.
const source = '# Synthetic root\n\n## First\n\n### Nested\n\n```md\n# Fake heading\n```\n\n'
  + Array.from({ length: 55 }, (_, i) => `Synthetic paragraph ${i}.\n\n`).join('')
  + '## Repeated\n\nText\n\n## Repeated\n\n' + 'Synthetic ending.\n\n'.repeat(40);

for (const mode of ['纯编辑', '纯预览', '左编辑右预览']) {
  test(`synthetic outline navigates duplicate headings without editing in ${mode}`, async ({ page }) => {
    await launchDocument(page, source, 'synthetic-outline.md');
    await page.getByRole('button', { name: mode, exact: true }).click();
    await page.getByRole('button', { name: '大纲', exact: true }).click();
    const outline = page.getByRole('complementary', { name: '文档大纲' });
    await expect(outline.locator('.outline-link')).toHaveCount(5);
    await outline.getByRole('button', { name: 'H2 Repeated', exact: true }).nth(1).click();
    await expect(outline.getByRole('button', { name: 'H2 Repeated', exact: true }).nth(1)).toHaveAttribute('aria-current', 'location');
    if (mode !== '纯编辑') {
      await expect.poll(() => page.locator('#repeated-1').evaluate(el => {
        const scroller = el.closest('.preview-scroll')!;
        return Math.abs(el.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
      })).toBeLessThan(85);
    }
    if (mode !== '纯预览') {
      await expect.poll(() => page.locator('.cm-scroller').evaluate(el => el.scrollTop)).toBeGreaterThan(500);
    }
    expect(await editorSource(page)).toBe(source);
    expect(await page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.selection.main.from))
      .toBe(source.lastIndexOf('## Repeated'));
    await outline.getByRole('button', { name: '收起 First', exact: true }).click();
    await expect(outline.getByRole('button', { name: 'H3 Nested', exact: true })).toHaveCount(0);
    await outline.getByRole('button', { name: '展开 First', exact: true }).click();
    await expect(outline.getByRole('button', { name: 'H3 Nested', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '收起大纲', exact: true }).click();
    await expect(outline).toHaveCount(0);
    await expect(page.getByRole('button', { name: '大纲', exact: true })).toBeFocused();
  });
}

test('synthetic outline updates with edits and undo, resets on file switch and persists panel preference', async ({ page }) => {
  await launchDocument(page, '# Synthetic original\n', 'synthetic-outline.md');
  const toggle = page.getByRole('button', { name: '大纲', exact: true });
  await toggle.click();
  await page.locator('.cm-content').fill('# Synthetic updated\n\n## Child');
  await expect(page.locator('.outline-link')).toHaveText(['H1Synthetic updated', 'H2Child']);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('.outline-link')).toHaveText(['H1Synthetic original']);
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.cm-content').fill('Synthetic plain text');
  await expect(page.getByText('暂无标题。使用 Markdown 标题（# 至 ######）创建大纲。')).toBeVisible();
  await page.locator('.cm-content').press(`${mod}+z`);
  await page.evaluate(() => { (window as any).__acceptance.nextFile = { path: '/acceptance/synthetic-next.md', name: 'synthetic-next.md', content: '# Synthetic next' }; });
  await page.getByRole('button', { name: '打开文件', exact: true }).click();
  await page.getByRole('button', { name: '放弃并打开', exact: true }).click();
  await expect(page.locator('.outline-link')).toHaveText(['H1Synthetic next']);
  await toggle.click();
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('synthetic outline is reachable on narrow screens, shares the file panel and translates', async ({ page }, testInfo) => {
  await launchDocument(page, source, 'synthetic-outline.md');
  await page.getByRole('button', { name: '本地文件', exact: true }).click();
  await page.getByRole('button', { name: '大纲', exact: true }).click();
  await expect(page.getByRole('complementary', { name: '本地 Markdown 文件' })).toHaveCount(0);
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await expect(page.getByRole('complementary', { name: 'Document outline' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('synthetic-outline-desktop.png') });
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(page.getByRole('button', { name: 'Outline', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Collapse outline', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Collapse outline', exact: true }).click();
  await page.getByRole('button', { name: 'Outline', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Document outline' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('synthetic-outline-mobile.png') });
});


for (const mode of ['纯预览', '左编辑右预览']) {
  test(`synthetic nested HTML headings reveal their collapsed container in ${mode}`, async ({ page }) => {
    const nested = '# Synthetic root\n\n<details>\n<summary>Synthetic details</summary>\n\n'
      + 'Synthetic content before heading.\n\n'.repeat(25)
      + '<h2>Hidden heading</h2>\n\nSynthetic text\n\n</details>\n\n'
      + 'Synthetic content after details.\n\n'.repeat(35);
    await launchDocument(page, nested, 'synthetic-nested-outline.md');
    await page.getByRole('button', { name: mode, exact: true }).click();
    await page.getByRole('button', { name: '大纲', exact: true }).click();
    await page.getByRole('button', { name: 'H2 Hidden heading', exact: true }).click();
    await expect(page.locator('.markdown-body details')).toHaveAttribute('open', '');
    await expect.poll(() => page.locator('#hidden-heading').evaluate(el =>
      Math.abs(el.getBoundingClientRect().top - el.closest('.preview-scroll')!.getBoundingClientRect().top)))
      .toBeLessThan(85);
    expect(await editorSource(page)).toBe(nested);
  });
}
