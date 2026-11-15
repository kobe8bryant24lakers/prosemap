import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fixture, launchDocument, openDiagram } from './helpers';

type Diagram = { category: string; template: string; path: string; kind: string };
const manifest = JSON.parse(readFileSync(new URL('../fixtures/manifest.json', import.meta.url), 'utf8'));
const diagrams: Diagram[] = manifest.files.filter((item: Diagram) => item.category === 'editable-diagram');
const canvas = (page: Page) => page.getByRole('region', { name: 'Mermaid 可视化画布编辑器', exact: true });
const selectedNodes = (page: Page) => page.locator('.mermaid-canvas-node[aria-pressed="true"]');
const undo = (page: Page) => page.locator('.history-tools button').nth(0);
type KeyWindow = Window & { __syntheticSelectAllKey?: KeyboardEvent };

for (const diagram of diagrams) {
  test(`${diagram.template}: canvas select-all stays within supported node selection`, async ({ page }) => {
    await launchDocument(page, fixture(diagram.path));
    await openDiagram(page);
    const nodes = page.locator('.mermaid-canvas-node');
    const count = await nodes.count();
    expect(count).toBeGreaterThan(1);
    await page.evaluate(() => {
      window.addEventListener('keydown', event => {
        if (event.key.toLowerCase() === 'a') (window as KeyWindow).__syntheticSelectAllKey = event;
      }, true);
    });
    for (const modifier of ['Meta', 'Control']) {
      await nodes.first().evaluate(element => (element as HTMLElement).click());
      await expect(selectedNodes(page)).toHaveCount(1);
      await canvas(page).focus();
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      await page.keyboard.press(`${modifier}+a`);
      await expect(canvas(page)).toBeFocused();
      await expect(selectedNodes(page)).toHaveCount(['flowchart', 'class', 'er'].includes(diagram.kind) ? count : 1);
      expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
      expect(await page.evaluate(() => {
        const event = (window as KeyWindow).__syntheticSelectAllKey!;
        return { trusted: event.isTrusted, prevented: event.defaultPrevented };
      })).toEqual({ trusted: true, prevented: true });
      await expect(undo(page)).toBeDisabled();
    }
  });
}

const source = 'classDiagram\n  class SyntheticA {\n    +String syntheticField\n  }\n  class SyntheticB\n  SyntheticA --> SyntheticB : syntheticRelation';
const document = `# SYNTHETIC select-all isolation\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`;
for (const context of ['node', 'edge', 'property', 'source']) {
  test(`select-all preserves ${context} input editing scope`, async ({ page }) => {
    await launchDocument(page, document, 'synthetic-select-all.md');
    await openDiagram(page);
    const node = page.locator('.mermaid-canvas-node[data-mermaid-node-id="SyntheticA"]');
    let input: Locator;
    if (context === 'node') {
      await node.dblclick();
      input = node.locator('input');
    } else if (context === 'edge') {
      const edge = page.locator('.canvas-edge-label[data-mermaid-edge-id="edge-1"]');
      await edge.dblclick();
      input = edge.locator('input');
    } else if (context === 'property') {
      await node.click();
      input = page.getByRole('textbox', { name: '类成员 1', exact: true });
    } else {
      await page.locator('.workbench-tabs').getByRole('button', { name: '源码', exact: true }).click();
      input = page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true });
    }
    await input.focus();
    const value = await input.inputValue();
    const selection = await selectedNodes(page).evaluateAll(elements => elements.map(element => element.getAttribute('data-mermaid-node-id')));
    for (const modifier of ['Meta', 'Control']) {
      await input.press('ArrowRight');
      await input.press(`${modifier}+a`);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(value);
      expect(await selectedNodes(page).evaluateAll(elements => elements.map(element => element.getAttribute('data-mermaid-node-id')))).toEqual(selection);
      if (context !== 'source') await expect(undo(page)).toBeDisabled();
    }
  });
}
