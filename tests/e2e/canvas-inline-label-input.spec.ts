import { expect, test } from '@playwright/test';
import { draftSource, launchDocument, mod, openDiagram } from './helpers';

// Browser regression with the shared IPC fixture, not macOS text services.
// Native automatic capitalization/replacement still requires installed-app retesting.
const source = 'erDiagram\n  userRecord ||--o{ ORDER : creates\n  userRecord {\n    string id PK\n  }\n  ORDER {\n    string id PK\n  }';

for (const kind of ['node', 'edge'] as const) {
  test(`inline ${kind} labels opt out of text correction and preserve typed case with one-step undo`, async ({ page }) => {
    await launchDocument(page, `# Synthetic exact labels\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`, 'synthetic-exact-labels.md');
    await openDiagram(page);
    await page.locator('.canvas-fit-button').click();
    const target = kind === 'node'
      ? page.locator('.mermaid-canvas-node[data-mermaid-node-id="userRecord"]')
      : page.locator('.canvas-edge-label[data-mermaid-edge-id="edge-1"]');
    const original = kind === 'node' ? 'userRecord' : 'creates';
    await target.dblclick();
    const input = target.locator('input');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(original);
    await expect.soft(input).toHaveAttribute('autocapitalize', 'none', { timeout: 1000 });
    await expect.soft(input).toHaveAttribute('autocorrect', 'off', { timeout: 1000 });
    await expect.soft(input).toHaveAttribute('spellcheck', 'false', { timeout: 1000 });

    await input.press(`${mod}+a`);
    await input.press('ArrowRight');
    await input.press('0');
    await expect(input).toHaveValue(`${original}0`);
    await input.press(`${mod}+z`);
    await expect(input).toHaveValue(original);
    await input.press(`${mod}+a`);
    await input.pressSequentially('cReAtEsSynthetic');
    await expect(input).toHaveValue('cReAtEsSynthetic');
    await input.press('Enter');
    await expect(target).toContainText('cReAtEsSynthetic');
    await page.locator('.history-tools button').first().click();
    await expect(target).toContainText(original);
    expect(await draftSource(page)).toBe(source);
  });
}
