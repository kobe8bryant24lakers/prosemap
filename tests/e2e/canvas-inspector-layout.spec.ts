import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { draftSource, fixture, launchDocument, openDiagram } from './helpers';

// Synthetic fixtures cover each editable template, including property rows
// that wrap in a narrow window. Browser checks supplement native acceptance.
const manifest = JSON.parse(readFileSync(new URL('../fixtures/manifest.json', import.meta.url), 'utf8'));
const diagrams = manifest.files.filter((file: { category: string }) => file.category === 'editable-diagram');

for (const width of [1440, 900]) for (const diagram of diagrams) {
  test(`${diagram.template} at ${width}px: selecting an object keeps the canvas boundary and object position`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 650 });
    await launchDocument(page, fixture(diagram.path));
    await openDiagram(page);
    await page.locator('.canvas-fit-button').click();
    const node = page.locator('.mermaid-canvas-node').filter({ hasNot: page.locator('.canvas-pseudo-node') }).first();
    await node.scrollIntoViewIfNeeded();
    const viewport = page.locator('.canvas-editor-viewport');
    const beforeViewport = await viewport.boundingBox();
    const beforeNode = await node.boundingBox();
    await node.click();
    await expect(node).toHaveAttribute('aria-pressed', 'true');
    expect(await viewport.boundingBox()).toEqual(beforeViewport);
    const afterNode = await node.boundingBox();
    expect(beforeNode).not.toBeNull();
    expect(afterNode).not.toBeNull();
    expect(Math.hypot(afterNode!.x - beforeNode!.x, afterNode!.y - beforeNode!.y)).toBeLessThan(3);
    await expect(page.locator('.history-tools button').first()).toBeDisabled();
  });
}

test('narrow ER inspector scrolls to its last property without moving the canvas or creating extra history', async ({ page }, testInfo) => {
  const source = 'erDiagram\n  %% Synthetic inspector scroll\n  SyntheticAlpha ||--o{ SyntheticBeta : creates';
  await page.setViewportSize({ width: 900, height: 650 });
  await launchDocument(page, `# Synthetic inspector scrolling\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`);
  await openDiagram(page);
  await page.locator('.canvas-fit-button').click();
  const label = page.locator('.canvas-edge-label').first();
  await label.click();
  const viewport = await page.locator('.canvas-editor-viewport').boundingBox();
  const beforeLabel = await label.boundingBox();
  const panel = await page.locator('.canvas-selection-panel').boundingBox();
  if (!panel) throw new Error('Missing selection properties');
  await page.mouse.move(panel.x + panel.width - 20, panel.y + panel.height - 12);
  await page.mouse.wheel(0, 240);
  const relation = page.getByRole('combobox', { name: '关系', exact: true });
  await expect(relation).toBeInViewport({ ratio: 0.999 });
  await relation.click();
  await expect(relation).toBeFocused();
  // OS popup keyboard navigation is covered by installed-app acceptance.
  await relation.selectOption('non-identifying');
  await expect(relation).toHaveValue('non-identifying');
  expect(await page.locator('.canvas-editor-viewport').boundingBox()).toEqual(viewport);
  expect(await label.boundingBox()).toEqual(beforeLabel);
  await page.screenshot({ path: testInfo.outputPath('narrow-er-properties.png') });
  await page.locator('.history-tools button').first().click();
  expect(await draftSource(page)).toBe(source);
});

for (const item of [
  { kind: 'mindmap', label: '父子关系', source: 'mindmap\n  root((SyntheticRoot))\n    SyntheticChild' },
  { kind: 'gantt', label: '依赖', source: 'gantt\n  dateFormat YYYY-MM-DD\n  Synthetic A :a, 2026-01-01, 1d\n  Synthetic B :b, after a, 1d' },
]) {
  test(`${item.kind}: structural edge labels do not advertise unavailable editing`, async ({ page }) => {
    await launchDocument(page, `# Synthetic structural edge\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    await page.locator('.canvas-fit-button').click();
    const edge = page.locator('.canvas-edge-hit');
    const bounds = await edge.boundingBox();
    if (!bounds) throw new Error('Missing structural edge');
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect(page.locator('.canvas-edge.selected')).toHaveCount(1);
    const label = page.locator('.canvas-edge-label');
    await expect(label).toHaveText(item.label, { timeout: 1000 });
    await label.dblclick();
    await expect(label.locator('input')).toHaveCount(0);
    await expect(page.locator('.history-tools button').first()).toBeDisabled();
    expect(await draftSource(page)).toBe(item.source);
  });
}
