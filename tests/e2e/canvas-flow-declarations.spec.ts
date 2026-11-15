import { expect, test } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, savedSource, showCanvas } from './helpers';

const source = 'flowchart LR\n  Rect["Rect"]\n  Round("Round")\n  Start(["Start"])\n  Choice{"Choice"}\n  Circle(("Circle"))\n  Store[("Store")]\n  Rect -->|Synthetic_EdgeBase| Round\n  Round --> Start\n  Start --> Choice\n  Choice --> Circle\n  Circle --> Store';
const shapes = { Rect: 'rectangle', Round: 'rounded', Start: 'terminal', Choice: 'decision', Circle: 'circle', Store: 'database' };

for (const kind of ['node', 'edge']) test(`bare references preserve all declared shapes while editing and saving a ${kind} label`, async ({ page }) => {
  const document = `# SYNTHETIC shape declarations\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`;
  await launchDocument(page, document, 'synthetic-shape-declarations.md');
  await expect(page.locator('.preview-pane .mermaid-svg svg')).toHaveCount(1);
  await openDiagram(page);
  await page.locator('.canvas-fit-button').click();
  for (const [id, shape] of Object.entries(shapes)) {
    await expect.soft(page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"]`)).toHaveClass(new RegExp(`\\bshape-${shape}\\b`), { timeout: 1000 });
  }
  const label = page.locator(kind === 'node'
    ? '.mermaid-canvas-node[data-mermaid-node-id="Round"]'
    : '.canvas-edge-label[data-mermaid-edge-id="edge-1"]');
  const changed = kind === 'node' ? source.replace('Round("Round")', 'Round("Synthetic_Changed")')
    : source.replace('Synthetic_EdgeBase', 'Synthetic_Changed');
  await label.dblclick();
  await label.locator('input').fill('Synthetic_Changed');
  await label.locator('input').press('Enter');
  expect(await draftSource(page)).toBe(changed);
  await showCanvas(page);
  await page.locator('.history-tools button').first().click();
  expect(await draftSource(page)).toBe(source);
  await showCanvas(page);
  await page.locator('.history-tools button').nth(1).click();
  await page.getByRole('button', { name: '应用到文档', exact: true }).click();
  expect(await savedSource(page)).toBe(document.replace(source, changed));
});
