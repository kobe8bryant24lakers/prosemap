import { expect, test, type Page } from '@playwright/test';
import { parseMermaidVisualSource } from '../../lib/mermaid-workbench';
import fixtures from '../fixtures/canvas-navigation-templates.json' with { type: 'json' };
import { editorSource, draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

async function layout(page: Page) {
  return page.locator('.mermaid-canvas-editor').evaluate(root => ({
    nodes: Array.from(root.querySelectorAll<HTMLElement>('.mermaid-canvas-node')).map(node => ({
      id: node.dataset.mermaidNodeId,
      left: Number.parseFloat(node.style.left), top: Number.parseFloat(node.style.top),
      width: node.style.width, height: node.style.height,
    })),
    zoom: root.querySelector('.canvas-zoom-value')?.textContent,
    scroll: [root.querySelector('.canvas-editor-viewport')?.scrollLeft, root.querySelector('.canvas-editor-viewport')?.scrollTop],
    selected: Array.from(root.querySelectorAll<HTMLElement>('.mermaid-canvas-node[aria-pressed="true"]')).map(node => node.dataset.mermaidNodeId),
    history: Array.from(root.querySelectorAll<HTMLButtonElement>('.history-tools button')).map(button => !button.disabled),
  }));
}

test('an unchanged automatic layout preserves a future redo and creates no empty history', async ({ page }) => {
  const item = fixtures.templates[0];
  await launchDocument(page, `# SYNTHETIC layout redo\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
  await openDiagram(page);
  await page.getByRole('button', { name: '自动排列', exact: true }).click();
  expect((await layout(page)).history).toEqual([false, false]);
  const node = page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`);
  await node.click();
  await node.press('Shift+ArrowRight');
  const moved = await layout(page);
  await page.locator('.history-tools button').first().click();
  expect((await layout(page)).history).toEqual([false, true]);
  await page.getByRole('button', { name: '自动排列', exact: true }).click();
  expect((await layout(page)).history).toEqual([false, true]);
  await page.locator('.history-tools button').nth(1).click();
  expect((await layout(page)).nodes).toEqual(moved.nodes);
});

for (const item of fixtures.templates) {
  test(`${item.template}: equivalent whitespace retains positions and starts a fresh history; exact recovery retains the new history`, async ({ page }) => {
    await launchDocument(page, `# SYNTHETIC equivalent source\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    const document = await editorSource(page);
    await openDiagram(page);
    const node = page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`);
    await node.click();
    const initial = await layout(page);
    for (let i = 0; i < 3; i++) await node.press('Shift+ArrowRight');
    await page.locator('.history-tools button').first().click();
    const manual = await layout(page);
    const originalNode = initial.nodes.find(n => n.id === item.nodeId)!;
    expect(manual.nodes.find(n => n.id === item.nodeId)!.left).toBe(originalNode.left + 20);
    expect(manual.history).toEqual([true, true]);
    const formatted = item.source.split('\n').map(line => `  ${line}`).join('\n');
    expect(parseMermaidVisualSource(formatted)).toEqual(parseMermaidVisualSource(item.source));
    expect(await draftSource(page)).toBe(item.source);
    await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(formatted);
    await showCanvas(page);
    expect(await layout(page)).toEqual({ ...manual, selected: [], history: [false, false] });
    expect(await draftSource(page)).toBe(formatted);
    await showCanvas(page);
    await node.click();
    await node.press('Shift+ArrowRight');
    const newHistory = await layout(page);
    expect(newHistory.nodes.find(n => n.id === item.nodeId)!.left).toBe(originalNode.left + 30);
    expect(newHistory.history).toEqual([true, false]);
    expect(await draftSource(page)).toBe(formatted);
    await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill('SYNTHETIC invalid source');
    await page.locator('.workbench-tabs').getByRole('button', { name: '画布', exact: true }).click();
    await expect(page.locator('.mermaid-canvas-editor')).toBeHidden();
    await draftSource(page);
    await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(formatted);
    await showCanvas(page);
    expect(await layout(page)).toEqual(newHistory);
    await page.locator('.history-tools button').first().click();
    expect((await layout(page)).nodes).toEqual(manual.nodes);
    expect(await draftSource(page)).toBe(formatted);
    await showCanvas(page);
    await page.locator('.history-tools button').nth(1).click();
    expect((await layout(page)).nodes).toEqual(newHistory.nodes);
    expect(await draftSource(page)).toBe(formatted);
    expect(await editorSource(page)).toBe(document);
  });

  test(`${item.template}: automatic layout is reversible and an identical repeat does not consume undo`, async ({ page }) => {
    await launchDocument(page, `# SYNTHETIC automatic layout\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    const document = await editorSource(page);
    await openDiagram(page);
    const node = page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`);
    await node.click();
    const initial = await layout(page);
    for (let i = 0; i < 8; i++) await node.press('Shift+ArrowRight');
    const manual = await layout(page);
    expect(manual.nodes.find(n => n.id === item.nodeId)!.left).toBe(initial.nodes.find(n => n.id === item.nodeId)!.left + 80);
    await page.getByRole('button', { name: '自动排列', exact: true }).click();
    const arranged = await layout(page);
    expect(arranged.nodes).toEqual(initial.nodes);
    const visibility = await page.locator('.mermaid-canvas-editor').evaluate(root => {
      const view = root.querySelector('.canvas-editor-viewport')!.getBoundingClientRect();
      return Array.from(root.querySelectorAll('.mermaid-canvas-node, .canvas-group-boundary')).map(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= view.left - 1 && bounds.right <= view.right + 1
          && bounds.top >= view.top - 1 && bounds.bottom <= view.bottom + 1;
      });
    });
    expect(visibility.length).toBeGreaterThanOrEqual(item.nodes.length);
    expect(visibility.every(Boolean)).toBe(true);
    expect(await draftSource(page)).toBe(item.source);
    await showCanvas(page);
    await page.getByRole('button', { name: '自动排列', exact: true }).click();
    expect((await layout(page)).nodes).toEqual(arranged.nodes);
    await page.locator('.history-tools button').first().click();
    expect((await layout(page)).nodes).toEqual(manual.nodes);
    await page.locator('.history-tools button').nth(1).click();
    expect((await layout(page)).nodes).toEqual(arranged.nodes);
    expect(await draftSource(page)).toBe(item.source);
    expect(await editorSource(page)).toBe(document);
  });
}
