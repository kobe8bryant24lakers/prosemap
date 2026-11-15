import { expect, test } from '@playwright/test';
import fixtures from '../fixtures/label-history-templates.json' with { type: 'json' };
import { parseMermaidVisualSource } from '../../lib/mermaid-workbench';
import { draftSource, launchDocument, openDiagram, savedSource } from './helpers';

for (const item of fixtures.templates.filter(item => !['mindmap', 'gantt'].includes(item.kind))) {
  test(`${item.template}: delete all objects then recreate an editable object from the empty canvas`, async ({ page }) => {
    await launchDocument(page, `# SYNTHETIC empty canvas recovery\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    const nodes = page.locator('.mermaid-canvas-node');
    for (let i = 0; i < 30 && await nodes.count(); i++) {
      const before = await nodes.count();
      await nodes.last().click();
      await page.locator('.canvas-context-bar').getByRole('button', { name: '删除', exact: true }).click();
      await expect.poll(() => nodes.count()).toBeLessThan(before);
    }
    await expect(nodes).toHaveCount(0);
    await expect(page.locator('.canvas-empty-action')).toBeVisible();
    const empty = await draftSource(page);
    expect(parseMermaidVisualSource(empty)?.nodes).toHaveLength(0);
    // The canvas is intentionally empty; showCanvas requires an existing node.
    await page.locator('.workbench-tabs').getByRole('button', { name: '画布', exact: true }).click();
    await expect(page.locator('.canvas-empty-action')).toBeVisible();
    await expect(nodes).toHaveCount(0);
    await page.locator('.canvas-empty-action').click();
    await expect(nodes).toHaveCount(1);
    const input = nodes.locator('input');
    await expect(input).toBeFocused();
    await input.fill('SYNTHETIC restored object');
    await input.press('Enter');
    const source = await draftSource(page), graph = parseMermaidVisualSource(source)!;
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].label).toBe('SYNTHETIC restored object');
    expect(graph.edges).toHaveLength(0);
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    expect(await savedSource(page)).toContain(source);
  });
}
