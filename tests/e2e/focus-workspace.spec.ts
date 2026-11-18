import { expect, test } from '@playwright/test';
import { editorSource, launchDocument, mod, savedSource } from './helpers';

const draft = '# Synthetic writing session\n\nA paragraph to revise.\n';

test('focus writing retains the selection, file filter, AI draft, save and undo in the same document', async ({ page }) => {
  await launchDocument(page, draft, 'synthetic-focus.md');
  const editor = page.locator('.cm-content');
  await editor.focus();
  await page.keyboard.press(`${mod}+Home`);
  await page.keyboard.press('Shift+End');
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await page.getByLabel('查找文件', { exact: true }).fill('synthetic-focus');
  await page.getByRole('button', { name: 'AI 文字助手', exact: true }).click();
  await page.locator('.assistant-compose textarea').fill('Synthetic unfinished instructions');
  const enter = page.getByRole('button', { name: '专注写作', exact: true });
  await enter.click();
  await expect(editor).toBeFocused();
  const firstLine = editor.locator('.cm-line').first();
  await expect(firstLine).toBeInViewport({ ratio: 0.95 });
  const measure = (await firstLine.boundingBox())!;
  expect(measure.width).toBeGreaterThan(500);
  expect(measure.width).toBeLessThan(860);
  expect(Math.abs(measure.x + measure.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(24);
  await expect(page.locator('.preview-pane')).toBeHidden();
  await expect(page.locator('.file-explorer')).toBeHidden();
  await expect(page.locator('.assistant-panel')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('prosemap.viewMode'))).toBe('split');
  await page.keyboard.insertText('# Revised synthetic title');
  expect(await savedSource(page)).toBe(draft.replace('# Synthetic writing session', '# Revised synthetic title'));
  await page.keyboard.press('Escape');
  await expect(enter).toBeFocused();
  await expect(page.locator('.preview-pane')).toBeVisible();
  await expect(page.getByLabel('查找文件', { exact: true })).toHaveValue('synthetic-focus');
  await expect(page.locator('.assistant-compose textarea')).toHaveValue('Synthetic unfinished instructions');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await editorSource(page)).toBe(draft);
});

test('focus reading keeps a narrow preview usable and restores its original layout', async ({ page }) => {
  await launchDocument(page, draft.repeat(40), 'synthetic-reading.md');
  await page.getByRole('combobox', { name: '界面语言' }).selectOption('en');
  await page.setViewportSize({ width: 390, height: 740 });
  await page.locator('.view-mode-switch button').nth(1).click();
  const preview = page.locator('.preview-scroll');
  const moveToLine = (line: number) => preview.locator(`[data-source-line="${line}"]`).evaluate(node => {
    const scroll = node.closest('.preview-scroll')!;
    scroll.scrollTop += node.getBoundingClientRect().top - scroll.getBoundingClientRect().top + 4;
  });
  const readingLine = () => preview.evaluate(el => {
    const top = el.getBoundingClientRect().top;
    return Number([...el.querySelectorAll<HTMLElement>('[data-source-line]')].filter(node => node.getBoundingClientRect().top <= top + 1).at(-1)?.dataset.sourceLine);
  });
  await moveToLine(61);
  await expect.poll(readingLine).toBe(61);
  const enter = page.getByRole('button', { name: 'Focus on reading', exact: true });
  await enter.click();
  await expect(preview).toBeFocused();
  await expect(preview).toBeInViewport({ ratio: 0.95 });
  await expect(page.locator('.cm-content')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect.poll(readingLine).toBe(61);
  await moveToLine(76);
  await expect.poll(readingLine).toBe(76);
  await page.getByRole('button', { name: 'Exit focus', exact: true }).click();
  await expect(enter).toBeFocused();
  await expect.poll(readingLine).toBe(76);
  await expect(page.locator('.view-mode-switch button').nth(1)).toHaveAttribute('aria-pressed', 'true');
  expect(await editorSource(page)).toBe(draft.repeat(40));
});

test('a search or IME Escape is handled before leaving focus writing', async ({ page }) => {
  await launchDocument(page, draft);
  await page.getByRole('button', { name: '专注写作' }).click();
  const exit = page.getByRole('button', { name: '退出专注' });
  await page.locator('.cm-content').dispatchEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true });
  await expect(exit).toBeVisible();
  await page.keyboard.press(`${mod}+f`);
  await expect(page.locator('.cm-search')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-search')).toBeHidden();
  await expect(exit).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(exit).toBeHidden();
});

test('a narrow editor keeps history and search visible and formats the existing selection on demand', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await launchDocument(page, draft);
  const more = page.getByRole('button', { name: '格式', exact: true });
  const bold = page.getByRole('button', { name: '粗体', exact: true });
  const undo = page.getByRole('button', { name: '撤销', exact: true });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(bold).toBeHidden();
  for (const command of [undo, page.getByRole('button', { name: '重做', exact: true }), page.getByRole('button', { name: '查找与替换', exact: true })]) {
    await expect(command).toBeInViewport();
    expect(Math.abs((await command.boundingBox())!.y - (await more.boundingBox())!.y)).toBeLessThan(4);
  }
  await page.locator('.cm-content').focus();
  await page.keyboard.press(`${mod}+Home`);
  await page.keyboard.press('Shift+End');
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await bold.click();
  await expect.poll(() => editorSource(page)).toBe(draft.replace('# Synthetic writing session', '**# Synthetic writing session**'));
  await more.click();
  await undo.click();
  await expect.poll(() => editorSource(page)).toBe(draft);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(bold).toBeInViewport();
  await expect(more).toBeHidden();
});

test('a narrow editor can open its assistant and diagram canvas without switching views', async ({ page }) => {
  await launchDocument(page, draft);
  await page.setViewportSize({ width: 375, height: 740 });
  await page.getByRole('button', { name: '纯编辑', exact: true }).click();
  const assistant = page.getByRole('button', { name: 'AI 文字助手', exact: true });
  await expect(assistant).toBeInViewport();
  await assistant.click();
  await expect(page.locator('.assistant-compose textarea')).toBeInViewport();
  await page.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
  await page.getByRole('button', { name: '格式', exact: true }).click();
  await page.getByRole('button', { name: '新建图表', exact: true }).click();
  await expect(page.locator('.mermaid-workbench')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '纯编辑', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await editorSource(page)).toBe(draft);
});
