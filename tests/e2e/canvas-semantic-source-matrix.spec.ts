import { expect, test } from '@playwright/test';
import fixtures from '../fixtures/canvas-navigation-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

for (const item of fixtures.templates) {
  test(`${item.template}: semantic source establishes a new undo boundary and subsequent history stays within it`, async ({ page }, testInfo) => {
    await launchDocument(page, `# SYNTHETIC semantic history\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    const root = page.locator('.mermaid-canvas-editor');
    const originalNode = root.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`);
    const undo = root.locator('.history-tools button').first();
    const redo = root.locator('.history-tools button').nth(1);
    await originalNode.click();
    await root.getByRole('button', { name: '复制', exact: true }).click();
    const firstCopy = await draftSource(page);
    await showCanvas(page);
    await root.getByRole('button', { name: '复制', exact: true }).click();
    await undo.click();
    await expect(undo).toBeEnabled();
    await expect(redo).toBeEnabled();
    expect(await draftSource(page)).toBe(firstCopy);

    // A sequence duplicate can precede the original declaration. Match the
    // complete label, so a copy's label is not mistaken for the target node.
    const external = firstCopy.replace(/Synthetic_NodeBase(?=["\])\r\n]|\s*:|$)/, '合成语义更新');
    await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(external);
    await showCanvas(page);
    await expect(originalNode).toContainText('合成语义更新');
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    await expect(root.locator('.mermaid-canvas-node.selected')).toHaveCount(0);
    expect(await draftSource(page)).toBe(external);

    await showCanvas(page);
    await originalNode.click();
    await root.getByRole('button', { name: '复制', exact: true }).click();
    const newCopy = await draftSource(page);
    expect(newCopy).toContain('合成语义更新');
    expect(newCopy).not.toBe(external);
    await showCanvas(page);
    await undo.click();
    expect(await draftSource(page)).toBe(external);
    await showCanvas(page);
    await expect(undo).toBeDisabled();
    await redo.click();
    expect(await draftSource(page)).toBe(newCopy);
    await showCanvas(page);
    await undo.click();
    expect(await draftSource(page)).toBe(external);
    await testInfo.attach('synthetic-semantic-history', {
      body: JSON.stringify({ original: item.source, firstCopy, external, newCopy }), contentType: 'application/json',
    });
  });
}
