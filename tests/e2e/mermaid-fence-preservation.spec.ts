import { expect, test } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, savedSource, showCanvas } from './helpers';

for (const [name, block] of [
  ['indented closer', '~~~mermaid\nmindmap\n  root(("Root"))\n    child["Child"]\n      grand["Grandchild"]\n   ~~~'],
  ['variable quote prefix', '> ~~~mermaid\n> mindmap\n>   root(("Root"))\n >     child["Child"]\n>       grand["Grandchild"]\n> ~~~'],
] as const) {
  test(`${name}: valid mindmap hierarchy stays editable and only the requested label changes`, async ({ page }) => {
    const markdown = `# Mindmap\n\n${block}\n`;
    await launchDocument(page, markdown);
    await openDiagram(page);
    await expect(page.locator('.mermaid-canvas-node')).toHaveCount(3);
    expect(await draftSource(page)).toBe('mindmap\n  root(("Root"))\n    child["Child"]\n      grand["Grandchild"]');
    await showCanvas(page);
    const child = page.locator('.mermaid-canvas-node[data-mermaid-node-id="child"]');
    await child.dblclick();
    await child.locator('input').fill('Updated');
    await child.locator('input').press('Enter');
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
    expect(await savedSource(page)).toBe(markdown.replace('Child', 'Updated'));
  });
}

for (const [name, block] of [
  ['tilde', '~~~MeRmAiD extra\n\n  flowchart LR\n    A["Old"] --> B["Keep"]\n\n~~~~~  '],
  ['quote-list', '> 1. ````MERMAID\r\n>    \r\n>      flowchart LR\r\n>        A["Old"] --> B["Keep"]\r\n>    \r\n>    `````'],
] as const) {
  test(`${name}: preview/canvas application preserves fence spelling, whitespace and exact outside bytes`, async ({ page }) => {
    const markdown = `# Fence\n\n${block}\n\nTail\n`;
    await launchDocument(page, markdown);
    await openDiagram(page);
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
    expect(await savedSource(page)).toBe(markdown);
    await openDiagram(page);
    const target = page.locator('.mermaid-canvas-node[data-mermaid-node-id="A"]');
    await target.dblclick();
    await target.locator('input').fill('改名🧭');
    await target.locator('input').press('Enter');
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
    expect(await savedSource(page)).toBe(markdown.replace('Old', '改名🧭'));
  });
}

test('source-only blank-line edits are pending and survive apply, save and document undo', async ({ page }) => {
  const markdown = '# Fence\n\n~~~mermaid\nflowchart LR\n  A-->B\n~~~~\n';
  await launchDocument(page, markdown);
  await openDiagram(page);
  const source = await draftSource(page);
  await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(`\n${source}\n\n`);
  await page.getByRole('button', { name: '关闭图表工作台', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await showCanvas(page);
  await page.getByRole('button', { name: '应用到文档', exact: true }).click();
  await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
  expect(await savedSource(page)).toBe(markdown.replace('flowchart LR', '\nflowchart LR').replace('A-->B\n', 'A-->B\n\n\n'));
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await savedSource(page)).toBe(markdown);
});
