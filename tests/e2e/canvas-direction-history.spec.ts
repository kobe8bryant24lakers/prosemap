import { expect, test, type Page } from '@playwright/test';
import { parseMermaidVisualSource } from '../../lib/mermaid-workbench';
import fixtures from '../fixtures/canvas-navigation-templates.json' with { type: 'json' };
import { editorSource, draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

const directions = [
  { value: 'TD', label: '向下', prior: '向右' },
  { value: 'LR', label: '向右', prior: '向下' },
  { value: 'BT', label: '向上', prior: '向右' },
  { value: 'RL', label: '向左', prior: '向下' },
];

async function geometry(page: Page) {
  return page.locator('.mermaid-canvas-editor').evaluate(root =>
    Array.from(root.querySelectorAll<HTMLElement>('.mermaid-canvas-node')).map(node => ({
      id: node.dataset.mermaidNodeId,
      x: Number.parseFloat(node.style.left), y: Number.parseFloat(node.style.top),
      width: Number.parseFloat(node.style.width), height: Number.parseFloat(node.style.height),
    })));
}

for (const item of fixtures.templates.filter(item => ['flowchart', 'state'].includes(item.kind))) {
  for (const direction of directions) {
    test(`${item.template}: ${direction.value} rearranges and fits without reversing edges; one undo restores manual layout`, async ({ page }) => {
      await launchDocument(page, `# SYNTHETIC direction history\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
      const document = await editorSource(page);
      await openDiagram(page);
      const tools = page.locator('.canvas-direction-tools');
      await tools.getByRole('button', { name: direction.prior, exact: true }).click();
      const beforeSource = await draftSource(page);
      const beforeGraph = parseMermaidVisualSource(beforeSource)!;
      await showCanvas(page);
      const target = page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`);
      await target.click();
      const automatic = await geometry(page);
      for (let n = 0; n < 8; n++) await target.press('Shift+ArrowRight');
      const manual = await geometry(page);
      expect(manual.find(node => node.id === item.nodeId)!.x).toBe(automatic.find(node => node.id === item.nodeId)!.x + 80);
      await tools.getByRole('button', { name: direction.label, exact: true }).click();
      await expect(tools.getByRole('button', { name: direction.label, exact: true })).toHaveClass(/active/);
      await expect.poll(() => geometry(page)).not.toEqual(manual);
      const arranged = await geometry(page);
      const visibility = await page.locator('.mermaid-canvas-editor').evaluate(root => {
        const viewport = root.querySelector('.canvas-editor-viewport')!.getBoundingClientRect();
        return Array.from(root.querySelectorAll('.mermaid-canvas-node, .canvas-group-boundary')).every(element => {
          const rect = element.getBoundingClientRect();
          return rect.left >= viewport.left - 1 && rect.right <= viewport.right + 1
            && rect.top >= viewport.top - 1 && rect.bottom <= viewport.bottom + 1;
        });
      });
      expect(visibility).toBe(true);
      const changedSource = await draftSource(page);
      const changedGraph = parseMermaidVisualSource(changedSource)!;
      expect(changedGraph).toEqual({ ...beforeGraph, direction: direction.value });
      await showCanvas(page);
      await page.locator('.history-tools button').first().click();
      await expect.poll(() => geometry(page)).toEqual(manual);
      expect(await draftSource(page)).toBe(beforeSource);
      await showCanvas(page);
      await page.locator('.history-tools button').nth(1).click();
      await expect.poll(() => geometry(page)).toEqual(arranged);
      expect(await draftSource(page)).toBe(changedSource);
      expect(await editorSource(page)).toBe(document);
    });
  }
}
