import { expect, test, type Page } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

const initial = 'flowchart LR\n  A["Old"] --> B["Keep"]';
const generated = 'flowchart LR\n  A["AI Result"] --> B["Keep"]\n  B --> C["AI Added"]';

async function start(page: Page) {
  await launchDocument(page, `# AI concurrency\n\n\`\`\`mermaid\n${initial}\n\`\`\`\n`);
  await page.evaluate(() => {
    const w = window as any, invoke = w.__TAURI_INTERNALS__.invoke;
    w.__workbenchAi = { finish: null, canceled: 0 };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command === 'cancel_ai') { w.__workbenchAi.canceled++; return; }
      if (command === 'stream_ai') return new Promise<void>(resolve => {
        w.__workbenchAi.finish = (source: string) => {
          args.onEvent.onmessage({ type: 'delta', text: source });
          args.onEvent.onmessage({ type: 'done' }); resolve();
        };
      });
      return invoke(command, args);
    };
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '模型连接', exact: true });
  await settings.getByLabel('配置名称', { exact: true }).fill('隔离验收模型');
  await settings.getByLabel('API 地址', { exact: true }).fill('http://127.0.0.1:1/v1');
  await settings.getByLabel('模型名称', { exact: true }).fill('synthetic-model');
  await settings.getByLabel('API 密钥', { exact: true }).fill('acceptance-placeholder-no-real-credential');
  await settings.getByRole('button', { name: '安全保存', exact: true }).click();
  await openDiagram(page);
  await page.locator('.workbench-tabs').getByRole('button', { name: 'AI 辅助', exact: true }).click();
  await page.getByLabel('描述你想要的图', { exact: true }).fill('新增一个节点并保留旧节点');
  await page.getByRole('button', { name: '生成图表草稿', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__workbenchAi.finish)).toBe(true);
}

async function finish(page: Page) {
  await page.evaluate(source => (window as any).__workbenchAi.finish(source), generated);
}

for (const destination of ['画布', '源码'] as const) {
  test(`AI completion while viewing ${destination} publishes the complete new draft before later canvas edits`, async ({ page }) => {
    await start(page);
    await page.locator('.workbench-tabs').getByRole('button', { name: destination, exact: true }).click();
    await finish(page);
    if (destination === '源码') {
      await expect(page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true })).toHaveValue(generated);
      await showCanvas(page);
    }
    const a = page.locator('.mermaid-canvas-node[data-mermaid-node-id="A"]');
    await expect(a).toContainText('AI Result');
    await expect(page.locator('.mermaid-canvas-node[data-mermaid-node-id="C"]')).toContainText('AI Added');
    await a.dblclick(); await a.locator('input').fill('Manual'); await a.locator('input').press('Enter');
    const source = await draftSource(page);
    expect(source).toBe(generated.replace('AI Result', 'Manual'));
    await showCanvas(page);
    await page.locator('.history-tools').getByRole('button', { name: '撤销', exact: true }).click();
    expect(await draftSource(page)).toBe(generated);
  });
}

test('a canvas edit invalidates the in-flight AI result even if completion arrives later', async ({ page }) => {
  await start(page);
  await showCanvas(page);
  const a = page.locator('.mermaid-canvas-node[data-mermaid-node-id="A"]');
  await a.dblclick(); await a.locator('input').fill('Manual wins'); await a.locator('input').press('Enter');
  await finish(page);
  expect(await draftSource(page)).toBe(initial.replace('Old', 'Manual wins'));
  await showCanvas(page);
  await expect(page.locator('.mermaid-canvas-node')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => (window as any).__workbenchAi.canceled)).toBeGreaterThan(0);
});
