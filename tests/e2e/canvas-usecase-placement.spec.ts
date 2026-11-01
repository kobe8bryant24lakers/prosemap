import { expect, test, type Page } from '@playwright/test';
import { parseMermaidVisualSource } from '../../lib/mermaid-workbench';
import fixtures from '../fixtures/canvas-group-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

type Box = { x: number; y: number; width: number; height: number };
const separate = (a: Box, b: Box) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
const source = fixtures.templates.find(item => item.template === 'architecture')!.source
  .replace('flowchart LR', 'flowchart LR\n  %% prosemap:usecase');

async function geometry(page: Page) {
  return page.locator('.mermaid-canvas-editor').evaluate(root => {
    const box = (element: Element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return {
      viewport: box(root.querySelector('.canvas-editor-viewport')!),
      nodes: Array.from(root.querySelectorAll<HTMLElement>('.mermaid-canvas-node')).map(element => ({ id: element.dataset.mermaidNodeId!, ...box(element) })),
      groups: Array.from(root.querySelectorAll('.canvas-group-boundary')).map(box),
    };
  });
}

async function expectOutside(page: Page, id: string) {
  const current = await geometry(page), node = current.nodes.find(n => n.id === id)!;
  expect(node).toBeDefined();
  for (const other of [...current.groups, ...current.nodes.filter(n => n.id !== id)]) expect(separate(node, other), `${id} must avoid other nodes and every boundary`).toBe(true);
  expect(node.x).toBeGreaterThanOrEqual(current.viewport.x - 1);
  expect(node.y).toBeGreaterThanOrEqual(current.viewport.y - 1);
  expect(node.x + node.width).toBeLessThanOrEqual(current.viewport.x + current.viewport.width + 1);
  expect(node.y + node.height).toBeLessThanOrEqual(current.viewport.y + current.viewport.height + 1);
}

for (const action of ['参与者', '节点']) {
  test(`${action}: boundary exclusion in a dense use-case canvas`, async ({ page }, testInfo) => {
    await launchDocument(page, `# SYNTHETIC boundary exclusion\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`);
    await openDiagram(page);
    const toolbar = page.locator('.canvas-editor-toolbar');
    await toolbar.getByRole('button', { name: '系统边界', exact: true }).click();
    await toolbar.getByRole('button', { name: '系统边界', exact: true }).click();
    await page.locator('.canvas-fit-button').click();
    const before = parseMermaidVisualSource(await draftSource(page))!;
    await showCanvas(page);
    await toolbar.getByRole('button', { name: action, exact: true }).click();
    await page.locator('.mermaid-canvas-node input').press('Enter');
    const current = parseMermaidVisualSource(await draftSource(page))!;
    const added = current.nodes.filter(n => !before.nodes.some(old => old.id === n.id));
    expect(added).toHaveLength(1);
    expect(added[0].data?.groupId).toBeUndefined();
    expect(current.edges).toEqual(before.edges);
    expect(current.data).toEqual(before.data);
    if (action === '参与者') {
      expect(added[0].label).toContain('«actor»');
      expect(added[0].shape).toBe('rectangle');
    }
    await showCanvas(page);
    await testInfo.attach('synthetic-placement', { body: JSON.stringify(await geometry(page)), contentType: 'application/json' });
    await expectOutside(page, added[0].id);
    await page.locator('.history-tools button').first().click();
    expect(parseMermaidVisualSource(await draftSource(page))).toEqual(before);
  });
}

test('participant is visible outside boundaries after navigating far from the initial graph', async ({ page }) => {
  await launchDocument(page, `# SYNTHETIC distant participant\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`);
  await openDiagram(page);
  const outside = page.locator('.mermaid-canvas-node[data-mermaid-node-id="SyntheticOutside"]');
  await outside.click();
  for (let i = 0; i < 180; i++) await outside.press('Shift+ArrowRight');
  await page.getByRole('button', { name: '选区', exact: true }).click();
  const far = (await geometry(page)).nodes.find(n => n.id === 'SyntheticOutside')!;
  await page.locator('.canvas-editor-toolbar').getByRole('button', { name: '参与者', exact: true }).click();
  await page.locator('.mermaid-canvas-node input').press('Enter');
  const current = parseMermaidVisualSource(await draftSource(page))!;
  const actor = current.nodes.find(n => n.id.startsWith('Actor'))!;
  expect(actor.data?.groupId).toBeUndefined();
  expect(current.data?.diagramType).toBe('usecase');
  await showCanvas(page);
  await expectOutside(page, actor.id);
  // The insertion is near the user-selected distant location, not the initial graph origin.
  const added = (await geometry(page)).nodes.find(n => n.id === actor.id)!;
  expect(Math.abs(added.x - far.x)).toBeLessThan(800);
});

test('new use cases inherit the selected group or fall back to the first boundary', async ({ page }) => {
  const item = fixtures.templates.find(item => item.template === 'usecase')!;
  await launchDocument(page, `# SYNTHETIC use-case membership\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
  await openDiagram(page);
  const before = parseMermaidVisualSource(item.source)!;
  for (const [selected, expected] of [['SyntheticLeaf', 'SyntheticInner'], ['SyntheticOutside', before.data!.groups![0].id]]) {
    await page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${selected}"]`).click();
    await page.locator('.canvas-editor-toolbar').getByRole('button', { name: '用例', exact: true }).click();
    await page.locator('.mermaid-canvas-node input').press('Enter');
    const current = parseMermaidVisualSource(await draftSource(page))!;
    const added = current.nodes.filter(n => !before.nodes.some(old => old.id === n.id));
    expect(added).toHaveLength(1);
    expect(added[0].data?.groupId).toBe(expected);
    expect(added[0].shape).toBe('terminal');
    expect(current.data?.diagramType).toBe('usecase');
    expect(current.edges).toEqual(before.edges);
    await showCanvas(page);
    const boundary = page.locator('.canvas-group-boundary').filter({ has: page.locator('span', { hasText: before.data!.groups!.find(g => g.id === expected)!.label }) }).last();
    const b = (await boundary.boundingBox())!, n = (await page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${added[0].id}"]`).boundingBox())!;
    expect(n.x >= b.x && n.y >= b.y && n.x + n.width <= b.x + b.width && n.y + n.height <= b.y + b.height).toBe(true);
    await page.locator('.history-tools button').first().click();
    expect(parseMermaidVisualSource(await draftSource(page))).toEqual(before);
    await showCanvas(page);
  }
});
