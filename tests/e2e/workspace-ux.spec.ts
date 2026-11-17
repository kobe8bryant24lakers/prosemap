import { expect, test } from '@playwright/test';
import { editorSource, launchDocument, mod } from './helpers';

// Synthetic documents and IPC responses only; no real filesystem or model calls.
const source = '# Synthetic UX document\n\nA paragraph to keep intact.\n';

test('file search finds relative paths, recovers from no results and keeps keyboard focus', async ({ page }) => {
  await launchDocument(page, source, 'synthetic-ux.md');
  await page.evaluate(() => {
    const w = window as any, invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (command: string, args: any) => command === 'pick_markdown_folder'
      ? Promise.resolve({ root: '/acceptance', name: 'Synthetic workspace', files: [
        { path: '/acceptance/synthetic-ux.md', name: 'synthetic-ux.md', relativePath: 'synthetic-ux.md' },
        { path: '/acceptance/notes/中文.md', name: '中文.md', relativePath: 'notes/中文.md' },
        { path: '/acceptance/notes/Synthetic-plan.md', name: 'Synthetic-plan.md', relativePath: 'notes/Synthetic-plan.md' },
      ] }) : invoke(command, args);
  });
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  const search = page.getByRole('textbox', { name: '查找文件', exact: true });
  const files = page.locator('.file-list');
  await search.fill('  NOTES/  ');
  await expect(files.getByRole('button')).toHaveCount(2);
  await expect(page.locator('.file-scan-status')).toContainText('找到 2 / 3 个文件');
  await search.fill('中文');
  await expect(files.getByRole('button')).toHaveText(['notes/中文.md']);
  await search.fill('no-synthetic-match');
  await expect(page.getByText('没有匹配的文件', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  await expect(search).toBeFocused();
  await expect(files.getByRole('button')).toHaveCount(3);
  await expect(files.getByRole('button', { name: 'synthetic-ux.md', exact: true })).toHaveAttribute('aria-current', 'page');
  await search.fill('Synthetic-plan');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await search.fill('notes');
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await expect(page.getByRole('textbox', { name: 'Find files', exact: true })).toHaveValue('notes');
  await expect(page.locator('.file-scan-status')).toContainText('Found 2 of 3 files');
  expect(await editorSource(page)).toBe(source);
});

test('saving shows pending feedback and retains edits made during the write', async ({ page }) => {
  await launchDocument(page, source, 'synthetic-ux.md');
  await page.locator('.cm-content').fill(source + 'First edit');
  await page.evaluate(() => {
    const w = window as any, invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any) => {
      if (command === 'save_local_markdown') await new Promise<void>(resolve => { w.finishUxSave = resolve; });
      return invoke(command, args);
    };
  });
  const save = page.getByRole('button', { name: '保存', exact: true });
  await save.click();
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.saved-state')).toHaveText('正在保存…');
  await page.locator('.cm-content').fill(source + 'A newer edit');
  await page.evaluate(() => (window as any).finishUxSave());
  await expect(save).toBeEnabled();
  await expect(save).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.saved-state')).toHaveText('未保存');
  expect(await editorSource(page)).toBe(source + 'A newer edit');
  expect(await page.evaluate(() => (window as any).__acceptance.saved.at(-1).content)).toBe(source + 'First edit');

  await page.evaluate(() => { const w = window as any; w.__acceptance.saveError = 'Synthetic save failure'; w.finishUxSave = null; });
  await save.click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishUxSave)).toBe('function');
  await page.evaluate(() => (window as any).finishUxSave());
  await expect(save).toBeEnabled();
  await expect(page.locator('.toast')).toHaveText('Synthetic save failure');
  await expect(page.locator('.saved-state')).toHaveText('未保存');
});

test('compact assistant keeps the prompt and submission reachable, and protects IME confirmation', async ({ page }) => {
  await launchDocument(page, source, 'synthetic-ux.md');
  await page.getByRole('button', { name: '管理模型', exact: true }).click();
  await page.getByLabel('模型名称', { exact: true }).fill('synthetic-ux-model');
  await page.getByLabel('API 密钥', { exact: true }).fill('synthetic-placeholder-not-a-real-key');
  await page.getByRole('button', { name: '安全保存', exact: true }).click();
  await expect(page.locator('.settings-modal')).toHaveCount(0);
  await page.evaluate(() => {
    const w = window as any, invoke = w.__TAURI_INTERNALS__.invoke;
    w.uxRequests = 0;
    w.__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
      if (command === 'stream_ai') {
        w.uxRequests++;
        args.onEvent.onmessage({ type: 'delta', text: 'Synthetic suggestion.' });
        args.onEvent.onmessage({ type: 'done' });
        return Promise.resolve();
      }
      return invoke(command, args);
    };
  });
  await page.setViewportSize({ width: 900, height: 600 });
  await page.getByRole('button', { name: 'AI 文字助手', exact: true }).click();
  const panel = page.locator('.assistant-panel');
  const prompt = panel.locator('textarea');
  const run = panel.getByRole('button', { name: '生成建议', exact: true });
  await expect(prompt).toBeInViewport({ ratio: 1 });
  await expect(run).toBeInViewport({ ratio: 1 });
  await panel.getByRole('combobox', { name: '处理方式', exact: true }).selectOption('custom');
  await expect(run).toBeDisabled();
  await prompt.press(`${mod}+Enter`);
  expect(await page.evaluate(() => (window as any).uxRequests)).toBe(0);
  await panel.getByRole('combobox', { name: '处理方式', exact: true }).selectOption('polish');
  await expect(panel.getByRole('combobox', { name: '处理方式', exact: true })).toHaveValue('polish');
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await expect(prompt).toBeInViewport({ ratio: 1 });
  await expect(panel.getByRole('button', { name: 'Generate suggestion', exact: true })).toBeInViewport({ ratio: 1 });
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  await prompt.fill('Synthetic instruction');
  await prompt.dispatchEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true });
  expect(await page.evaluate(() => (window as any).uxRequests)).toBe(0);
  await prompt.press('Enter');
  await expect(prompt).toHaveValue('Synthetic instruction\n');
  await panel.locator('.assistant-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(run).toBeInViewport({ ratio: 1 });
  await prompt.press(`${mod}+Enter`);
  await expect(page.locator('.diff-modal')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).uxRequests)).toBe(1);
  expect(await editorSource(page)).toBe(source);
});

test('narrow layout retains document identity, file navigation and both document views', async ({ page }) => {
  await launchDocument(page, source, 'synthetic-ux.md');
  await page.setViewportSize({ width: 375, height: 812 });
  const name = page.getByRole('textbox', { name: '文档名称', exact: true });
  await expect(name).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeInViewport({ ratio: 1 });
  const editor = await page.locator('.editor-pane').boundingBox();
  const preview = await page.locator('.preview-pane').boundingBox();
  expect(editor!.width).toBeGreaterThan(350);
  expect(preview!.y).toBeGreaterThanOrEqual(editor!.y + editor!.height - 1);
  await expect(page.getByRole('button', { name: '编辑与预览', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择文件夹', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '关闭文件列表', exact: true }).click();
  await page.getByRole('button', { name: '纯编辑', exact: true }).click();
  await page.locator('.cm-content').fill(source + 'Narrow edit');
  await page.getByRole('button', { name: '纯预览', exact: true }).click();
  await expect(page.locator('.markdown-body')).toContainText('Narrow edit');
  await page.getByRole('button', { name: '编辑与预览', exact: true }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await editorSource(page)).toBe(source);
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await expect(page.getByRole('button', { name: 'Edit & preview', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
