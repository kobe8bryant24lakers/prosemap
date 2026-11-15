import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { draftSource, launchDocument, mod, openDiagram, savedSource, showCanvas } from './helpers';

type Template = { template: string; kind: string; source: string; nodeId: string; edgeId: string | null; nodes: number; edges: number };
const templates: Template[] = JSON.parse(readFileSync(new URL('../fixtures/label-history-templates.json', import.meta.url), 'utf8')).templates;
const committed = 'Synthetic_cnvhf0d';
const canceled = 'Synthetic_Cancelxyz';
const layout = (page: Page) => page.locator('.mermaid-canvas-node').evaluateAll(elements => elements.map(element => {
  const node = element as HTMLElement;
  return [node.dataset.mermaidNodeId, node.style.left, node.style.top, node.style.width, node.style.height];
}));

for (const item of templates) for (const kind of item.edgeId ? ['node', 'edge'] : ['node']) {
  test(`${item.template} ${kind}: Enter commits one edit and Escape restores the old redo`, async ({ page }) => {
    const original = kind === 'node' ? 'Synthetic_NodeBase' : 'Synthetic_EdgeBase';
    const changed = item.source.replace(original, committed);
    const document = `# SYNTHETIC label history\n\nFabricated acceptance data only.\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n\nSYNTHETIC_END\n`;
    await launchDocument(page, document, 'synthetic-label-history.md');
    await openDiagram(page);
    await page.locator('.canvas-fit-button').click();
    const target = kind === 'node'
      ? page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`)
      : page.locator(`.canvas-edge-label[data-mermaid-edge-id="${item.edgeId}"]`);
    const initialLayout = await layout(page);
    const zoom = await page.locator('.canvas-zoom-value').textContent();
    const undo = page.locator('.history-tools button').first();
    const redo = page.locator('.history-tools button').nth(1);
    const editor = page.locator('.mermaid-canvas-editor');
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    await target.dblclick();
    const input = target.locator('input');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(original);
    await input.fill('Synthetic_');
    // These are canvas shortcuts outside an input. Each key changes the label.
    await input.pressSequentially('cnvhf0d');
    await expect(input).toHaveValue(committed);
    await expect(page.locator('.canvas-zoom-value')).toHaveText(zoom!);
    await expect(page.locator('.mermaid-canvas-node')).toHaveCount(item.nodes);
    await expect(page.locator('.canvas-edge')).toHaveCount(item.edges);
    await expect(page.getByTitle('选择工具（V）', { exact: true })).toHaveAttribute('aria-pressed', 'true');
    await input.press('Enter');
    await expect(input).toHaveCount(0);
    await expect(editor).toBeFocused();
    expect(await draftSource(page)).toBe(changed);
    await expect(page.locator('.workbench-preview .mermaid-svg')).toContainText(committed);
    await showCanvas(page);
    await undo.click();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();
    expect(await draftSource(page)).toBe(item.source);
    await showCanvas(page);
    expect(await layout(page)).toEqual(initialLayout);

    await target.dblclick();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(original);
    await input.fill('Synthetic_Cancel');
    await input.pressSequentially('xyz');
    await expect(input).toHaveValue(canceled);
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(editor).toBeFocused();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();
    expect(await layout(page)).toEqual(initialLayout);
    expect(await draftSource(page)).toBe(item.source);
    await showCanvas(page);
    // Exercise the keyboard route after the button undo, with verified focus.
    await target.click();
    await expect(kind === 'node' ? target : editor).toBeFocused();
    await page.keyboard.press(`${mod}+Shift+z`);
    await expect(redo).toBeDisabled();
    await expect(undo).toBeEnabled();
    expect(await draftSource(page)).toBe(changed);
    await expect(page.locator('.workbench-preview .mermaid-svg')).toContainText(committed);
    await expect(page.locator('.workbench-preview .mermaid-svg')).not.toContainText(canceled);
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.preview-pane .mermaid-svg')).toContainText(committed);
    await expect(page.locator('.preview-pane .mermaid-error')).toHaveCount(0);
    expect(await savedSource(page)).toBe(document.replace(item.source, changed));
  });
}
