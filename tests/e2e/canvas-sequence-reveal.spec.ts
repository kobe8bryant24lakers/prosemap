import { expect, test } from '@playwright/test';
import fixtures from '../fixtures/label-history-templates.json' with { type: 'json' };
import { launchDocument } from './helpers';

for (const locale of ['en', 'zh-CN']) {
  test(`sequence quick add after fitting the parent stays fully visible (${locale})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const item = fixtures.templates.find(item => item.kind === 'sequence')!;
    await launchDocument(page, `# SYNTHETIC fitted sequence reveal\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    if (locale === 'en') await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    await page.getByRole('button', { name: locale === 'en' ? 'Edit diagram on the visual canvas' : '在可视化画布中编辑图表', exact: true }).click();
    const parent = page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`);
    await parent.click();
    await page.getByRole('button', { name: locale === 'en' ? 'Selection' : '选区', exact: true }).click();
    await parent.locator('.quick-add-right').click();
    await expect(page.locator('.mermaid-canvas-node')).toHaveCount(4);
    await page.locator('.mermaid-canvas-node input').press('Enter');
    const added = page.locator('.mermaid-canvas-node').filter({ hasText: locale === 'en' ? 'New participant' : '新参与者' });
    const geometry = async () => ({ node: await added.boundingBox(), viewport: await page.locator('.canvas-editor-viewport').boundingBox() });
    await testInfo.attach('fitted-sequence-geometry', { body: JSON.stringify(await geometry()), contentType: 'application/json' });
    await expect.poll(async () => {
      const { node, viewport } = await geometry();
      return !!node && !!viewport && node.x >= viewport.x && node.y >= viewport.y
        && node.x + node.width <= viewport.x + viewport.width
        && node.y + node.height <= viewport.y + viewport.height;
    }, { message: 'the entire newly added participant is revealed at the fitted zoom' }).toBe(true);
  });
}
