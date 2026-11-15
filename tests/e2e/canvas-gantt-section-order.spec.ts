import { expect, test } from '@playwright/test';
import { draftSource, launchDocument, mod, openDiagram, savedSource, showCanvas } from './helpers';

const source = `gantt
  title SYNTHETIC grouped tasks
  dateFormat YYYY-MM-DD
  section Synthetic Alpha
  Alpha one :done, a1, 2026-01-01, 1d
  Alpha two :a2, after a1, 1d
  section Synthetic Beta
  Beta one :b1, 2026-01-01, 2d
  Beta two :b2, after b1, 1d`;

for (const entry of ['button', 'keyboard']) {
  test(`Gantt ${entry} duplicate stays inside its section in the real Mermaid preview`, async ({ page }) => {
    const document = `# SYNTHETIC Gantt section order\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`;
    await launchDocument(page, document);
    await openDiagram(page);
    await page.locator('.canvas-fit-button').click();
    await page.locator('.mermaid-canvas-node[data-mermaid-node-id="a1"]').click();
    if (entry === 'button') await page.getByRole('button', { name: '复制', exact: true }).click();
    else await page.keyboard.press(`${mod}+d`);
    await expect(page.locator('.mermaid-canvas-node')).toHaveCount(5);
    const changed = await draftSource(page);
    const preview = page.locator('.workbench-preview .mermaid-svg svg');
    const copy = preview.locator('rect[id$="-Task5"]');
    await expect(copy).toBeVisible();
    const row = async (id: string) => preview.locator(`rect[id$="-${id}"]`).evaluate(element => ({
      x: Number(element.getAttribute('x')), y: Number(element.getAttribute('y')), width: Number(element.getAttribute('width')),
    }));
    const [first, second, duplicate, beta] = await Promise.all(['a1', 'a2', 'Task5', 'b1'].map(row));
    expect(duplicate.y).toBeGreaterThan(second.y);
    expect(duplicate.y).toBeLessThan(beta.y);
    expect(duplicate.x).toBe(first.x);
    expect(duplicate.width).toBe(first.width);
    expect(changed.match(/section Synthetic Alpha/g)).toHaveLength(1);
    expect(changed).toContain('section Synthetic Alpha\n  Alpha one :done, a1, 2026-01-01, 1d\n  Alpha two :a2, after a1, 1d\n  Alpha one 副本 :done, Task5, 2026-01-01, 1d\n  section Synthetic Beta');
    await showCanvas(page);
    await page.locator('.history-tools button').first().click();
    expect(await draftSource(page)).toBe(source);
    await showCanvas(page);
    await page.locator('.history-tools button').nth(1).click();
    expect(await draftSource(page)).toBe(changed);
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    expect(await savedSource(page)).toBe(document.replace(source, changed));
  });
}
