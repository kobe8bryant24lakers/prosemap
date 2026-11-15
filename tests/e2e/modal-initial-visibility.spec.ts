import { expect, test, type Locator, type Page } from '@playwright/test';
import { editorSource, launchDocument, openDiagram } from './helpers';

const original = '# SYNTHETIC modal visibility\n\n```mermaid\nflowchart LR\n  A["SYNTHETIC Alpha"] --> B["SYNTHETIC Beta"]\n```\n';

async function launchWithPausedAnimations(page: Page) {
  await launchDocument(page, original);
  // Reproduce a suspended presentation timeline without changing the product's
  // animation names, durations, initial opacity or focus management.
  await page.addStyleTag({ content: '*, *::before, *::after { animation-play-state: paused !important; }' });
}

async function expectOpaqueDialog(dialog: Locator) {
  await expect(dialog).toBeVisible();
  const visibility = await dialog.evaluate(element => {
    const chain = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      chain.push({ name: node.className, opacity: Number(style.opacity), visibility: style.visibility, display: style.display });
    }
    return { effectiveOpacity: chain.reduce((value, node) => value * node.opacity, 1), chain };
  });
  expect(visibility.effectiveOpacity, JSON.stringify(visibility.chain)).toBeGreaterThanOrEqual(0.99);
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
}

test('model settings is visible before any entrance animation can advance', async ({ page }) => {
  await launchWithPausedAnimations(page);
  await page.getByRole('button', { name: '管理模型', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '模型连接', exact: true });
  await expectOpaqueDialog(dialog);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('workbench and nested discard confirmation are visible with a suspended animation timeline', async ({ page }) => {
  await launchWithPausedAnimations(page);
  const editorBefore = await editorSource(page);
  await openDiagram(page);
  const dialog = page.locator('.mermaid-workbench');
  await expectOpaqueDialog(dialog);
  await dialog.getByRole('button', { name: '源码', exact: true }).click();
  await dialog.getByLabel('Mermaid 源码编辑器').fill('flowchart LR\n  A["SYNTHETIC changed"] --> B');
  await dialog.getByRole('button', { name: '关闭图表工作台' }).click();
  const confirm = page.getByRole('alertdialog');
  await expectOpaqueDialog(confirm);
  await confirm.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expectOpaqueDialog(dialog);
  expect(await editorSource(page)).toBe(editorBefore);
});

test('fullscreen diagram is visible with a suspended animation timeline', async ({ page }) => {
  await launchWithPausedAnimations(page);
  await page.getByRole('button', { name: '全屏查看图表', exact: true }).click();
  await expectOpaqueDialog(page.getByRole('dialog'));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('AI diff is visible with a suspended animation timeline and leaves the document intact', async ({ page }) => {
  await launchWithPausedAnimations(page);
  const editorBefore = await editorSource(page);
  await page.getByRole('button', { name: '管理模型', exact: true }).click();
  await page.getByLabel('模型名称', { exact: true }).fill('synthetic-model');
  await page.getByLabel('API 密钥', { exact: true }).fill('synthetic-not-a-secret');
  await page.getByRole('button', { name: '安全保存', exact: true }).click();
  await expect(page.locator('.settings-modal')).toHaveCount(0);
  await page.evaluate(() => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command === 'stream_ai') {
        args.onEvent.onmessage({ type: 'delta', text: '# SYNTHETIC replacement\n\nFabricated suggestion only.' });
        return;
      }
      return invoke(command, args);
    };
  });
  await page.getByRole('button', { name: 'AI 文字助手', exact: true }).click();
  await page.getByRole('button', { name: '生成建议', exact: true }).click();
  const diff = page.locator('.diff-modal');
  await expectOpaqueDialog(diff);
  await diff.getByRole('button', { name: '拒绝', exact: true }).click();
  await expect(diff).toHaveCount(0);
  expect(await editorSource(page)).toBe(editorBefore);
});
