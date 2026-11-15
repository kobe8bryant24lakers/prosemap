import { expect, test, type Page } from '@playwright/test';
import fixtures from '../fixtures/canvas-navigation-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram } from './helpers';

async function geometry(page: Page) {
  return page.locator('.canvas-editor-viewport').evaluate(view => {
    const stage = view.querySelector<HTMLElement>('.canvas-editor-stage')!;
    const rect = stage.getBoundingClientRect();
    return {
      scroll: { x: view.scrollLeft, y: view.scrollTop },
      stage: { x: rect.x, y: rect.y },
      scale: Number(stage.style.transform.match(/scale\(([^)]+)/)![1]),
      nodes: [...view.querySelectorAll<HTMLElement>('.mermaid-canvas-node')].map(n => ({
        id: n.dataset.mermaidNodeId!, x: parseFloat(n.style.left), y: parseFloat(n.style.top),
        width: parseFloat(n.style.width), height: parseFloat(n.style.height),
      })),
    };
  });
}

for (const placement of ['free', 'collision']) {
  test(`sequence ${placement} X after zoom and wheel pan preserves the header row`, async ({ page }, testInfo) => {
    const item = fixtures.templates.find(t => t.template === 'sequence')!;
    await page.setViewportSize({ width: 1440, height: 900 });
    await launchDocument(page, `# SYNTHETIC sequence placement\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    await page.locator('.canvas-zoom-value').click();
    await page.locator('.canvas-zoom-tools button').nth(2).click();
    const view = page.locator('.canvas-editor-viewport'), initial = await geometry(page);
    const bounds = (await view.boundingBox())!;
    await page.mouse.move(bounds.x + 30, bounds.y + 100);
    await page.mouse.wheel(160, 50);
    await expect.poll(async () => (await geometry(page)).scroll).not.toEqual(initial.scroll);
    const before = await geometry(page);
    expect(before.scale).toBeCloseTo(1.1);
    const point = await view.evaluate((view, { before, placement }) => {
      const r = view.getBoundingClientRect(), width = before.nodes[0].width;
      for (let x = r.left + 30; x < r.right - 30; x += 10) {
        const canvasX = (x - before.stage.x) / before.scale;
        if (canvasX - width / 2 < 18) continue;
        const free = before.nodes.every(n => canvasX + width / 2 + 24 <= n.x || n.x + n.width + 24 <= canvasX - width / 2);
        if (free !== (placement === 'free')) continue;
        for (let y = r.top + 30; y < r.bottom - 30; y += 20) {
          const target = document.elementFromPoint(x, y);
          if (target && view.contains(target) && !target.closest('[data-mermaid-node-id], [data-mermaid-edge-id], button, input')) return { x, y, canvasX };
        }
      }
      throw new Error('No blank target for the placement precondition');
    }, { before, placement });
    await page.mouse.dblclick(point.x, point.y);
    await expect(page.locator('.mermaid-canvas-node')).toHaveCount(before.nodes.length + 1);
    await page.locator('.mermaid-canvas-node input').press('Enter');
    const after = await geometry(page), added = after.nodes.find(n => !before.nodes.some(old => old.id === n.id))!;
    expect(after.nodes.filter(n => n.id !== added.id)).toEqual(before.nodes);
    expect(added.y).toBe(58);
    expect(before.nodes.every(n => added.x + added.width + 24 <= n.x || n.x + n.width + 24 <= added.x)).toBe(true);
    const centerX = added.x + added.width / 2;
    // CSS style serialization may round fractional canvas pixels.
    if (placement === 'free') expect(Math.abs(centerX - point.canvasX)).toBeLessThan(0.02);
    else {
      expect(Math.abs(centerX - point.canvasX)).toBeGreaterThan(1);
      expect(Math.abs(centerX - point.canvasX)).toBeLessThan(800);
    }
    await testInfo.attach('canvas-coordinates-and-scroll', { body: JSON.stringify({ initial, before, point, after, centerX }), contentType: 'application/json' });
    await page.locator('.history-tools button').first().click();
    expect((await geometry(page)).nodes).toEqual(before.nodes);
    expect(await draftSource(page)).toBe(item.source);
  });
}
