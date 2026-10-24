import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { draftSource, fixture, launchDocument, mod, openDiagram, savedSource, showCanvas } from './helpers';

const manifest = JSON.parse(readFileSync(new URL('../fixtures/manifest.json', import.meta.url), 'utf8'));
const diagrams = manifest.files.filter((f: { category: string }) => f.category === 'editable-diagram');

for (const diagram of diagrams) {
  test(`${diagram.template}: complex canvas edit/history/source/save`, async ({ page }, testInfo) => {
    const original = fixture(diagram.path);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await launchDocument(page, original);
    await expect(page.locator('.preview-pane .mermaid-svg svg')).toHaveCount(1);
    await openDiagram(page);
    const nodes = page.locator('.mermaid-canvas-node');
    await expect(nodes).toHaveCount(diagram.nodes);
    const beforeSource = await draftSource(page);
    await showCanvas(page);
    const node = nodes.filter({ hasNot: page.locator('.canvas-pseudo-node') }).first();
    const id = await node.getAttribute('data-mermaid-node-id');
    await node.dblclick();
    const label = page.locator('.mermaid-canvas-node input');
    await expect(label).toBeVisible();
    await label.fill(`验收_${diagram.template}_中文🧭`);
    await label.press('Enter');
    await page.keyboard.press(`${mod}+z`);
    const undone = await draftSource(page);
    expect(undone).toBe(beforeSource);
    await showCanvas(page);
    await page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"]`).click();
    await page.keyboard.press(`${mod}+Shift+z`);
    const renamed = await draftSource(page);
    expect(renamed).toContain(`验收_${diagram.template}_中文🧭`);
    await showCanvas(page);
    await expect(nodes).toHaveCount(diagram.nodes);
    await page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"]`).click();
    await page.keyboard.press(`${mod}+d`);
    await expect(nodes).toHaveCount(diagram.nodes + 1);
    await page.keyboard.press('Delete');
    await expect(nodes).toHaveCount(diagram.nodes);
    await page.keyboard.press(`${mod}+z`);
    await expect(nodes).toHaveCount(diagram.nodes + 1);
    await page.keyboard.press(`${mod}+Shift+z`);
    await expect(nodes).toHaveCount(diagram.nodes);
    const finalDraft = await draftSource(page);
    // Copy/delete must not silently erase unrelated edges or directives.
    expect(finalDraft).toBe(renamed);
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
    const saved = await savedSource(page);
    const expected = original.replace(/(```mermaid\r?\n)[\s\S]*?(\r?\n```)/, `$1${finalDraft}$2`);
    expect(saved).toBe(expected);
    await page.locator('.cm-content').click();
    await page.keyboard.press(`${mod}+z`);
    expect(await savedSource(page)).toBe(original);
    await page.locator('.cm-content').click();
    await page.keyboard.press(`${mod}+Shift+z`);
    expect(await savedSource(page)).toBe(expected);
    expect(errors).toEqual([]);
    await testInfo.attach('source-roundtrip', { body: JSON.stringify({ original, finalDraft, saved }, null, 2), contentType: 'application/json' });
    await page.screenshot({ path: testInfo.outputPath('edited-diagram.png') });
  });
}

test('quick add needs one click; ordinary selection creates no undo or movement', async ({ page }) => {
  await launchDocument(page, fixture('diagrams/01-basic-flowchart.md'));
  await openDiagram(page);
  const node = page.locator('.mermaid-canvas-node').first();
  const before = await node.getAttribute('style');
  await node.click();
  expect(await node.getAttribute('style')).toBe(before);
  await expect(page.locator('.mermaid-workbench').getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  const count = await page.locator('.mermaid-canvas-node').count();
  const arrow = node.locator('.canvas-node-quick-add button').first();
  await arrow.click();
  await expect(page.locator('.mermaid-canvas-node')).toHaveCount(count + 1);
});
