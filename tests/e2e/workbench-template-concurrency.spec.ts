import { expect, test, type Page } from '@playwright/test';
import { MERMAID_TEMPLATES } from '../../lib/mermaid-workbench';
import { draftSource, launchDocument, openDiagram } from './helpers';

// Synthetic IPC only; native HTTP, credentials and timing are tested separately.
const initial = 'flowchart LR\n  A["SYNTHETIC initial"] --> B["SYNTHETIC keep"]';
const generated = 'flowchart LR\n  A["SYNTHETIC newer result"] --> B["SYNTHETIC keep"]';

async function start(page: Page) {
  await launchDocument(page, `# SYNTHETIC template concurrency\n\n\`\`\`mermaid\n${initial}\n\`\`\`\n`, 'synthetic-template-concurrency.md', 'ready', 'memory');
  await page.evaluate(() => {
    const w = window as any, invoke = w.__TAURI_INTERNALS__.invoke;
    w.__templateStream = { finish: null, canceled: 0 };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command === 'cancel_ai') { w.__templateStream.canceled++; return; }
      if (command === 'stream_ai') return new Promise<void>(resolve => {
        w.__templateStream.finish = (source: string) => {
          args.onEvent.onmessage({ type: 'delta', text: source });
          args.onEvent.onmessage({ type: 'done' }); resolve();
        };
      });
      return invoke(command, args);
    };
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '模型连接', exact: true });
  await dialog.getByLabel('配置名称', { exact: true }).fill('SYNTHETIC template model');
  await dialog.getByLabel('API 地址', { exact: true }).fill('http://127.0.0.1:1/v1');
  await dialog.getByLabel('模型名称', { exact: true }).fill('synthetic-template-model');
  await dialog.getByLabel('API 密钥', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
  await dialog.getByRole('button', { name: '安全保存', exact: true }).click();
  await openDiagram(page);
  await page.locator('.workbench-tabs').getByRole('button', { name: 'AI 辅助', exact: true }).click();
  await page.getByLabel('描述你想要的图', { exact: true }).fill('SYNTHETIC generate a diagram');
  await page.getByRole('button', { name: '生成图表草稿', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__templateStream.finish)).toBe(true);
  await page.locator('.workbench-tabs').getByRole('button', { name: '模板', exact: true }).click();
  await page.locator('.workbench-template-grid').getByRole('button').filter({ hasText: '时序图' }).click();
  await expect(page.getByRole('alertdialog', { name: '用模板替换当前草稿？', exact: true })).toBeVisible();
}

async function finish(page: Page) {
  await page.evaluate(source => (window as any).__templateStream.finish(source), generated);
}

test('cancelling replacement leaves the active generation running', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '保留草稿', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__templateStream.canceled)).toBe(0);
  await finish(page);
  await expect(page.locator('.workbench-preview .mermaid-svg svg')).toContainText('SYNTHETIC newer result');
  expect(await draftSource(page)).toBe(generated);
});

test('confirmation for an older draft cannot replace an AI result that arrives while it is open', async ({ page }) => {
  await start(page);
  await finish(page);
  await expect(page.locator('.workbench-preview .mermaid-svg svg')).toContainText('SYNTHETIC newer result');
  await page.getByRole('button', { name: '替换草稿', exact: true }).click();
  await expect(page.locator('.workbench-footer .error')).toHaveText('草稿已更新，请重新选择模板。');
  expect(await draftSource(page)).toBe(generated);
});

test('confirmed replacement cancels generation and ignores a late completion', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '替换草稿', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__templateStream.canceled)).toBeGreaterThan(0);
  await finish(page);
  expect(await draftSource(page)).toBe(MERMAID_TEMPLATES.find(item => item.id === 'sequence')!.source);
});
