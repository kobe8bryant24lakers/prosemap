import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { draftSource, launchDocument, openDiagram, savedSource, showCanvas } from './helpers';

const templates: Array<{ template: string; source: string; nodeId: string }> = JSON.parse(
  readFileSync(new URL('../fixtures/label-history-templates.json', import.meta.url), 'utf8'),
).templates;

for (const item of templates) {
  test(`${item.template}: switching tabs retains draft, viewport, selection and history; reset restores the opening source`, async ({ page }) => {
    const document = `# SYNTHETIC source session\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`;
    await launchDocument(page, document);
    await openDiagram(page);
    await page.locator('.canvas-fit-button').click();
    await page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`).click();
    await page.getByRole('button', { name: '复制', exact: true }).click();
    await page.getByRole('button', { name: '放大画布', exact: true }).click();
    const source = await draftSource(page);
    await showCanvas(page);
    const snapshot = () => page.locator('.mermaid-canvas-editor').evaluate(element => ({
      nodes: Array.from(element.querySelectorAll<HTMLElement>('.mermaid-canvas-node')).map(node => [node.dataset.mermaidNodeId, node.style.cssText, node.getAttribute('aria-pressed')]),
      zoom: element.querySelector('.canvas-zoom-value')?.textContent,
      scroll: [element.querySelector('.canvas-editor-viewport')?.scrollLeft, element.querySelector('.canvas-editor-viewport')?.scrollTop],
      undo: (element.querySelector('.history-tools button') as HTMLButtonElement)?.disabled,
      redo: (element.querySelectorAll('.history-tools button')[1] as HTMLButtonElement)?.disabled,
    }));
    const before = await snapshot();
    for (const name of ['AI 辅助', '模板', '源码']) {
      await page.locator('.workbench-tabs').getByRole('button', { name, exact: true }).click();
      await expect(page.locator('.workbench-preview .mermaid-svg svg')).toBeVisible();
      await showCanvas(page);
      expect(await snapshot()).toEqual(before);
    }
    expect(await draftSource(page)).toBe(source);
    await showCanvas(page);
    await page.locator('.history-tools button').first().click();
    expect(await draftSource(page)).toBe(item.source);
    await showCanvas(page);
    await page.locator('.history-tools button').nth(1).click();
    expect(await draftSource(page)).toBe(source);
    await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(source.replaceAll('Synthetic_NodeBase', 'SYNTHETIC Renamed'));
    await expect(page.locator('.workbench-preview .mermaid-svg svg')).toContainText('SYNTHETIC Renamed');
    await page.getByRole('button', { name: '恢复打开时内容', exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).inputValue()).toBe(item.source);
    await showCanvas(page);
    await expect(page.locator('.history-tools button').first()).toBeDisabled();
    await expect(page.locator('.history-tools button').nth(1)).toBeDisabled();
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    expect(await savedSource(page)).toBe(document);
  });
}
