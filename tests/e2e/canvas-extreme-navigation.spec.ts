import { expect, test } from '@playwright/test';
import fixtures from '../fixtures/synthetic-extreme-diagrams.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram } from './helpers';

for (const size of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) for (const fixture of fixtures) {
  test(`${fixture.kind} fifty objects remain navigable at ${size.width}x${size.height}`, async ({ page }, info) => {
    await page.setViewportSize(size);
    const original = `# SYNTHETIC extreme ${fixture.kind}\n\n\`\`\`mermaid\n${fixture.source}\n\`\`\`\n\nSYNTHETIC_END\n`;
    await launchDocument(page, original, `SYNTHETIC_${fixture.kind}.md`); await openDiagram(page);
    const canvas = page.locator('.mermaid-canvas-editor'), nodes = canvas.locator('.mermaid-canvas-node');
    await expect(nodes).toHaveCount(50);
    const geometry = () => canvas.evaluate(el => {
      const viewport = el.querySelector<HTMLElement>('.canvas-editor-viewport')!, stage = el.querySelector<HTMLElement>('.canvas-editor-stage')!;
      const v = viewport.getBoundingClientRect(), zoom = new DOMMatrix(getComputedStyle(stage).transform).a;
      return { viewport: { x: v.x, y: v.y, width: viewport.clientWidth, height: viewport.clientHeight }, zoom, scroll: [viewport.scrollLeft, viewport.scrollTop],
        nodes: [...el.querySelectorAll<HTMLElement>('.mermaid-canvas-node')].map(node => {
          const r = node.getBoundingClientRect(), label = node.querySelector('.canvas-node-title')!;
          return { id: node.dataset.mermaidNodeId, x: r.x, y: r.y, width: r.width, height: r.height, fontSize: parseFloat(getComputedStyle(label).fontSize) * zoom };
        }) };
    });
    const inside = (node: { x: number; y: number; width: number; height: number }, view: { x: number; y: number; width: number; height: number }) => node.x >= view.x - 2 && node.y >= view.y - 2 && node.x + node.width <= view.x + view.width + 2 && node.y + node.height <= view.y + view.height + 2;
    const initial = await geometry();
    expect(initial.zoom).toBeGreaterThanOrEqual(0.75);
    const first = initial.nodes.find(n => n.id === fixture.firstId)!;
    expect(inside(first, initial.viewport)).toBe(true); expect(first.fontSize).toBeGreaterThanOrEqual(10);
    await page.screenshot({ path: info.outputPath('initial.png') });
    await canvas.locator('.canvas-fit-button').click();
    const fitted = await geometry(); expect(fitted.nodes.every(node => inside(node, fitted.viewport))).toBe(true);
    await page.screenshot({ path: info.outputPath('fitted.png') });
    const last = canvas.locator(`.mermaid-canvas-node[data-mermaid-node-id="${fixture.lastId}"]`);
    await last.click(); await expect(last).toHaveAttribute('aria-pressed', 'true');
    await canvas.getByRole('button', { name: '选区', exact: true }).click();
    const selected = await geometry(); expect(inside(selected.nodes.find(n => n.id === fixture.lastId)!, selected.viewport)).toBe(true);
    // Sequence selection includes the full lifeline, not just its title card.
    expect(selected.zoom).toBeGreaterThanOrEqual(fitted.zoom);
    await page.screenshot({ path: info.outputPath('selected.png') });
    // Wheel is real browser input; this does not imply installed native wheel support.
    await canvas.locator('.canvas-editor-viewport').hover(); await page.mouse.wheel(-100000, -100000);
    await expect.poll(async () => (await geometry()).scroll.every(v => v <= 1)).toBe(true);
    expect(await draftSource(page)).toBe(fixture.source);
    expect(await page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString())).toBe(original);
    await info.attach('extreme-navigation-geometry', { body: JSON.stringify({ initial, fitted, selected }), contentType: 'application/json' });
  });
}
