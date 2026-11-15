import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { draftSource, launchDocument, mod, openDiagram, savedSource, showCanvas } from './helpers';

type Template = { template: string; source: string; nodeId: string; edgeId: string | null; nodes: number; edges: number };
const templates: Template[] = JSON.parse(readFileSync(new URL('../fixtures/label-history-templates.json', import.meta.url), 'utf8')).templates;
const originalLabel = '中文 alpha 尾';

for (const item of templates) for (const kind of item.edgeId ? ['node', 'edge'] : ['node']) {
  test(`${item.template} ${kind}: text selection and caret clicks stay inside the inline input`, async ({ page }) => {
    const source = item.source.replace(kind === 'node' ? 'Synthetic_NodeBase' : 'Synthetic_EdgeBase', originalLabel);
    const document = `# SYNTHETIC text selection\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`;
    await launchDocument(page, document, 'synthetic-text-selection.md');
    await openDiagram(page);
    await page.locator('.canvas-fit-button').click();
    const target = page.locator(kind === 'node'
      ? `.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`
      : `.canvas-edge-label[data-mermaid-edge-id="${item.edgeId}"]`);
    const layout = () => page.locator('.mermaid-canvas-node').evaluateAll(nodes => nodes.map(node => [
      (node as HTMLElement).dataset.mermaidNodeId, (node as HTMLElement).style.cssText,
    ]));
    const beforeLayout = await layout();
    await target.dblclick();
    const input = target.locator('input');
    await expect(input).toHaveValue(originalLabel);
    const selection = () => input.evaluate(element => {
      const field = element as HTMLInputElement;
      return { start: field.selectionStart, end: field.selectionEnd, text: field.value.slice(field.selectionStart!, field.selectionEnd!) };
    });
    const point = async (index: number) => input.evaluate((element, index) => {
      const field = element as HTMLInputElement, bounds = field.getBoundingClientRect(), style = getComputedStyle(field);
      const canvas = element.ownerDocument.createElement('canvas'), context = canvas.getContext('2d')!;
      context.font = style.font;
      const scale = bounds.width / field.offsetWidth;
      const width = context.measureText(field.value).width;
      return { x: bounds.x + bounds.width / 2 - width * scale / 2 + context.measureText(field.value.slice(0, index)).width * scale,
        y: bounds.y + bounds.height / 2 };
    }, index);

    // Click a character boundary and prove a collapsed caret, not whole-label replacement.
    const caret = await point(1);
    await page.mouse.click(caret.x, caret.y);
    expect(await selection()).toEqual({ start: 1, end: 1, text: '' });
    await input.press('x');
    await expect(input).toHaveValue('中x文 alpha 尾');
    await input.press(`${mod}+a`);
    await input.fill(originalLabel);

    // A double-click inside the English word must select that word without restarting editing.
    const word = await point(5);
    await page.mouse.dblclick(word.x, word.y);
    expect((await selection()).text).toBe('alpha');
    await input.press('b');
    await expect(input).toHaveValue('中文 b 尾');
    await input.fill(originalLabel);

    // Actual held-pointer browser drag selects the two Chinese characters.
    const start = await point(0), end = await point(2);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    expect((await selection()).text).toBe('中文');
    await input.press('c');
    await expect(input).toHaveValue('c alpha 尾');
    await input.press(`${mod}+a`);
    await input.fill('SYNTHETIC 全选替换');
    await input.press('Enter');
    await expect(input).toHaveCount(0);
    expect(await layout()).toEqual(beforeLayout);
    await expect(page.locator('.mermaid-canvas-node')).toHaveCount(item.nodes);
    await expect(page.locator('.canvas-edge')).toHaveCount(item.edges);
    const expected = source.replace(originalLabel, 'SYNTHETIC 全选替换');
    expect(await draftSource(page)).toBe(expected);
    await showCanvas(page);
    await page.locator('.history-tools button').first().click();
    await expect(page.locator('.history-tools button').first()).toBeDisabled();
    expect(await draftSource(page)).toBe(source);
    await showCanvas(page);
    await page.locator('.history-tools button').nth(1).click();
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    expect(await savedSource(page)).toBe(document.replace(source, expected));
  });
}
