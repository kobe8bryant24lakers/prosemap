import { expect, test } from '@playwright/test';
import fixtures from '../fixtures/canvas-navigation-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram } from './helpers';

for (const item of fixtures.templates) {
  test(`${item.template}: Control selection consumes the native context menu without suppressing text menus`, async ({ page }) => {
    await launchDocument(page, `# SYNTHETIC Control click\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    const root = page.locator('.mermaid-canvas-editor');
    const node = root.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`);
    await node.click();
    const selectedBefore = await root.locator('.mermaid-canvas-node[aria-pressed="true"]').count();
    // WKWebView on macOS emits a contextmenu after Control-left-click. Observe
    // cancellation at that native event boundary; an OS menu is outside the DOM.
    for (const ctrlKey of [false, true]) {
      const prevented = await node.evaluate((node, ctrlKey) => {
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ctrlKey, button: 2 });
        node.dispatchEvent(event);
        return event.defaultPrevented;
      }, ctrlKey);
      expect(prevented).toBe(ctrlKey && item.multi);
      expect(await root.locator('.mermaid-canvas-node[aria-pressed="true"]').count()).toBe(selectedBefore);
    }
    await root.focus(); await page.keyboard.press('Enter');
    const input = root.locator('.mermaid-canvas-node input, .mermaid-canvas-node textarea').first();
    await expect(input).toBeVisible();
    const textMenuPrevented = await input.evaluate(input => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ctrlKey: true, button: 2 });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(textMenuPrevented).toBe(false);
    await page.keyboard.press('Escape');
    expect(await draftSource(page)).toBe(item.source);
  });
}
