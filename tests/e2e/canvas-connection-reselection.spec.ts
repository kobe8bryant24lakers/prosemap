import { expect, test } from '@playwright/test';
import fixtures from '../fixtures/label-history-templates.json' with { type: 'json' };
import { parseMermaidVisualSource } from '../../lib/mermaid-workbench';
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

for (const item of fixtures.templates) {
  test(`${item.template}: choosing another connection start clears selection without adding an edge`, async ({ page }) => {
    const graph = parseMermaidVisualSource(item.source)!;
    const other = graph.nodes.find(node => node.id !== item.nodeId && (item.kind !== 'state' || node.data?.stateRole === 'state'))!;
    await launchDocument(page, `# SYNTHETIC connection reselection\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    const node = (id: string) => page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"]`);
    await node(item.nodeId).click();
    const connect = page.locator('.primary-tools button[aria-pressed]');
    await connect.click();
    await expect(page.getByRole('button', { name: '重选起点', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '重选起点', exact: true }).click();
    await expect(connect).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.mermaid-canvas-node[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重选起点', exact: true })).toHaveCount(0);
    await node(other.id).click();
    await expect(page.locator('.canvas-selection-title')).toContainText(other.label);
    await expect(page.getByRole('button', { name: '重选起点', exact: true })).toBeVisible();
    expect(await draftSource(page)).toBe(item.source);
    await showCanvas(page);
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await expect(connect).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.history-tools button').first()).toBeDisabled();
    expect(await draftSource(page)).toBe(item.source);
  });
}
