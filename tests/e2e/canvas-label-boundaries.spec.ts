import { expect, test, type Locator } from '@playwright/test';
import fixtures from '../fixtures/label-history-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram, savedSource, showCanvas } from './helpers';

const longLabel = 'SYNTHETIC 超长中文标签 Navigation and persistence 🧭 合法保存 "quoted"';
const storedLabel = longLabel.replaceAll('"', "'");

// This dispatch tests the browser paste-handler boundary. Native acceptance
// separately pastes through the OS clipboard into the installed application.
async function pasteLines(input: Locator, text: string) {
  return input.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, text);
}

for (const item of fixtures.templates) {
  test(`${item.template}: multiline paste is rejected before normalization, long labels save and invalid drafts preserve source`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const original = `# SYNTHETIC label boundaries\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`;
    await launchDocument(page, original);
    await openDiagram(page);
    const node = page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`);
    await node.dblclick();
    const input = node.locator('input');
    await expect(input).toBeFocused();
    expect(await pasteLines(input, 'SYNTHETIC first\r\nSYNTHETIC second')).toBe(true);
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.workbench-footer .error')).toContainText('换行');
    await expect(input).toHaveValue('Synthetic_NodeBase');
    await input.press('Enter');
    await expect(input).toBeVisible();
    await input.press('Escape');
    expect(await draftSource(page)).toBe(item.source);
    await showCanvas(page);
    await expect(page.locator('.history-tools button').first()).toBeDisabled();
    await node.dblclick();
    await input.fill(longLabel);
    await expect(input).toHaveAttribute('aria-invalid', 'false');
    await input.press('Enter');
    expect(await draftSource(page)).toBe(item.source.replace('Synthetic_NodeBase', storedLabel));
    await expect(page.locator('.workbench-preview .mermaid-svg svg')).toHaveCount(1);
    await showCanvas(page);
    await node.dblclick();
    await input.fill('SYNTHETIC invalid#;');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.workbench-footer .error')).toContainText('不能包含');
    await input.press('Escape');
    expect(await draftSource(page)).toBe(item.source.replace('Synthetic_NodeBase', storedLabel));
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    expect(await savedSource(page)).toBe(original.replace('Synthetic_NodeBase', storedLabel));
    await expect(page.locator('.preview-pane .mermaid-svg svg')).toHaveCount(1);
  });

  if (!['mindmap', 'gantt'].includes(item.kind)) {
    test(`${item.template}: multiline edge paste preserves label and history`, async ({ page }) => {
      await launchDocument(page, `# SYNTHETIC edge paste\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
      await openDiagram(page);
      const label = page.locator(`.canvas-edge-label[data-mermaid-edge-id="${item.edgeId}"]`);
      await label.dblclick();
      const input = label.locator('input');
      await expect(input).toBeFocused();
      expect(await pasteLines(input, 'SYNTHETIC first\nSYNTHETIC second')).toBe(true);
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('.workbench-footer .error')).toContainText('换行');
      await input.press('Escape');
      expect(await draftSource(page)).toBe(item.source);
      await showCanvas(page);
      await expect(page.locator('.history-tools button').first()).toBeDisabled();
    });
  }
}
