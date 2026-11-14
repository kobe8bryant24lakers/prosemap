import { expect, test } from '@playwright/test';
import { draftSource, launchDocument, openDiagram } from './helpers';

const source = 'flowchart TD\n  A["SYNTHETIC_A"]\n  B["SYNTHETIC_B"]\n  C["SYNTHETIC_C"]\n  A --> B\n  B --> C';

for (const height of [868, 900]) {
  for (const expanded of [false, true]) {
    test(`zoom at 200% preserves scroll and object geometry: height ${height}, expanded ${expanded}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height });
      await launchDocument(page, `# SYNTHETIC zoom limit\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`);
      await openDiagram(page);
      if (expanded) await page.getByRole('button', { name: '全屏编辑', exact: true }).click();
      const root = page.locator('.mermaid-canvas-editor');
      const node = root.locator('.mermaid-canvas-node[data-mermaid-node-id="B"]');
      await node.click();
      await root.getByRole('button', { name: '选区', exact: true }).click();
      const plus = root.getByRole('button', { name: '放大画布', exact: true });
      const zoom = root.locator('.canvas-zoom-value');
      for (let i = 0; i < 20 && await zoom.innerText() !== '200%'; i++) await plus.click();
      await expect(zoom).toHaveText('200%');
      const geometry = () => root.evaluate(element => {
        const viewport = element.querySelector<HTMLElement>('.canvas-editor-viewport')!;
        const stage = element.querySelector<HTMLElement>('.canvas-editor-stage')!;
        const node = element.querySelector<HTMLElement>('.mermaid-canvas-node[data-mermaid-node-id="B"]')!;
        const rect = node.getBoundingClientRect();
        return {
          scroll: [viewport.scrollLeft, viewport.scrollTop],
          node: [rect.x, rect.y, rect.width, rect.height],
          zoom: new DOMMatrix(getComputedStyle(stage).transform).a,
        };
      });
      const before = await geometry();
      for (let i = 0; i < 5; i++) {
        await plus.click();
        expect(await geometry()).toEqual(before);
        await expect(node).toHaveClass(/\bselected\b/);
      }
      await expect(root.locator('.history-tools button').first()).toBeDisabled();
      expect(await draftSource(page)).toBe(source);
    });
  }
}
