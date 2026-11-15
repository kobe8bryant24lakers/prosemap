import { expect, test, type Locator } from '@playwright/test';
import { draftSource, launchDocument, openDiagram } from './helpers';

// Synthetic click/focus coverage. Browser input does not replace native evidence.
const cases = [
  { kind: 'flowchart', source: 'flowchart TD\n  A["SyntheticAlpha"] -->|R1_synthetic| B["SyntheticBeta"]' },
  { kind: 'sequence', source: 'sequenceDiagram\n  participant A as SyntheticAlpha\n  participant B as SyntheticBeta\n  A->>B: R1_synthetic' },
  { kind: 'state', source: 'stateDiagram-v2\n  state "SyntheticAlpha" as A\n  state "SyntheticBeta" as B\n  A --> B: R1_synthetic' },
  { kind: 'class', source: 'classDiagram\n  class SyntheticAlpha {\n    +String syntheticId\n  }\n  class SyntheticBeta\n  SyntheticAlpha --> SyntheticBeta : R1_synthetic' },
  { kind: 'ER', source: 'erDiagram\n  userRecord ||--o{ ORDER : R1_synthetic\n  userRecord {\n    string id PK\n  }\n  ORDER {\n    string id PK\n  }' },
];

async function center(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('Missing visible label');
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

for (const width of [1440, 900]) for (const item of cases) {
  for (const mode of ['immediate double click', 'lower double click', 'lower single then double click', 'upper double click', 'upper single then double click']) {
    test(`${item.kind} at ${width}px: ${mode} keeps the label editable without source changes`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 650 });
      await launchDocument(page, `# Synthetic edge focus\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`, 'synthetic-edge-focus.md');
      await openDiagram(page);
      await page.locator('.canvas-fit-button').click();
      const label = page.locator('.canvas-edge-label[data-mermaid-edge-id="edge-1"]');
      if (mode !== 'immediate double click') {
        const viewport = await page.locator('.canvas-editor-viewport').boundingBox();
        if (!viewport) throw new Error('Missing canvas viewport');
        const before = await center(label);
        const targetY = mode.startsWith('upper') ? viewport.y + 24 : viewport.y + viewport.height - 75;
        await page.mouse.move(viewport.x + viewport.width - 40, viewport.y + viewport.height - 25);
        await page.mouse.wheel(0, before.y - targetY);
        await expect.poll(async () => Math.abs((await center(label)).y - targetY)).toBeLessThan(3);
        if (mode.endsWith('single then double click')) {
          const anchor = await center(label);
          await label.click();
          await expect(label).toHaveClass(/selected/);
          await expect.poll(async () => {
            const after = await center(label);
            return Math.hypot(after.x - anchor.x, after.y - anchor.y);
          }).toBeLessThan(3);
          const afterViewport = await page.locator('.canvas-editor-viewport').boundingBox();
          expect(afterViewport).toEqual(viewport);
          await expect(label).toBeInViewport({ ratio: 0.999 });
        }
      }
      await label.dblclick();
      const input = label.locator('input');
      await expect(input).toBeFocused({ timeout: 2000 });
      await expect(input).toHaveValue('R1_synthetic');
      await input.press('Escape');
      expect(await draftSource(page)).toBe(item.source);
    });
  }
}
