import { expect, test, type Page } from '@playwright/test';
import { parseMermaidVisualSource } from '../../lib/mermaid-workbench';
import fixtures from '../fixtures/canvas-group-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

const presets = [
  { label: '流程', shape: 'rectangle' },
  { label: '判断', shape: 'decision' },
  { label: '数据', shape: 'database' },
  { label: '起止', shape: 'terminal' },
] as const;
const node = (page: Page, id: string) => page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"]`);
const positions = (page: Page) => page.locator('.mermaid-canvas-node, .canvas-group-boundary').evaluateAll(elements => elements.map(e => ({ id: (e as HTMLElement).dataset.mermaidNodeId ?? e.querySelector('span')!.textContent, style: (e as HTMLElement).style.cssText })));
type Box = { x: number; y: number; width: number; height: number };
const separate = (a: Box, b: Box) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
const inside = (a: Box, b: Box) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1;

async function geometry(page: Page) {
  return page.locator('.mermaid-canvas-editor').evaluate(root => {
    const box = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return {
      viewport: box(root.querySelector('.canvas-editor-viewport')!),
      nodes: Array.from(root.querySelectorAll<HTMLElement>('.mermaid-canvas-node')).map(e => ({ id: e.dataset.mermaidNodeId!, ...box(e) })),
      groups: Array.from(root.querySelectorAll('.canvas-group-boundary')).map(e => ({ label: e.querySelector('span')!.textContent, ...box(e) })),
    };
  });
}

async function expectPlacement(page: Page, id: string, graph: NonNullable<ReturnType<typeof parseMermaidVisualSource>>) {
  const boxes = await geometry(page), added = boxes.nodes.find(n => n.id === id)!;
  expect(inside(added, boxes.viewport), 'new object is visible').toBe(true);
  for (const other of boxes.nodes.filter(n => n.id !== id)) expect(separate(added, other), `avoid node ${other.id}`).toBe(true);
  const ancestors = new Set<string>();
  for (let group = graph.nodes.find(n => n.id === id)?.data?.groupId; group; group = graph.data!.groups!.find(g => g.id === group)?.parentId) ancestors.add(group);
  for (const group of graph.data!.groups!) {
    const boundary = boxes.groups.find(g => g.label === group.label)!;
    expect(ancestors.has(group.id) ? inside(added, boundary) : separate(added, boundary), `membership boundary ${group.id}`).toBe(true);
  }
  return added;
}

for (const item of fixtures.templates) {
  // Fabricated collision: the ID normally allocated next already names a group.
  const collisionId = `N${parseMermaidVisualSource(item.source)!.nodes.length + 1}`;
  const source = item.source.replace('subgraph SyntheticOther[', `subgraph ${collisionId}[`);
  const before = parseMermaidVisualSource(source)!;
  for (const selected of [false, true]) for (const preset of presets) {
    test(`${item.template}: ${preset.label}, selected=${selected}, collision-safe library insertion`, async ({ page }) => {
      await launchDocument(page, `# SYNTHETIC object library\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`);
      await openDiagram(page);
      if (selected) await node(page, 'SyntheticLeaf').click();
      else if (await page.locator('.mermaid-canvas-node[aria-pressed="true"]').count()) {
        await page.locator('.mermaid-canvas-editor').focus(); await page.keyboard.press('Escape');
      }
      await expect(page.locator('.mermaid-workbench')).toBeVisible();
      await expect(page.locator('.mermaid-canvas-node[aria-pressed="true"]')).toHaveCount(selected ? 1 : 0);
      const originalPositions = await positions(page);
      await page.locator('.canvas-node-library').getByRole('button', { name: preset.label, exact: true }).click();
      const input = page.locator('.mermaid-canvas-node input');
      await expect(input).toBeFocused();
      const label = `SYNTHETIC ${preset.shape}`;
      await input.fill(label); await input.press('Enter');
      const current = parseMermaidVisualSource(await draftSource(page))!;
      const added = current.nodes.filter(n => !before.nodes.some(old => old.id === n.id));
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({ label, shape: preset.shape });
      expect(added[0].data?.groupId).toBe(selected ? 'SyntheticInner' : undefined);
      expect(added[0].id).not.toBe(collisionId);
      expect(new Set([...current.nodes, ...current.data!.groups!].map(n => n.id)).size).toBe(current.nodes.length + current.data!.groups!.length);
      expect(current.edges).toEqual(before.edges);
      expect(current.nodes.filter(n => n.id !== added[0].id)).toEqual(before.nodes);
      expect(current.data).toEqual(before.data);
      await showCanvas(page); await expectPlacement(page, added[0].id, current);
      const changedPositions = await positions(page);
      const undo = page.locator('.history-tools button').first(), redo = page.locator('.history-tools button').nth(1);
      await undo.click(); await undo.click();
      expect(await positions(page)).toEqual(originalPositions);
      expect(parseMermaidVisualSource(await draftSource(page))).toEqual(before);
      await showCanvas(page); await redo.click(); await redo.click();
      expect(await positions(page)).toEqual(changedPositions);
      expect(parseMermaidVisualSource(await draftSource(page))).toEqual(current);
    });
  }
  for (const selected of ['SyntheticOutside', 'SyntheticLeaf']) for (const action of [
    { label: '下游流程', shape: 'rectangle', direction: 'right' },
    { label: '分支判断', shape: 'decision', direction: 'bottom' },
  ]) {
    test(`${item.template}: ${action.label} from ${selected} keeps direction, edges and membership`, async ({ page }, testInfo) => {
      await launchDocument(page, `# SYNTHETIC connected object\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`);
      await openDiagram(page); await node(page, selected).click();
      const originalPositions = await positions(page);
      await page.locator('.canvas-context-bar').getByRole('button', { name: action.label, exact: true }).click();
      const input = page.locator('.mermaid-canvas-node input');
      await expect(input).toBeFocused();
      await input.fill(`SYNTHETIC ${action.direction}`); await input.press('Enter');
      const current = parseMermaidVisualSource(await draftSource(page))!;
      const added = current.nodes.filter(n => !before.nodes.some(old => old.id === n.id));
      expect(added).toHaveLength(1);
      expect(added[0].shape).toBe(action.shape);
      expect(added[0].data?.groupId).toBe(before.nodes.find(n => n.id === selected)!.data?.groupId);
      expect(added[0].id).not.toBe(collisionId);
      expect(current.edges.slice(0, before.edges.length)).toEqual(before.edges);
      expect(current.edges).toHaveLength(before.edges.length + 1);
      expect(current.edges.at(-1)).toMatchObject({ from: selected, to: added[0].id });
      expect(current.nodes.filter(n => n.id !== added[0].id)).toEqual(before.nodes);
      expect(current.data).toEqual(before.data);
      expect(current.direction).toBe(before.direction);
      await showCanvas(page);
      const addedBox = await expectPlacement(page, added[0].id, current), from = (await node(page, selected).boundingBox())!;
      await testInfo.attach('synthetic-connected-geometry', { body: JSON.stringify(await geometry(page)), contentType: 'application/json' });
      if (action.direction === 'right') expect(addedBox.x).toBeGreaterThanOrEqual(from.x + from.width);
      else expect(addedBox.y).toBeGreaterThanOrEqual(from.y + from.height);
      const changedPositions = await positions(page);
      await page.locator('.history-tools button').first().click(); await page.locator('.history-tools button').first().click();
      expect(await positions(page)).toEqual(originalPositions);
      expect(parseMermaidVisualSource(await draftSource(page))).toEqual(before);
      await showCanvas(page); await page.locator('.history-tools button').nth(1).click(); await page.locator('.history-tools button').nth(1).click();
      expect(await positions(page)).toEqual(changedPositions);
      expect(parseMermaidVisualSource(await draftSource(page))).toEqual(current);
    });
  }
}
