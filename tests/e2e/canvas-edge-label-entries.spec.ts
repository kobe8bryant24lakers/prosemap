import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { draftSource, launchDocument, openDiagram, savedSource, showCanvas } from './helpers';

type EntryCase = {
  template: string; kind: string; state: string; edgeId: string;
  initialLabel: string; source: string;
  edits: { mode: string; label: string; source: string }[];
};
const cases: EntryCase[] = JSON.parse(readFileSync(new URL('../fixtures/edge-label-entries.json', import.meta.url), 'utf8')).cases;

async function selectEdge(page: Page, id: string) {
  const label = page.locator(`.canvas-edge-label[data-mermaid-edge-id="${id}"]`);
  if (await label.count()) await label.click();
  else {
    const path = page.locator(`.canvas-edge[data-mermaid-edge-id="${id}"] .canvas-edge-hit`);
    await path.scrollIntoViewIfNeeded();
    const point = await path.evaluate(element => {
      const path = element as SVGPathElement;
      const point = path.getPointAtLength(path.getTotalLength() / 2);
      const transformed = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
      return { x: transformed.x, y: transformed.y };
    });
    await page.mouse.click(point.x, point.y);
  }
  await expect(page.locator(`.canvas-edge[data-mermaid-edge-id="${id}"]`)).toHaveClass(/selected/);
  return label;
}

for (const item of cases) for (const edit of item.edits) {
  test(`${item.template} ${item.state}: ${edit.mode} edits the label, preview and saved document`, async ({ page }) => {
    const document = `# SYNTHETIC edge label entries\n\nFabricated acceptance data only.\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n\nSYNTHETIC_END\n`;
    await launchDocument(page, document, 'synthetic-label-entries.md');
    // Empty ER and sequence fixtures must render before testing any edits.
    await expect(page.locator('.preview-pane .mermaid-svg svg')).toHaveCount(1);
    await expect(page.locator('.preview-pane .mermaid-error')).toHaveCount(0);
    await openDiagram(page);
    await page.locator('.canvas-fit-button').click();
    const label = await selectEdge(page, item.edgeId);
    if (edit.mode === 'Button') {
      await page.locator('.canvas-context-bar').getByRole('button', {
        name: `${item.initialLabel ? '改' : '加'}${item.kind === 'sequence' ? '消息' : '说明'}`, exact: true,
      }).click();
    } else if (edit.mode === 'Double') await label.dblclick();
    else await page.keyboard.press('Enter');
    const input = label.locator('input');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(item.initialLabel);
    await input.fill(edit.label);
    await input.press('Enter');
    await expect(input).toHaveCount(0);
    await expect(label.locator('span')).toHaveText(edit.label);
    expect(await draftSource(page)).toBe(edit.source);
    await expect(page.locator('.workbench-preview .mermaid-svg svg')).toHaveCount(1);
    await expect(page.locator('.workbench-preview .mermaid-svg')).toContainText(edit.label);
    await expect(page.locator('.workbench-preview .mermaid-error')).toHaveCount(0);
    // One edit session must undo/redo exactly, including an initially empty label.
    await showCanvas(page);
    await page.locator('.history-tools button').first().click();
    expect(await draftSource(page)).toBe(item.source);
    await showCanvas(page);
    await page.locator('.history-tools button').nth(1).click();
    expect(await draftSource(page)).toBe(edit.source);
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.preview-pane .mermaid-svg')).toContainText(edit.label);
    await expect(page.locator('.preview-pane .mermaid-error')).toHaveCount(0);
    expect(await savedSource(page)).toBe(document.replace(item.source, edit.source));
  });
}
