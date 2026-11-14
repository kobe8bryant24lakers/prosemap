import { expect, test } from '@playwright/test';
import fixtures from '../fixtures/canvas-navigation-templates.json' with { type: 'json' };
import { launchDocument, mod, openDiagram, showCanvas } from './helpers';

for (const item of fixtures.templates) {
  test(`${item.template}: workbench keyboard navigation protects the selected background document`, async ({ page }, testInfo) => {
    const content = `# SYNTHETIC workbench focus\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`;
    await launchDocument(page, content);
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press(`${mod}+a`);
    const opener = page.getByRole('button', { name: '在可视化画布中编辑图表', exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    const workbench = page.locator('.mermaid-workbench');
    const first = workbench.getByRole('button', { name: '全屏编辑', exact: true });
    const last = workbench.getByRole('button', { name: '应用到文档', exact: true });
    for (const tab of ['画布', '模板', '源码']) {
      await page.locator('.workbench-tabs').getByRole('button', { name: tab, exact: true }).click();
      await first.focus();
      const stayedInside: boolean[] = [];
      const focusEvidence: unknown[] = [];
      for (let i = 0; i < 36; i++) {
        await page.keyboard.press('Shift+Tab');
        stayedInside.push(await workbench.evaluate(element => element.contains(document.activeElement)));
        focusEvidence.push(await workbench.evaluate(element => ({
          active: document.activeElement?.outerHTML.slice(0, 700),
          inside: element.contains(document.activeElement),
          inert: Array.from(document.querySelectorAll('[inert]')).map(node => node.className || node.tagName),
        })));
      }
      await last.focus();
      await page.keyboard.press('Tab');
      stayedInside.push(await workbench.evaluate(element => element.contains(document.activeElement)));
      await testInfo.attach(`${tab}-focus`, { body: JSON.stringify(focusEvidence, null, 2), contentType: 'application/json' });
      expect.soft(stayedInside.every(Boolean), `${tab}: focus stays in the workbench`).toBe(true);
      await expect.soft(editor).toHaveText(content, { useInnerText: true });
    }
    await workbench.getByRole('button', { name: '取消', exact: true }).click();
    await expect(workbench).toHaveCount(0);
    await expect(editor).toHaveText(content, { useInnerText: true });
    await expect(opener).toBeFocused();
  });
}

test('workbench focus isolation preserves canvas Tab and Escape before modal dismissal', async ({ page }) => {
  const source = 'flowchart LR\n  A["SYNTHETIC start"]\n  B["SYNTHETIC end"]\n  A --> B';
  const content = `# SYNTHETIC layered keys\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`;
  await launchDocument(page, content);
  await openDiagram(page);
  const workbench = page.locator('.mermaid-workbench');
  const canvas = page.locator('.mermaid-canvas-editor');
  const start = canvas.locator('.mermaid-canvas-node[data-mermaid-node-id="A"]');
  await start.click();
  await canvas.focus();
  await page.keyboard.press('Tab');
  await expect(canvas.locator('.mermaid-canvas-node')).toHaveCount(3);
  await expect(canvas.locator('.canvas-node-content input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(workbench).toBeVisible();
  await expect(canvas.locator('.canvas-node-content input')).toHaveCount(0);
  await canvas.getByRole('button', { name: '撤销', exact: true }).click();
  await start.click();
  await page.keyboard.press('c');
  await expect(canvas.getByRole('button', { name: '完成', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(workbench).toBeVisible();
  await expect(canvas.getByRole('button', { name: '完成', exact: true })).toHaveCount(0);
  await page.locator('.workbench-tabs').getByRole('button', { name: '源码', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).press('Escape');
  await expect(workbench).toBeVisible();
  await showCanvas(page);
  await canvas.focus();
  await page.keyboard.press('Escape');
  await expect(workbench).toHaveCount(0);
  await expect(page.locator('.cm-content')).toHaveText(content, { useInnerText: true });
});
