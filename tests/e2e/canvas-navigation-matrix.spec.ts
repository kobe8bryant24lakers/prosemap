import { expect, test, type Page } from '@playwright/test';
import fixtures from '../fixtures/canvas-navigation-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

const snapshot = (page: Page) => page.locator('.mermaid-canvas-editor').evaluate(root => {
  const v = root.querySelector<HTMLElement>('.canvas-editor-viewport')!;
  const s = root.querySelector<HTMLElement>('.canvas-editor-stage')!;
  const rect = (n: Element) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  return {
    zoom: new DOMMatrix(getComputedStyle(s).transform).a, view: { ...rect(v), width: v.clientWidth, height: v.clientHeight }, stage: rect(s),
    scroll: [v.scrollLeft, v.scrollTop], max: [v.scrollWidth - v.clientWidth, v.scrollHeight - v.clientHeight],
    nodes: Array.from(root.querySelectorAll<HTMLElement>('.mermaid-canvas-node')).map(n => ({ id: n.dataset.mermaidNodeId!, left: n.style.left, top: n.style.top, width: n.style.width, height: n.style.height, selected: n.getAttribute('aria-pressed') === 'true', rect: rect(n) })),
  };
});
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
const anchor = (s: Snapshot) => [(s.view.x + s.view.width / 2 - s.stage.x) / s.zoom, (s.view.y + s.view.height / 2 - s.stage.y) / s.zoom];
function expectCenter(before: Snapshot, after: Snapshot) {
  const old = anchor(before);
  for (const [i, axis, size] of [[0, 'x', 'width'], [1, 'y', 'height']] as const) {
    const stageOffset = after.stage[axis] - after.view[axis] + after.scroll[i];
    const wanted = Math.max(0, Math.min(after.max[i], stageOffset + old[i] * after.zoom - after.view[size] / 2));
    expect(Math.abs(after.scroll[i] - wanted)).toBeLessThanOrEqual(2);
  }
}
const layout = (s: Snapshot) => s.nodes.map(({ id, left, top, width, height }) => ({ id, left, top, width, height }));

for (const item of fixtures.templates) {
  test(`${item.template}: zoom bounds, selection fit, modifier selection and style do not change the diagram`, async ({ page }) => {
    await launchDocument(page, `# SYNTHETIC navigation\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    const root = page.locator('.mermaid-canvas-editor'), value = root.locator('.canvas-zoom-value');
    const initial = await snapshot(page);
    await value.click();
    for (let i = 0; i < 13; i++) await page.getByRole('button', { name: '缩小画布', exact: true }).click();
    await expect(value).toHaveText('2%');
    await page.getByRole('button', { name: '放大画布', exact: true }).click();
    await expect(value).toHaveText('12%');
    await value.click();
    // Check each user action: integer scroll rounding can accumulate across ten zooms.
    for (let i = 0; i < 13; i++) {
      const before = await snapshot(page);
      await page.getByRole('button', { name: '放大画布', exact: true }).click();
      expectCenter(before, await snapshot(page));
    }
    await expect(value).toHaveText('200%');
    const beforePan = await snapshot(page);
    const viewport = root.locator('.canvas-editor-viewport');
    await viewport.hover(); await page.mouse.wheel(135, 165);
    await expect.poll(async () => (await snapshot(page)).scroll).not.toEqual(beforePan.scroll);
    const panned = await snapshot(page); await value.click();
    await expect(value).toHaveText('100%'); expectCenter(panned, await snapshot(page));
    await root.locator('.canvas-fit-button').click();
    const node = (id: string) => root.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"]`);
    const ids = item.nodes.slice(0, 3).map(n => n.id);
    for (const modifier of item.multi ? ['Shift', 'Meta', 'Control'] as const : []) {
      if ((await snapshot(page)).nodes.some(n => n.selected)) {
        await root.focus(); await page.keyboard.press('Escape');
        expect((await snapshot(page)).nodes.filter(n => n.selected)).toHaveLength(0);
      }
      await node(ids[0]).click();
      await node(ids[1]).click({ modifiers: [modifier] });
      await node(ids[2]).click({ modifiers: [modifier] });
      await expect.poll(async () => (await snapshot(page)).nodes.filter(n => n.selected).map(n => n.id).sort()).toEqual([...ids].sort());
      await node(ids[1]).click({ modifiers: [modifier] });
      await expect.poll(async () => (await snapshot(page)).nodes.filter(n => n.selected).map(n => n.id).sort()).toEqual([ids[0], ids[2]].sort());
    }
    for (const multi of item.multi ? [false, true] : [false]) {
      await root.locator('.canvas-fit-button').click();
      if ((await snapshot(page)).nodes.some(n => n.selected)) { await root.focus(); await page.keyboard.press('Escape'); }
      await node(item.nodeId).click();
      if (multi) await node(ids.find(id => id !== item.nodeId)!).click({ modifiers: ['Shift'] });
      await page.getByRole('button', { name: '选区', exact: true }).click();
      const s = await snapshot(page), selected = s.nodes.filter(n => n.selected);
      expect(selected).toHaveLength(multi ? 2 : 1); expect(s.zoom).toBeLessThanOrEqual(2);
      for (const n of selected) {
        expect(n.rect.x).toBeGreaterThanOrEqual(s.view.x - 2);
        expect(n.rect.y).toBeGreaterThanOrEqual(s.view.y - 2);
        expect(n.rect.x + n.rect.width).toBeLessThanOrEqual(s.view.x + s.view.width + 2);
        expect(n.rect.y + n.rect.height).toBeLessThanOrEqual(s.view.y + s.view.height + 2);
      }
    }
    await page.getByRole('button', { name: '手绘', exact: true }).click();
    await expect(root).toHaveClass(/canvas-style-handdrawn/);
    expect(layout(await snapshot(page))).toEqual(layout(initial));
    expect(await draftSource(page)).toBe(item.source); await showCanvas(page);
    await page.getByRole('button', { name: '标准', exact: true }).click();
    await expect(root).toHaveClass(/canvas-style-standard/);
    expect(layout(await snapshot(page))).toEqual(layout(initial));
    expect(await draftSource(page)).toBe(item.source);
  });
}
