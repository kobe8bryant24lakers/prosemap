import { expect, test } from '@playwright/test';
import fixtures from '../fixtures/canvas-navigation-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram } from './helpers';

for (const item of fixtures.templates) {
  test(`${item.template}: a separate fast blank click clears node and edge selection`, async ({ page }) => {
    await launchDocument(page, `# SYNTHETIC blank click\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    const root = page.locator('.mermaid-canvas-editor'), viewport = root.locator('.canvas-editor-viewport');
    await root.locator('.canvas-fit-button').click();
    const blank = await viewport.evaluate(view => {
      const r = view.getBoundingClientRect();
      for (const x of [r.left + 20, r.right - 30]) for (const y of [r.top + 20, r.bottom - 30]) {
        const hit = document.elementFromPoint(x, y);
        if (hit && view.contains(hit) && !hit.closest('[data-mermaid-node-id], [data-mermaid-edge-id], button, input')) return { x, y };
      }
      throw new Error('No blank canvas target');
    });
    const layout = () => root.locator('.mermaid-canvas-node').evaluateAll(nodes => nodes.map(n => ({ id: n.getAttribute('data-mermaid-node-id'), style: n.getAttribute('style') })));
    const before = await layout();
    await viewport.evaluate(view => {
      const times: number[] = [];
      (view as HTMLElement & { qaPointerTimes: number[] }).qaPointerTimes = times;
      view.addEventListener('pointerdown', e => times.push(e.timeStamp), true);
    });
    for (const kind of ['node', 'edge'] as const) {
      if (kind === 'node') {
        await root.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`).click();
        await expect(root.locator('.mermaid-canvas-node[aria-pressed="true"]')).toHaveCount(1);
        // An inspector can cause the same gesture's click to be retargeted to
        // the viewport. That event must preserve the object selection.
        await viewport.dispatchEvent('click');
        await expect(root.locator('.mermaid-canvas-node[aria-pressed="true"]')).toHaveCount(1);
      } else {
        const path = root.locator('.canvas-edge-hit').first();
        const point = await path.evaluate(path => {
          const p = path as SVGPathElement;
          const mid = p.getPointAtLength(p.getTotalLength() / 2).matrixTransform(p.getScreenCTM()!);
          return { x: mid.x, y: mid.y };
        });
        await page.mouse.click(point.x, point.y);
        await expect(root.locator('.canvas-edge.selected')).toHaveCount(1);
      }
      await page.mouse.click(blank.x, blank.y);
      const elapsed = await viewport.evaluate(view => {
        const times = (view as HTMLElement & { qaPointerTimes: number[] }).qaPointerTimes;
        return times.at(-1)! - times.at(-2)!;
      });
      expect(elapsed).toBeLessThan(750);
      await expect(root.locator('.mermaid-canvas-node[aria-pressed="true"]')).toHaveCount(0);
      await expect(root.locator('.canvas-edge.selected')).toHaveCount(0);
      await expect(root.locator('.canvas-tool-group button[aria-pressed="true"]').first()).toHaveAttribute('title', '选择工具（V）');
      expect(await layout()).toEqual(before);
      await expect(root.locator('.history-tools button').first()).toBeDisabled();
    }
    expect(await draftSource(page)).toBe(item.source);
  });
}
