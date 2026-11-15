import { expect, test, type Page } from '@playwright/test';
import { parseMermaidVisualSource } from '../../lib/mermaid-workbench';
import fixtures from '../fixtures/label-history-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

const node = (page: Page, id: string) => page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"]`);
type Box = { x: number; y: number; width: number; height: number };
const separate = (a: Box, b: Box) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

for (const item of fixtures.templates) {
  for (const direction of ['sequence', 'mindmap', 'gantt'].includes(item.kind) ? ['right'] : ['top', 'right', 'bottom', 'left']) {
    test(`${item.template}: one quick ${direction} click creates a visible connected object on the requested side`, async ({ page }, testInfo) => {
      await launchDocument(page, `# SYNTHETIC quick directions\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
      await openDiagram(page);
      const parent = node(page, item.nodeId), before = parseMermaidVisualSource(item.source)!;
      await parent.click();
      // Exercise insertion at the stage boundary as well as ordinary free space.
      if (direction === 'left' || direction === 'top') {
        for (let i = 0; i < 150; i++) await parent.press(direction === 'left' ? 'Shift+ArrowLeft' : 'Shift+ArrowUp');
        const coordinate = await parent.evaluate((el, axis) => parseFloat((el as HTMLElement).style[axis as 'left' | 'top']), direction === 'left' ? 'left' : 'top');
        expect(coordinate).toBe(18);
        await page.getByRole('button', { name: '选区', exact: true }).click();
      }
      const originalPositions = await page.locator('.mermaid-canvas-node').evaluateAll(es => es.map(e => (e as HTMLElement).style.cssText));
      await parent.locator(`.quick-add-${direction}`).click();
      await expect(page.locator('.mermaid-canvas-node')).toHaveCount(before.nodes.length + 1);
      const input = page.locator('.mermaid-canvas-node input');
      await expect(input).toBeFocused();
      await input.press('Enter');
      const inViewport = async (id: string) => {
        const b = (await node(page, id).boundingBox())!, v = (await page.locator('.canvas-editor-viewport').boundingBox())!;
        return b.x >= v.x - 1 && b.y >= v.y - 1 && b.x + b.width <= v.x + v.width + 1 && b.y + b.height <= v.y + v.height + 1;
      };
      const newId = (await page.locator('.mermaid-canvas-node').evaluateAll(es => es.map(e => e.getAttribute('data-mermaid-node-id')!))).find(id => !before.nodes.some(n => n.id === id))!;
      await testInfo.attach('immediate-quick-geometry', { body: JSON.stringify({ added: await node(page, newId).boundingBox(), viewport: await page.locator('.canvas-editor-viewport').boundingBox() }), contentType: 'application/json' });
      await expect.poll(() => inViewport(newId), { message: 'new object scrolls completely into view before switching tabs' }).toBe(true);
      const current = parseMermaidVisualSource(await draftSource(page))!;
      const added = current.nodes.filter(n => !before.nodes.some(o => o.id === n.id));
      expect(added).toHaveLength(1);
      expect(current.edges).toHaveLength(before.edges.length + 1);
      const withoutGeneratedIds = (edges: typeof current.edges) => edges.map(edge => ({ ...edge, id: undefined })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      expect(withoutGeneratedIds(current.edges.filter(e => e.to !== added[0].id))).toEqual(withoutGeneratedIds(before.edges));
      expect(current.edges.find(e => e.to === added[0].id)).toMatchObject({ from: item.nodeId, to: added[0].id });
      expect(current.nodes.filter(n => n.id !== added[0].id).sort((a, b) => a.id.localeCompare(b.id))).toEqual([...before.nodes].sort((a, b) => a.id.localeCompare(b.id)));
      expect(current.direction).toBe(before.direction);
      await showCanvas(page);
      await expect.poll(() => inViewport(added[0].id), { message: 'new object remains visible after returning from Source' }).toBe(true);
      const a = (await parent.boundingBox())!, b = (await node(page, added[0].id).boundingBox())!, viewport = (await page.locator('.canvas-editor-viewport').boundingBox())!;
      await testInfo.attach('synthetic-quick-geometry', { body: JSON.stringify({ parent: a, added: b, viewport }), contentType: 'application/json' });
      if (direction === 'right') expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
      if (direction === 'left') expect(b.x + b.width).toBeLessThanOrEqual(a.x);
      if (direction === 'bottom') expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
      if (direction === 'top') expect(b.y + b.height).toBeLessThanOrEqual(a.y);
      expect(b.x >= viewport.x - 1 && b.y >= viewport.y - 1 && b.x + b.width <= viewport.x + viewport.width + 1 && b.y + b.height <= viewport.y + viewport.height + 1).toBe(true);
      for (const old of current.nodes.filter(n => n.id !== added[0].id)) expect(separate(b, (await node(page, old.id).boundingBox())!)).toBe(true);
      const changedPositions = await page.locator('.mermaid-canvas-node').evaluateAll(es => es.map(e => (e as HTMLElement).style.cssText));
      await page.locator('.history-tools button').first().click();
      expect(await page.locator('.mermaid-canvas-node').evaluateAll(es => es.map(e => (e as HTMLElement).style.cssText))).toEqual(originalPositions);
      expect(parseMermaidVisualSource(await draftSource(page))).toEqual(before);
      await showCanvas(page); await page.locator('.history-tools button').nth(1).click();
      expect(await page.locator('.mermaid-canvas-node').evaluateAll(es => es.map(e => (e as HTMLElement).style.cssText))).toEqual(changedPositions);
      expect(parseMermaidVisualSource(await draftSource(page))).toEqual(current);
    });
  }
}
