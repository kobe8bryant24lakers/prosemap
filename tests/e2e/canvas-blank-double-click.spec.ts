import { expect, test, type Page } from '@playwright/test';
import fixtures from '../fixtures/canvas-navigation-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

async function blankPoint(page: Page) {
  return page.locator('.canvas-editor-viewport').evaluate(view => {
    const r = view.getBoundingClientRect();
    for (const x of [r.left + 25, r.right - 35]) for (const y of [r.top + 25, r.bottom - 35]) {
      const hit = document.elementFromPoint(x, y);
      if (hit && view.contains(hit) && !hit.closest('[data-mermaid-node-id], [data-mermaid-edge-id], button, input')) return { x, y };
    }
    throw new Error('No independent blank target');
  });
}

for (const item of fixtures.templates) for (const delay of [300, 600, 800]) {
  test(`${item.template}: independent blank double click at ${delay} ms creates exactly one object`, async ({ page }) => {
    await launchDocument(page, `# SYNTHETIC double click\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    const root = page.locator('.mermaid-canvas-editor'), view = root.locator('.canvas-editor-viewport');
    await root.locator('.canvas-fit-button').click();
    const layout = () => root.locator('.mermaid-canvas-node').evaluateAll(nodes => nodes.map(n => ({ id: n.getAttribute('data-mermaid-node-id'), style: n.getAttribute('style') })));
    const before = await layout();
    await view.evaluate(view => {
      const events: { at: number; object: boolean }[] = [];
      (view as HTMLElement & { qaPresses: typeof events }).qaPresses = events;
      view.addEventListener('pointerdown', e => events.push({ at: e.timeStamp, object: !!(e.target as Element).closest('[data-mermaid-node-id], [data-mermaid-edge-id]') }), true);
    });
    for (const selected of ['node', 'edge']) {
      if (selected === 'node') await root.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`).click();
      else {
        const point = await root.locator('.canvas-edge-hit').first().evaluate(el => {
          const p = el as SVGPathElement, mid = p.getPointAtLength(p.getTotalLength() / 2).matrixTransform(p.getScreenCTM()!);
          return { x: mid.x, y: mid.y };
        });
        await page.mouse.click(point.x, point.y);
        await expect(root.locator('.canvas-edge.selected')).toHaveCount(1);
      }
      const blank = await blankPoint(page);
      // This delay is the interaction boundary under test, not a readiness wait.
      await view.evaluate(async (view, delay) => {
        const events = (view as HTMLElement & { qaPresses: { at: number }[] }).qaPresses;
        const remaining = events.at(-1)!.at + delay - performance.now();
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
      }, delay);
      await page.mouse.dblclick(blank.x, blank.y);
      const elapsed = await view.evaluate(view => {
        const events = (view as HTMLElement & { qaPresses: { at: number; object: boolean }[] }).qaPresses;
        return events.at(-2)!.at - events.at(-3)!.at;
      });
      expect(elapsed).toBeGreaterThanOrEqual(delay - 15);
      expect(elapsed).toBeLessThan(delay + 100);
      expect(await root.locator('.mermaid-canvas-node').count()).toBe(before.length + 1);
      await expect(root.locator('.mermaid-canvas-node input')).toHaveCount(1);
      await root.locator('.mermaid-canvas-node input').press('Enter');
      await root.locator('.history-tools button').first().click();
      expect(await layout()).toEqual(before);
      expect(await draftSource(page)).toBe(item.source);
      await showCanvas(page);
    }
  });
}

for (const template of ['basic-flowchart', 'class', 'sequence']) {
  test(`${template}: node and edge label double clicks do not create a blank object`, async ({ page }) => {
    const item = fixtures.templates.find(t => t.template === template)!;
    await launchDocument(page, `# SYNTHETIC label double click\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    const root = page.locator('.mermaid-canvas-editor'), node = root.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`);
    const count = await root.locator('.mermaid-canvas-node').count();
    await root.locator('.canvas-fit-button').click();
    await node.dblclick();
    await expect(node.locator('input')).toHaveCount(1);
    await node.locator('input').press('Escape');
    await root.locator('.canvas-edge-label').first().dblclick();
    await expect(root.locator('.canvas-edge-label input')).toHaveCount(1);
    await root.locator('.canvas-edge-label input').press('Escape');
    expect(await root.locator('.mermaid-canvas-node').count()).toBe(count);
    expect(await draftSource(page)).toBe(item.source);
  });
}

test('a double-click retargeted after a node drag cannot create a blank object', async ({ page }) => {
  const item = fixtures.templates[0];
  await launchDocument(page, `# SYNTHETIC drag release\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
  await openDiagram(page);
  const root = page.locator('.mermaid-canvas-editor'), view = root.locator('.canvas-editor-viewport');
  await root.locator('.canvas-fit-button').click();
  const node = root.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`);
  const before = await node.getAttribute('style'), box = (await node.boundingBox())!;
  const count = await root.locator('.mermaid-canvas-node').count();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 35, { steps: 5 });
  await page.mouse.up();
  expect(await node.getAttribute('style')).not.toBe(before);
  const blank = await blankPoint(page);
  // Model the browser's retargeted tail, with no independent pair of blank presses.
  await view.dispatchEvent('dblclick', { clientX: blank.x, clientY: blank.y, detail: 2 });
  expect(await root.locator('.mermaid-canvas-node').count()).toBe(count);
  await root.locator('.history-tools button').first().click();
  expect(await node.getAttribute('style')).toBe(before);
  expect(await draftSource(page)).toBe(item.source);
});
