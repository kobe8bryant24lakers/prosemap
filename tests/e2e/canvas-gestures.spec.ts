import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fixture, launchDocument, mod, openDiagram } from './helpers';

type Point = { x: number; y: number };
type Diagram = { category: string; template: string; path: string; kind: string; nodes: number; edges: number };
const manifest = JSON.parse(readFileSync(new URL('../fixtures/manifest.json', import.meta.url), 'utf8'));
const diagrams: Diagram[] = manifest.files.filter((item: Diagram) => item.category === 'editable-diagram');
const compactSource = 'flowchart LR\n  A["A"]\n  B["B"]\n  C["C"]\n  D["D"]\n  E["E"]\n  A --> B\n  B --> C\n  C --> D\n  D --> E';
const compactDocument = `# Canvas gestures\n\n\`\`\`mermaid\n${compactSource}\n\`\`\`\n`;

const nodeById = (page: Page, id: string) => page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"]`);
const undo = (page: Page) => page.locator('.history-tools button').nth(0);
const redo = (page: Page) => page.locator('.history-tools button').nth(1);
const edges = (page: Page) => page.locator('g.canvas-edge');
const point = (node: Locator) => node.evaluate(element => ({ x: parseFloat((element as HTMLElement).style.left), y: parseFloat((element as HTMLElement).style.top) }));
const points = (page: Page) => page.locator('.mermaid-canvas-node').evaluateAll(elements => Object.fromEntries(elements.map(element => [element.getAttribute('data-mermaid-node-id')!, { x: parseFloat((element as HTMLElement).style.left), y: parseFloat((element as HTMLElement).style.top) }])) as Record<string, Point>);
const zoom = async (page: Page) => parseFloat(await page.locator('.canvas-zoom-value').innerText()) / 100;

async function center(node: Locator): Promise<Point> {
  await node.scrollIntoViewIfNeeded();
  const box = await node.boundingBox();
  expect(box).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + Math.min(20, box!.height / 2) };
}

async function expectPoint(node: Locator, expected: Point, tolerance = 0.1) {
  await expect.poll(async () => {
    const actual = await point(node);
    return Math.max(Math.abs(actual.x - expected.x), Math.abs(actual.y - expected.y));
  }).toBeLessThanOrEqual(tolerance);
}

async function freeMovement(page: Page) {
  const snap = page.locator('.canvas-assist-tools button');
  if (await snap.getAttribute('aria-pressed') === 'true') await snap.click();
}

async function openCompact(page: Page) {
  await launchDocument(page, compactDocument);
  await openDiagram(page);
  await page.locator('.canvas-fit-button').click();
  await freeMovement(page);
}

for (const diagram of diagrams) {
  test(`${diagram.template}: selection, keyboard movement, drag and layout history`, async ({ page }) => {
    await launchDocument(page, fixture(diagram.path));
    await openDiagram(page);
    const node = page.locator('.mermaid-canvas-node').first();
    const initial = await point(node);
    await node.evaluate(element => (element as HTMLElement).click());
    await expect(node).toHaveAttribute('aria-pressed', 'true');
    await expectPoint(node, initial);
    await expect(undo(page)).toBeDisabled();
    await node.click();
    await expectPoint(node, initial);
    await expect(undo(page)).toBeDisabled();
    // A repeated ordinary click must remain selection, even with an inspector open.
    await node.click();
    await expectPoint(node, initial);
    await expect(undo(page)).toBeDisabled();
    await freeMovement(page);

    await page.keyboard.press('ArrowRight');
    await expectPoint(node, { x: initial.x + 1, y: initial.y });
    await page.keyboard.press('Shift+ArrowRight');
    await expectPoint(node, { x: initial.x + 11, y: initial.y });
    await page.keyboard.press(`${mod}+z`);
    await expectPoint(node, { x: initial.x + 1, y: initial.y });
    await page.keyboard.press(`${mod}+z`);
    await expectPoint(node, initial);
    await expect(undo(page)).toBeDisabled();

    await node.click();
    await page.keyboard.press('Shift+ArrowDown');
    if (diagram.kind === 'sequence') {
      await expectPoint(node, initial);
      await expect(undo(page)).toBeDisabled();
    } else {
      await expectPoint(node, { x: initial.x, y: initial.y + 10 });
      await page.keyboard.press(`${mod}+z`);
      await expectPoint(node, initial);
    }

    await node.click();
    const origin = await center(node), scale = await zoom(page);
    const stageBefore = await page.locator('.canvas-editor-stage').boundingBox();
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + 54, origin.y + 30, { steps: 5 });
    await page.mouse.up();
    const stageAfter = await page.locator('.canvas-editor-stage').boundingBox();
    // Tall inspectors can put the first node near the viewport edge. Account
    // for real edge auto-scroll: the node must follow the pointer in screen
    // coordinates even when the canvas moves beneath it.
    const moved = {
      x: initial.x + (54 - (stageAfter!.x - stageBefore!.x)) / scale,
      y: diagram.kind === 'sequence' ? initial.y : initial.y + (30 - (stageAfter!.y - stageBefore!.y)) / scale,
    };
    await expectPoint(node, moved, 1.5);
    await expect(undo(page)).toBeEnabled();
    await page.keyboard.press(`${mod}+z`);
    await expectPoint(node, initial);
    await expect(undo(page)).toBeDisabled();
    await page.keyboard.press(`${mod}+Shift+z`);
    await expectPoint(node, moved, 1.5);
    await expect(page.locator('.mermaid-canvas-node')).toHaveCount(diagram.nodes);
    await expect(edges(page)).toHaveCount(diagram.edges);
  });
}

test('release without a pressed move does not snap selection or create history', async ({ page }) => {
  await openCompact(page);
  const node = nodeById(page, 'B'), before = await point(node), origin = await center(node);
  await node.evaluate(element => element.addEventListener('pointerdown', event => {
    (window as any).__canvasPress = { pointerId: (event as PointerEvent).pointerId, clientX: (event as PointerEvent).clientX, clientY: (event as PointerEvent).clientY };
  }, { once: true }));
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  // This deliberately synthetic release exercises missing/coalesced move delivery;
  // ordinary native down/up selection is covered separately for all 11 fixtures.
  await page.evaluate(() => {
    const press = (window as any).__canvasPress;
    window.dispatchEvent(new PointerEvent('pointerup', { ...press, clientX: press.clientX + 8, clientY: press.clientY + 7, buttons: 0 }));
  });
  await page.mouse.up();
  await expectPoint(node, before);
  await expect(undo(page)).toBeDisabled();
});

test('a fast drag queued before animation paint ends at its release position', async ({ page }) => {
  await openCompact(page);
  const node = nodeById(page, 'B');
  await node.click();
  const before = await point(node), origin = await center(node), scale = await zoom(page);
  await node.evaluate(element => element.addEventListener('pointerdown', event => {
    (window as any).__canvasPress = { pointerId: (event as PointerEvent).pointerId, clientX: (event as PointerEvent).clientX, clientY: (event as PointerEvent).clientY };
  }, { once: true }));
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  // Dispatch in one browser turn so the rAF queue cannot paint the move first.
  await page.evaluate(() => {
    const press = (window as any).__canvasPress;
    window.dispatchEvent(new PointerEvent('pointermove', { ...press, clientX: press.clientX + 30, clientY: press.clientY + 15, buttons: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup', { ...press, clientX: press.clientX + 60, clientY: press.clientY + 35, buttons: 0 }));
  });
  await page.mouse.up();
  await expectPoint(node, { x: before.x + 60 / scale, y: before.y + 35 / scale }, 1.5);
  await page.keyboard.press(`${mod}+z`);
  await expectPoint(node, before);
  await expect(undo(page)).toBeDisabled();
});

test('Escape cancels a live drag and preserves the earlier redo branch', async ({ page }) => {
  await openCompact(page);
  const node = nodeById(page, 'B'), before = await point(node);
  await node.click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(`${mod}+z`);
  await expect(redo(page)).toBeEnabled();
  await node.click();
  const origin = await center(node);
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + 50, origin.y + 28, { steps: 3 });
  await expect.poll(async () => (await point(node)).x).not.toBe(before.x);
  await page.keyboard.press('Escape');
  await expectPoint(node, before);
  await page.mouse.up();
  await expectPoint(node, before);
  await expect(undo(page)).toBeDisabled();
  await expect(redo(page)).toBeEnabled();
  await page.keyboard.press(`${mod}+Shift+z`);
  await expectPoint(node, { x: before.x + 1, y: before.y });
});

test('undo during a drag cancels only that gesture before undoing earlier work', async ({ page }) => {
  await openCompact(page);
  const node = nodeById(page, 'B'), before = await point(node);
  await node.click();
  await page.keyboard.press('ArrowRight');
  const origin = await center(node);
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + 60, origin.y + 20, { steps: 3 });
  await expect.poll(async () => (await point(node)).x).toBeGreaterThan(before.x + 1);
  await page.keyboard.press(`${mod}+z`);
  await expectPoint(node, { x: before.x + 1, y: before.y });
  await page.mouse.up();
  await expect(undo(page)).toBeEnabled();
  await page.keyboard.press(`${mod}+z`);
  await expectPoint(node, before);
  await expect(undo(page)).toBeDisabled();
});

test('reverse marquee selects the full diagram and Shift click toggles one node', async ({ page }) => {
  await openCompact(page);
  const boxes = await page.locator('.mermaid-canvas-node').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  }));
  const left = Math.min(...boxes.map(box => box.left)) - 8, right = Math.max(...boxes.map(box => box.right)) + 8;
  const top = Math.min(...boxes.map(box => box.top)) - 8, bottom = Math.max(...boxes.map(box => box.bottom)) + 8;
  await page.mouse.move(right, bottom);
  await page.mouse.down();
  await page.mouse.move(left, top, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.mermaid-canvas-node.selected')).toHaveCount(5);
  await nodeById(page, 'C').click({ modifiers: ['Shift'] });
  await expect(page.locator('.mermaid-canvas-node.selected')).toHaveCount(4);
  await nodeById(page, 'C').click({ modifiers: ['Shift'] });
  await expect(page.locator('.mermaid-canvas-node.selected')).toHaveCount(5);
  await expect(undo(page)).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.mermaid-canvas-node.selected')).toHaveCount(0);
});

test('multi-selection alignment, group dragging and copying preserve relative layout and internal edges', async ({ page }) => {
  await openCompact(page);
  await nodeById(page, 'A').click();
  await nodeById(page, 'B').click({ modifiers: ['Shift'] });
  await nodeById(page, 'C').click({ modifiers: ['Shift'] });
  const before = await points(page);
  await page.getByRole('button', { name: '左对齐', exact: true }).click();
  await expect.poll(async () => {
    const current = await points(page);
    return [current.A.x, current.B.x, current.C.x];
  }).toEqual([before.A.x, before.A.x, before.A.x]);
  await page.keyboard.press(`${mod}+z`);
  expect(await points(page)).toEqual(before);
  // Undo keeps the still-existing multi-selection, so users can continue
  // dragging immediately without rebuilding it (Shift would toggle it off).
  expect(await page.locator('.mermaid-canvas-node.selected').evaluateAll(elements =>
    elements.map(element => element.getAttribute('data-mermaid-node-id')).sort(),
  )).toEqual(['A', 'B', 'C']);
  const origin = await center(nodeById(page, 'B')), scale = await zoom(page);
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + 40, origin.y + 24, { steps: 4 });
  await page.mouse.up();
  for (const id of ['A', 'B', 'C']) await expectPoint(nodeById(page, id), { x: before[id].x + 40 / scale, y: before[id].y + 24 / scale }, 1.5);
  await expectPoint(nodeById(page, 'D'), before.D);
  await expectPoint(nodeById(page, 'E'), before.E);
  const moved = await points(page);
  await page.keyboard.press(`${mod}+d`);
  await expect(page.locator('.mermaid-canvas-node')).toHaveCount(8);
  await expect(edges(page)).toHaveCount(6); // A→B and B→C copied; C→D remains external.
  const copies = await page.locator('.mermaid-canvas-node.selected').evaluateAll(elements => elements.map(element => ({ x: parseFloat((element as HTMLElement).style.left), y: parseFloat((element as HTMLElement).style.top) })));
  expect(copies).toHaveLength(3);
  expect(copies[1].x - copies[0].x).toBeCloseTo(moved.B.x - moved.A.x, 4);
  expect(copies[2].y - copies[0].y).toBeCloseTo(moved.C.y - moved.A.y, 4);
  await page.keyboard.press('Delete');
  await expect(page.locator('.mermaid-canvas-node')).toHaveCount(5);
  await expect(edges(page)).toHaveCount(4);
  await page.keyboard.press(`${mod}+z`);
  await expect(page.locator('.mermaid-canvas-node')).toHaveCount(8);
  await expect(edges(page)).toHaveCount(6);
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect(page.locator('.mermaid-canvas-node')).toHaveCount(5);
  await expect(edges(page)).toHaveCount(4);
});

test('connector drops use the release target and Escape cancels a pending connection', async ({ page }) => {
  await openCompact(page);
  const a = nodeById(page, 'A'), c = nodeById(page, 'C');
  await a.click();
  let origin = await center(a.locator('.canvas-node-connector'));
  const target = await center(c);
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await page.mouse.up();
  await expect(edges(page)).toHaveCount(5);
  await page.keyboard.press(`${mod}+z`);
  await expect(edges(page)).toHaveCount(4);
  await a.click();
  origin = await center(a.locator('.canvas-node-connector'));
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await page.mouse.move(target.x, target.y + 90, { steps: 3 });
  await page.mouse.up();
  await expect(edges(page)).toHaveCount(4);
  await a.click();
  origin = await center(a.locator('.canvas-node-connector'));
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(edges(page)).toHaveCount(4);
  await expect(page.locator('.canvas-connection-preview')).toHaveCount(0);
  await expect(undo(page)).toBeDisabled();
});
