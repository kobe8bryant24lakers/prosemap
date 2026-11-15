import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

const templates: Array<{ template: string; source: string }> = JSON.parse(
  readFileSync(new URL('../fixtures/label-history-templates.json', import.meta.url), 'utf8'),
).templates;
const paths = ['x', 'cancel', 'backdrop', 'escape'] as const;

async function close(page: Page, path: typeof paths[number]) {
  if (path === 'x') await page.getByRole('button', { name: '关闭图表工作台', exact: true }).click();
  if (path === 'cancel') await page.locator('.mermaid-workbench').getByRole('button', { name: '取消', exact: true }).click();
  if (path === 'backdrop') await page.locator('.mermaid-workbench-backdrop').click({ position: { x: 20, y: 400 } });
  if (path === 'escape') {
    await page.locator('.workbench-tabs').getByRole('button', { name: '画布', exact: true }).focus();
    await page.keyboard.press('Escape');
  }
}

for (const item of templates) {
  test(`${item.template}: clean and dirty close paths preserve the document and safe default focus`, async ({ page }) => {
    const document = `# SYNTHETIC close paths\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`;
    await launchDocument(page, document);
    const editor = page.locator('.cm-content');
    const initial = await editor.innerText();
    const changed = item.source.replace('Synthetic_NodeBase', 'SYNTHETIC Modified');
    for (const path of paths) {
      await openDiagram(page);
      await close(page, path);
      await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
      await expect(page.locator('.confirmation-dialog')).toHaveCount(0);
      expect(await editor.innerText()).toBe(initial);

      await openDiagram(page);
      await draftSource(page);
      await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(changed);
      await showCanvas(page);
      await close(page, path);
      const keep = page.getByRole('button', { name: '继续编辑', exact: true });
      await expect(keep).toBeFocused();
      // The safe default must work by Enter without first clicking the dialog.
      await page.keyboard.press('Enter');
      await expect(page.locator('.confirmation-dialog')).toHaveCount(0);
      expect(await draftSource(page)).toBe(changed);
      await showCanvas(page);
      await close(page, path);
      await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
      await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
      expect(await editor.innerText()).toBe(initial);
    }
    expect(await page.evaluate(() => (window as any).__acceptance.saved.length)).toBe(0);
  });
}

test('cancelling a dirty confirmation from its backdrop restores workbench focus', async ({ page }) => {
  const source = templates[0].source;
  await launchDocument(page, `# SYNTHETIC nested backdrop\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`);
  await openDiagram(page);
  await draftSource(page);
  const changed = source.replace('Synthetic_NodeBase', 'SYNTHETIC Modified');
  await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(changed);
  await showCanvas(page);
  await close(page, 'x');
  await expect(page.getByRole('button', { name: '继续编辑', exact: true })).toBeFocused();
  await page.locator('.confirmation-backdrop').click({ position: { x: 20, y: 400 } });
  await expect(page.locator('.confirmation-dialog')).toHaveCount(0);
  await expect.poll(() => page.locator('.mermaid-workbench').evaluate(element => element.contains(document.activeElement))).toBe(true);
  expect(await draftSource(page)).toBe(changed);
});
