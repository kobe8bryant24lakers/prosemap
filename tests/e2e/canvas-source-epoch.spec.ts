import { expect, test, type Page } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

// Native file IPC is mocked by launchDocument; canvas/source UI and their undo
// histories run unchanged. These cases do not claim installed-app coverage.
const initialSource = 'flowchart LR\n  A["Old"] --> B["Keep"]';
const markdown = `# Source history\n\n\`\`\`mermaid\n${initialSource}\n\`\`\`\n`;
const node = (page: Page) => page.locator('.mermaid-canvas-node[data-mermaid-node-id="A"]');
const undo = (page: Page) => page.locator('.mermaid-workbench').getByRole('button', { name: '撤销', exact: true });
const redo = (page: Page) => page.locator('.mermaid-workbench').getByRole('button', { name: '重做', exact: true });

async function rename(page: Page, label: string) {
  await node(page).dblclick();
  await node(page).locator('input').fill(label);
  await node(page).locator('input').press('Enter');
  await expect(node(page)).toContainText(label);
}

test('format-only source edits clear old canvas undo/redo and preserve the new spelling on a repeated graph', async ({ page }) => {
  await launchDocument(page, markdown);
  await openDiagram(page);
  await rename(page, 'New');
  await rename(page, 'Later');
  await undo(page).click();
  await expect(node(page)).toContainText('New');
  await expect(undo(page)).toBeEnabled();
  await expect(redo(page)).toBeEnabled();
  const geometry = await node(page).getAttribute('style');

  await draftSource(page);
  const external = 'graph LR\n\tA["New"] --> B["Keep"]\n\n';
  await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(external);
  await showCanvas(page);
  await expect(undo(page)).toBeDisabled();
  await expect(redo(page)).toBeDisabled();
  expect(await node(page).getAttribute('style')).toBe(geometry);

  await rename(page, 'Old');
  expect(await draftSource(page)).toBe(external.replace('New', 'Old'));
  await showCanvas(page);
  await undo(page).click();
  expect(await draftSource(page)).toBe(external);
  await showCanvas(page);
  await expect(undo(page)).toBeDisabled();
  await redo(page).click();
  expect(await draftSource(page)).toBe(external.replace('New', 'Old'));
});

test('semantic external source edits also prevent old spellings from returning', async ({ page }) => {
  await launchDocument(page, markdown);
  await openDiagram(page);
  await rename(page, 'New');
  await draftSource(page);
  const external = 'graph LR\n\tA["Old"] --> B["Keep"]\n\n';
  await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(external);
  await showCanvas(page);
  await expect(undo(page)).toBeDisabled();
  await rename(page, 'New');
  expect(await draftSource(page)).toBe(external.replace('Old', 'New'));
  await showCanvas(page);
  await undo(page).click();
  expect(await draftSource(page)).toBe(external);
});

test('temporary incomplete source restored to identical bytes retains canvas history', async ({ page }) => {
  await launchDocument(page, markdown);
  await openDiagram(page);
  await rename(page, 'New');
  await rename(page, 'Later');
  await undo(page).click();
  const source = await draftSource(page);
  const editor = page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true });
  await editor.fill('flowchart');
  await editor.fill(source);
  await showCanvas(page);
  await expect(undo(page)).toBeEnabled();
  await expect(redo(page)).toBeEnabled();
  await redo(page).click();
  expect(await draftSource(page)).toBe(initialSource.replace('Old', 'Later'));
  await showCanvas(page);
  await undo(page).click();
  await undo(page).click();
  expect(await draftSource(page)).toBe(initialSource);
});
