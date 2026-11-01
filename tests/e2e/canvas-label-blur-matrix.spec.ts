import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { draftSource, launchDocument, openDiagram, savedSource, showCanvas } from './helpers';

type Template = { template: string; source: string; nodeId: string; edgeId: string | null; nodes: number; edges: number };
const templates: Template[] = JSON.parse(readFileSync(new URL('../fixtures/label-history-templates.json', import.meta.url), 'utf8')).templates;

for (const item of templates) for (const kind of item.edgeId ? ['node', 'edge'] : ['node']) {
  test(`${item.template} ${kind}: blur commits once and the clicked destination responds`, async ({ page }) => {
    const original = kind === 'node' ? 'Synthetic_NodeBase' : 'Synthetic_EdgeBase';
    const document = `# SYNTHETIC label blur\n\nFabricated acceptance data only.\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n\nSYNTHETIC_END\n`;
    await launchDocument(page, document, 'synthetic-label-blur.md');
    await openDiagram(page);
    await page.locator('.canvas-fit-button').click();
    const target = kind === 'node'
      ? page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`)
      : page.locator(`.canvas-edge-label[data-mermaid-edge-id="${item.edgeId}"]`);
    const input = target.locator('input');
    const otherNode = page.locator(`.mermaid-canvas-node:not([data-mermaid-node-id="${item.nodeId}"])`).first();
    const undo = page.locator('.history-tools button').first();
    const redo = page.locator('.history-tools button').nth(1);
    let finalSource = item.source;

    for (const destination of ['node', 'pan', 'source', 'close'] as const) {
      await test.step(destination, async () => {
        await expect(undo).toBeDisabled();
        await target.dblclick();
        await expect(input).toHaveValue(original);
        await expect(input).toBeFocused();
        const text = `Synthetic_Blur_${destination}_abc`;
        finalSource = item.source.replace(original, text);
        await input.fill(`Synthetic_Blur_${destination}_`);
        await input.pressSequentially('abc');
        await expect(input).toHaveValue(text);

        if (destination === 'node') {
          await otherNode.click();
          await expect(otherNode).toHaveAttribute('aria-pressed', 'true');
          await expect(otherNode).toBeFocused();
        } else if (destination === 'pan') {
          const pan = page.getByTitle('平移工具（H），或按住空格拖动', { exact: true });
          await pan.click();
          await expect(pan).toHaveAttribute('aria-pressed', 'true');
        } else if (destination === 'source') {
          await page.locator('.workbench-tabs').getByRole('button', { name: '源码', exact: true }).click();
          await expect(page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true })).toHaveValue(finalSource);
        } else {
          await page.getByRole('button', { name: '关闭图表工作台', exact: true }).click();
          await expect(page.getByRole('heading', { name: '放弃图表草稿？', exact: true })).toBeVisible();
          await page.getByRole('button', { name: '继续编辑', exact: true }).click();
          await expect(page.locator('.mermaid-workbench')).toBeVisible();
        }
        await expect(input).toHaveCount(0);
        expect(await draftSource(page)).toBe(finalSource);
        await expect(page.locator('.workbench-preview .mermaid-svg')).toContainText(text);
        await expect(page.locator('.workbench-preview .mermaid-error')).toHaveCount(0);
        await showCanvas(page);
        await page.getByTitle('选择工具（V）', { exact: true }).click();
        await expect(page.locator('.mermaid-canvas-node')).toHaveCount(item.nodes);
        await expect(page.locator('.canvas-edge')).toHaveCount(item.edges);
        await undo.click();
        await expect(undo).toBeDisabled();
        await expect(redo).toBeEnabled();
        expect(await draftSource(page)).toBe(item.source);
        await showCanvas(page);
        await redo.click();
        await expect(redo).toBeDisabled();
        expect(await draftSource(page)).toBe(finalSource);
        await showCanvas(page);
        if (destination !== 'close') await undo.click();
      });
    }
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.preview-pane .mermaid-error')).toHaveCount(0);
    expect(await savedSource(page)).toBe(document.replace(item.source, finalSource));
  });
}
