import { expect, test } from '@playwright/test';
import { parseMermaidVisualSource } from '../../lib/mermaid-workbench';
import fixtures from '../fixtures/canvas-group-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

for (const item of fixtures.templates) {
  test(`${item.template}: two empty groups have distinct IDs, visible boundaries and stable undo positions`, async ({ page }) => {
    await launchDocument(page, `# SYNTHETIC empty group placement\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    const positions = () => page.locator('.mermaid-canvas-node').evaluateAll(nodes => nodes.map(node => ({ id: (node as HTMLElement).dataset.mermaidNodeId, style: (node as HTMLElement).style.cssText })));
    const initial = await positions();
    const add = page.locator('.canvas-editor-toolbar').getByRole('button', { name: item.template === 'usecase' ? '系统边界' : '包 / 分组', exact: true });
    await add.click();
    await add.click();
    const source = await draftSource(page);
    const parsed = parseMermaidVisualSource(source)!;
    const original = parseMermaidVisualSource(item.source)!;
    const added = parsed.data!.groups!.filter(group => !original.data!.groups!.some(before => before.id === group.id));
    expect(added).toHaveLength(2);
    expect(new Set([...parsed.nodes, ...parsed.data!.groups!].map(value => value.id)).size).toBe(parsed.nodes.length + parsed.data!.groups!.length);
    expect(added.every(group => group.id !== item.collisionNode)).toBe(true);
    await showCanvas(page);
    await page.locator('.canvas-groups-panel summary').click();
    for (const [index, group] of added.entries()) await page.getByRole('textbox', { name: `分组名称 ${group.id}`, exact: true }).fill(`SYNTHETIC New ${index}`);
    await page.locator('.canvas-groups-panel summary').click();
    await page.locator('.canvas-fit-button').click();
    const boxes = () => page.locator('.canvas-group-boundary').filter({ has: page.locator('span', { hasText: /^SYNTHETIC New / }) }).evaluateAll(nodes => nodes.map(node => {
      const element = node as HTMLElement, rect = element.getBoundingClientRect();
      return { left: element.style.left, top: element.style.top, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    const before = await boxes();
    const [a, b] = before;
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    const viewport = await page.locator('.canvas-editor-viewport').boundingBox();
    for (const box of before) {
      expect(box.x).toBeGreaterThanOrEqual(viewport!.x);
      expect(box.y).toBeGreaterThanOrEqual(viewport!.y);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport!.x + viewport!.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport!.y + viewport!.height);
    }
    expect(await positions()).toEqual(initial);
    // Node reconciliation must retain the anchors of existing empty groups.
    await page.locator('.canvas-editor-toolbar').getByRole('button', { name: '节点', exact: true }).click();
    await page.locator('.mermaid-canvas-node input').fill('SYNTHETIC Added outside');
    await page.locator('.mermaid-canvas-node input').press('Enter');
    expect((await boxes()).map(({ left, top }) => ({ left, top }))).toEqual(before.map(({ left, top }) => ({ left, top })));
    await page.locator('.history-tools button').first().click();
    await page.locator('.history-tools button').first().click();
    expect((await boxes()).map(({ left, top }) => ({ left, top }))).toEqual(before.map(({ left, top }) => ({ left, top })));
    expect(await positions()).toEqual(initial);
  });
}
