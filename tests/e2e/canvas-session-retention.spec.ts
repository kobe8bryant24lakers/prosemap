import { expect, test, type Page } from '@playwright/test';
import fixtures from '../fixtures/canvas-navigation-templates.json' with { type: 'json' };
import { editorSource, draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

async function state(page: Page) {
  return page.locator('.mermaid-canvas-editor').evaluate(root => ({
    nodes: Array.from(root.querySelectorAll<HTMLElement>('.mermaid-canvas-node')).map(node => ({
      id: node.dataset.mermaidNodeId, left: Number.parseFloat(node.style.left),
      top: Number.parseFloat(node.style.top), width: node.style.width, height: node.style.height,
      selected: node.getAttribute('aria-pressed'),
    })),
    zoom: root.querySelector('.canvas-zoom-value')?.textContent,
    scroll: [root.querySelector('.canvas-editor-viewport')?.scrollLeft, root.querySelector('.canvas-editor-viewport')?.scrollTop],
    history: Array.from(root.querySelectorAll<HTMLButtonElement>('.history-tools button')).map(button => !button.disabled),
  }));
}

for (const item of fixtures.templates) {
  test(`${item.template}: tab changes retain manual positions, zoom, selection and both history directions`, async ({ page }) => {
    const document = `# SYNTHETIC manual session retention\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`;
    await launchDocument(page, document);
    const originalDocument = await editorSource(page);
    await openDiagram(page);
    await page.locator('.canvas-fit-button').click();
    const node = page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`);
    await node.click();
    const initial = await state(page);
    for (let i = 0; i < 4; i++) await node.press('Shift+ArrowRight');
    const moved = await state(page);
    await page.locator('.history-tools button').first().click();
    await page.getByRole('button', { name: '缩小画布', exact: true }).click();
    const before = await state(page);
    expect(before.nodes.find(n => n.id === item.nodeId)!.left).toBe(initial.nodes.find(n => n.id === item.nodeId)!.left + 30);
    expect(before.nodes.filter(n => n.selected === 'true').map(n => n.id)).toEqual([item.nodeId]);
    expect(before.history).toEqual([true, true]);
    expect(before.zoom).not.toBe(initial.zoom);
    for (const name of ['AI 辅助', '模板', '源码']) {
      await page.locator('.workbench-tabs').getByRole('button', { name, exact: true }).click();
      await expect(page.locator('.workbench-preview .mermaid-svg svg')).toBeVisible();
      if (name === '源码') expect(await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).inputValue()).toBe(item.source);
      await showCanvas(page);
      expect(await state(page)).toEqual(before);
    }
    await page.locator('.history-tools button').nth(1).click();
    expect((await state(page)).nodes).toEqual(moved.nodes);
    await page.locator('.history-tools button').first().click();
    expect(await state(page)).toEqual(before);
    expect(await draftSource(page)).toBe(item.source);
    expect(await editorSource(page)).toBe(originalDocument);
  });
}

for (const key of ['Delete', 'Backspace']) {
  test(`mindmap: ${key} deletes a child but preserves the last topic and redo`, async ({ page }) => {
    const source = 'mindmap\n  root((SYNTHETIC Root))\n    child["SYNTHETIC Child"]';
    await launchDocument(page, `# SYNTHETIC final topic protection\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`);
    const document = await editorSource(page);
    await openDiagram(page);
    await page.locator('.mermaid-canvas-node[data-mermaid-node-id="child"]').click();
    await page.locator('.mermaid-canvas-node[data-mermaid-node-id="child"]').press(key);
    // Establish that this key reached the canvas before testing the protected case.
    await expect(page.locator('.mermaid-canvas-node')).toHaveCount(1);
    const root = page.locator('.mermaid-canvas-node[data-mermaid-node-id="root"]');
    await root.click();
    await root.press('Shift+ArrowRight');
    await root.press('Shift+ArrowRight');
    await page.locator('.history-tools button').first().click();
    const before = await state(page);
    expect(before.history).toEqual([true, true]);
    const remaining = await draftSource(page);
    await showCanvas(page);
    await root.click();
    await expect(page.locator('.canvas-context-bar').getByRole('button', { name: '删除', exact: true })).toBeDisabled();
    await root.press(key);
    expect(await state(page)).toEqual(before);
    expect(await draftSource(page)).toBe(remaining);
    await expect(page.locator('.workbench-preview .mermaid-svg svg')).toContainText('SYNTHETIC Root');
    await showCanvas(page);
    await page.locator('.history-tools button').nth(1).click();
    expect((await state(page)).nodes[0].left).toBe(before.nodes[0].left + 10);
    await page.locator('.history-tools button').first().click();
    expect(await state(page)).toEqual(before);
    expect(await editorSource(page)).toBe(document);
  });
}
