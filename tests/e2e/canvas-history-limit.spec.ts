import { expect, test } from '@playwright/test';
import fixtures from '../fixtures/label-history-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

for (const item of fixtures.templates) {
  test(`${item.template}: 85 position changes retain exactly the newest 80 undo steps`, async ({ page }) => {
    await launchDocument(page, `# SYNTHETIC canvas history limit\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    const parent = page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`);
    const position = () => parent.evaluate(el => ({ x: (el as HTMLElement).style.left, y: (el as HTMLElement).style.top }));
    await parent.click();
    const before = await position();
    for (let i = 0; i < 5; i++) await parent.press('ArrowRight');
    const oldestReachable = await position();
    expect(oldestReachable).not.toEqual(before);
    for (let i = 0; i < 80; i++) await parent.press('ArrowRight');
    const latest = await position();
    const undo = page.locator('.history-tools button').first();
    const redo = page.locator('.history-tools button').nth(1);
    for (let i = 0; i < 80; i++) { await expect(undo).toBeEnabled(); await undo.click(); }
    await expect(undo).toBeDisabled();
    expect(await position()).toEqual(oldestReachable);
    expect(await draftSource(page)).toBe(item.source);
    await showCanvas(page);
    for (let i = 0; i < 80; i++) { await expect(redo).toBeEnabled(); await redo.click(); }
    await expect(redo).toBeDisabled();
    expect(await position()).toEqual(latest);
    expect(await draftSource(page)).toBe(item.source);
  });
}
