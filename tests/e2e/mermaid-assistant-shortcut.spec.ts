import { test, expect } from '@playwright/test';
import { launchDocument, mod, savedSource } from './helpers';

const source = 'Synthetic before\n\n```mermaid\nflowchart TD\n  A[Synthetic start] --> B[Synthetic end]\n```\n\nSynthetic after\n';
const shortcut = `${mod}+Shift+m`;

test('non-Mac editor dispatch handles lowercase and uppercase shifted Mermaid keys', async ({ page }) => {
  // Isolate CodeMirror's platform-specific bindings, including on a macOS host.
  await page.addInitScript(() => Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64' }));
  await launchDocument(page, 'SYNTHETIC shifted shortcut\n');
  const editor = page.locator('.cm-content');
  for (const key of ['m', 'M']) {
    await editor.focus();
    await page.keyboard.press(`Control+Shift+${key}`);
    const panel = page.locator('.assistant-panel');
    await expect(panel.locator('.compose-context')).toContainText('将在光标位置创建新图');
    await expect(page.locator('.cm-panel-lint')).toHaveCount(0);
    await panel.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
  }
  // Ctrl+Shift+M must not toggle Ctrl+M's tab-focus mode as a side effect.
  await editor.focus();
  await page.keyboard.press('Tab');
  await expect(editor).toBeFocused();
  expect(await savedSource(page)).toBe('  SYNTHETIC shifted shortcut\n');
});

test('Mermaid shortcut in ordinary Markdown opens creation without Diagnostics or a document edit', async ({ page }) => {
  await launchDocument(page, source, 'synthetic-mermaid-shortcut.md');
  await page.locator('.cm-content').focus();
  await page.keyboard.press(`${mod}+Home`);
  await page.keyboard.press(shortcut);
  const panel = page.locator('.assistant-panel');
  await expect(panel).toBeVisible({ timeout: 1500 });
  await expect(panel.locator('.compose-context')).toContainText('将在光标位置创建新图');
  await expect(panel.getByLabel('告诉 AI 你的要求', { exact: true })).toHaveAttribute('placeholder', '例如：创建一个包含登录、校验、成功和失败分支的流程图');
  await expect(page.locator('.cm-panel-lint')).toHaveCount(0);
  expect(await savedSource(page)).toBe(source);
});

test('Mermaid shortcut uses the diagram at the current cursor and refreshes after moving outside it', async ({ page }) => {
  await launchDocument(page, source, 'synthetic-mermaid-shortcut.md');
  const editor = page.locator('.cm-content');
  await editor.focus();
  await page.keyboard.press(`${mod}+Home`);
  for (let line = 0; line < 3; line++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press(shortcut);
  const panel = page.locator('.assistant-panel');
  await expect(panel).toBeVisible({ timeout: 1500 });
  await expect(panel.locator('.compose-context')).toContainText('将修改光标所在的 Mermaid 图');
  await expect(panel.getByLabel('告诉 AI 你的要求', { exact: true })).toHaveAttribute('placeholder', '例如：把审批环节改成财务与法务并行，再汇总到负责人');
  await expect(page.locator('.cm-panel-lint')).toHaveCount(0);
  await panel.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
  await editor.focus();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.press(shortcut);
  await expect(panel.locator('.compose-context')).toContainText('将在光标位置创建新图');
  expect(await savedSource(page)).toBe(source);
});

test('Mermaid shortcut remains available from non-editing application controls', async ({ page }) => {
  await launchDocument(page, source, 'synthetic-mermaid-shortcut.md');
  await page.getByRole('button', { name: '保存', exact: true }).focus();
  await page.keyboard.press(shortcut);
  await expect(page.locator('.assistant-panel .compose-context')).toContainText('将在光标位置创建新图');
  expect(await savedSource(page)).toBe(source);
});

test('Mermaid shortcut does not open the assistant from the document name field', async ({ page }) => {
  await launchDocument(page, source, 'synthetic-mermaid-shortcut.md');
  const name = page.getByRole('textbox', { name: '文档名称', exact: true });
  await name.focus();
  await page.keyboard.press(shortcut);
  await expect(page.locator('.assistant-panel')).toHaveCount(0, { timeout: 1500 });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('synthetic-mermaid-shortcut');
  expect(await savedSource(page)).toBe(source);
});

test('Mermaid shortcut does not switch actions while writing assistant instructions', async ({ page }) => {
  await launchDocument(page, source, 'synthetic-mermaid-shortcut.md');
  await page.getByRole('button', { name: '润色', exact: true }).click();
  const panel = page.locator('.assistant-panel');
  const instruction = panel.getByLabel('补充要求', { exact: true });
  await instruction.fill('SYNTHETIC instruction remains unchanged');
  await expect(panel.locator('.compose-context')).toContainText('润色表达');
  await page.keyboard.press(shortcut);
  await expect(panel.locator('.compose-context')).toContainText('润色表达', { timeout: 1500 });
  await expect(instruction).toBeFocused();
  await expect(instruction).toHaveValue('SYNTHETIC instruction remains unchanged');
  expect(await savedSource(page)).toBe(source);
});

test('Mermaid shortcut does not open the assistant from CodeMirror search input', async ({ page }) => {
  await launchDocument(page, source, 'synthetic-mermaid-shortcut.md');
  await page.locator('.cm-content').focus();
  await page.keyboard.press(`${mod}+f`);
  const search = page.locator('.cm-search input[name="search"]');
  await search.fill('Synthetic');
  await page.keyboard.press(shortcut);
  await expect(page.locator('.assistant-panel')).toHaveCount(0, { timeout: 1500 });
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('Synthetic');
  await expect(page.locator('.cm-panel-lint')).toHaveCount(0);
  expect(await savedSource(page)).toBe(source);
});
