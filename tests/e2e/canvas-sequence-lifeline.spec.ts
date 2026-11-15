import { expect, test, type Page } from '@playwright/test';
import { parseMermaidVisualSource } from '../../lib/mermaid-workbench';
import { draftSource, launchDocument, openDiagram, savedSource, showCanvas } from './helpers';

// Synthetic S07/S10 regression. Only desktop IPC is mocked; these browser
// pointer checks do not replace installed native WebView acceptance.
const source = 'sequenceDiagram\n  autonumber\n  actor A as Synthetic Actor\n  participant B as Synthetic App\n  participant C as Synthetic API\n  A->>B: M1 request\n  B-->>A: M2 response\n  B->>C: M3 forward';
const node = (page: Page, id: string) => page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"]`);
const edges = (page: Page) => page.locator('g.canvas-edge');
const labelInput = (page: Page) => page.locator('.canvas-edge-label input');
const undo = (page: Page) => page.locator('.history-tools button').nth(0);
const redo = (page: Page) => page.locator('.history-tools button').nth(1);

async function open(page: Page) {
  await launchDocument(page, `# Synthetic sequence lifeline\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`, 'synthetic-sequence-lifeline.md');
  await openDiagram(page);
  await page.locator('.canvas-fit-button').click();
}

async function centerLifeline(page: Page, id: string) {
  const line = node(page, id).locator('.canvas-sequence-lifeline-connector');
  const box = await line.boundingBox();
  expect(box).not.toBeNull();
  const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height * 0.78 };
  // The central connector overlays the SVG line. Testing the wider hover region
  // would miss the installed-app failure, because that region already connects.
  expect(await page.evaluate(({ x, y, id }) => {
    const hit = document.elementFromPoint(x, y);
    return hit?.classList.contains('canvas-sequence-lifeline-connector') && hit.getAttribute('data-mermaid-node-id') === id;
  }, { ...point, id })).toBe(true);
  return point;
}

async function beginFromB(page: Page) {
  await node(page, 'B').click();
  await page.getByRole('button', { name: '从这里发消息', exact: true }).click();
  await expect(node(page, 'B')).toHaveClass(/connection-origin/);
}

async function checkNewMessage(page: Page, from: string, to: string, namingExpected = true) {
  await expect(edges(page)).toHaveCount(4, { timeout: 2000 });
  if (namingExpected) await expect(labelInput(page)).toBeFocused();
  const created = await draftSource(page);
  await showCanvas(page);
  const graph = parseMermaidVisualSource(created)!;
  expect(graph.nodes.map(item => item.data?.ref)).toEqual(['A', 'B', 'C']);
  expect(graph.edges.slice(0, 3)).toEqual(parseMermaidVisualSource(source)!.edges);
  expect(graph.edges[3]).toMatchObject({ from, to, data: { token: '->>' } });
  await undo(page).click();
  expect(await draftSource(page)).toBe(source);
  await showCanvas(page);
  await expect(undo(page)).toBeDisabled();
  await redo(page).click();
  expect(await draftSource(page)).toBe(created);
  await showCanvas(page);
  await expect(edges(page)).toHaveCount(4);
}

for (const target of ['header', 'central lifeline']) {
  test(`sequence: Send from here completes once on the ${target} and opens message naming`, async ({ page }) => {
    await open(page);
    await beginFromB(page);
    if (target === 'header') await node(page, 'C').click();
    else {
      const p = await centerLifeline(page, 'A');
      await page.mouse.click(p.x, p.y);
    }
    await checkNewMessage(page, 'B', target === 'header' ? 'C' : 'A');
    await page.locator('.canvas-edge-label').last().dblclick();
    await labelInput(page).fill('Synthetic completed message');
    await labelInput(page).press('Enter');
    const expected = `${source}\n  B->>${target === 'header' ? 'C' : 'A'}: Synthetic completed message`;
    expect(await draftSource(page)).toBe(expected);
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.preview-pane .mermaid-svg svg')).toHaveCount(1);
    await expect(page.locator('.preview-pane .mermaid-error')).toHaveCount(0);
    expect(await savedSource(page)).toBe(`# Synthetic sequence lifeline\n\n\`\`\`mermaid\n${expected}\n\`\`\`\n`);
  });
}

test('sequence: plain central lifeline clicks only select each participant without history', async ({ page }) => {
  await open(page);
  for (const id of ['A', 'B', 'C']) {
    const p = await centerLifeline(page, id);
    await page.mouse.click(p.x, p.y);
    await expect(node(page, id)).toHaveAttribute('aria-pressed', 'true');
    await expect(edges(page)).toHaveCount(3);
    await expect(labelInput(page)).toHaveCount(0);
    await expect(undo(page)).toBeDisabled();
  }
  expect(await draftSource(page)).toBe(source);
});

test('sequence: central lifeline chooses an origin in empty connection mode then completes a message', async ({ page }) => {
  await open(page);
  await page.locator('.canvas-editor-toolbar').getByRole('button', { name: '发送消息', exact: true }).click();
  let p = await centerLifeline(page, 'A');
  await page.mouse.click(p.x, p.y);
  await expect(node(page, 'A')).toHaveClass(/connection-origin/, { timeout: 2000 });
  await expect(edges(page)).toHaveCount(3);
  await expect(undo(page)).toBeDisabled();
  p = await centerLifeline(page, 'C');
  await page.mouse.click(p.x, p.y);
  await checkNewMessage(page, 'A', 'C');
});

for (const connectionMode of [false, true]) {
  test(`sequence: central lifeline drag creates exactly one message with connection mode ${connectionMode}`, async ({ page }) => {
    await open(page);
    if (connectionMode) await beginFromB(page);
    const start = await centerLifeline(page, 'A');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const end = await centerLifeline(page, 'C');
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    await checkNewMessage(page, 'A', 'C');
  });
}

test('sequence: a central lifeline double click in connection mode does not add a second message', async ({ page }) => {
  await open(page);
  await beginFromB(page);
  const p = await centerLifeline(page, 'A');
  await page.mouse.dblclick(p.x, p.y);
  // The second press can select the lifeline and end inline editing. It must
  // never add a second (self) message after the first click completed B→A.
  await checkNewMessage(page, 'B', 'A', false);
});

test('sequence: Escape during a central lifeline drag cancels without creating a message', async ({ page }) => {
  await open(page);
  await beginFromB(page);
  const start = await centerLifeline(page, 'A');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const end = await centerLifeline(page, 'C');
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(edges(page)).toHaveCount(3);
  await expect(labelInput(page)).toHaveCount(0);
  await expect(undo(page)).toBeDisabled();
  expect(await draftSource(page)).toBe(source);
  await showCanvas(page);
  await beginFromB(page);
  const next = await centerLifeline(page, 'C');
  await page.mouse.click(next.x, next.y);
  await checkNewMessage(page, 'B', 'C');
});
