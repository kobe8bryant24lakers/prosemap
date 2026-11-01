import { expect, test } from '@playwright/test';
import { launchDocument, openDiagram, savedSource } from './helpers';

const source = 'flowchart LR\n  A["Synthetic node"]\n  B["Synthetic destination"]\n  A -->|Synthetic edge| B';
const document = `# SYNTHETIC confirmation focus\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`;

for (const kind of ['node', 'edge'] as const) {
  test(`${kind}: confirmation returns to the workbench when its inline opener unmounts`, async ({ page }) => {
    await launchDocument(page, document, 'synthetic-confirmation-focus.md');
    await openDiagram(page);
    await page.locator('.canvas-fit-button').click();
    const target = kind === 'node' ? page.locator('.mermaid-canvas-node[data-mermaid-node-id="A"]') : page.locator('.canvas-edge-label').first();
    await target.dblclick();
    const input = target.locator('input');
    await input.fill('Synthetic edited label');
    await expect(input).toBeFocused();
    // Native macOS activation need not focus the clicked button. Keep the
    // inline input as the opener so making the workbench inert unmounts it.
    await page.getByRole('button', { name: '关闭图表工作台', exact: true }).dispatchEvent('click');
    await expect(page.getByRole('heading', { name: '放弃图表草稿？', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    const workbench = page.locator('.mermaid-workbench');
    await expect.poll(() => workbench.evaluate(element => element.contains(element.ownerDocument.activeElement))).toBe(true);
    await page.keyboard.press('d');
    await expect(page.locator('.cm-content')).toHaveText(document, { useInnerText: true });
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(workbench).toHaveCount(0);
    expect(await savedSource(page)).toBe(document.replace(kind === 'node' ? 'Synthetic node' : 'Synthetic edge', 'Synthetic edited label'));
  });
}
