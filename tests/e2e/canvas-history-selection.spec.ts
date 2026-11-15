import { expect, test, type Page } from '@playwright/test';
import { launchDocument, openDiagram } from './helpers';

// Mock only native file IPC. The canvas controls, history and inspectors are real UI.
const undo = (page: Page) => page.locator('.history-tools').getByRole('button', { name: '撤销', exact: true });
const redo = (page: Page) => page.locator('.history-tools').getByRole('button', { name: '重做', exact: true });

for (const item of [
  { kind: 'ER', source: 'erDiagram\n  CUSTOMER {\n    string id PK\n    string name\n    string email\n  }', id: 'CUSTOMER', values: ['string id PK', 'string name', 'string email'] },
  { kind: 'class', source: 'classDiagram\n  class Customer {\n    +String id\n    +String name\n    +save() void\n  }', id: 'Customer', values: ['+String id', '+String name', '+save() void'] },
]) {
  test(`${item.kind}: deleting a detail row then undo/redo keeps the selected object and inspector usable`, async ({ page }) => {
    await launchDocument(page, `# History selection\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    const target = page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.id}"]`);
    await target.click();
    const rows = page.locator('.canvas-detail-list input');
    const values = () => rows.evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value));
    expect(await values()).toEqual(item.values);
    await page.getByRole('button', { name: '删除第 2 项', exact: true }).click();
    expect(await values()).toEqual([item.values[0], item.values[2]]);

    await undo(page).click();
    await expect(target).toHaveClass(/selected/);
    await expect(page.locator('.canvas-detail-list')).toBeVisible();
    expect(await values()).toEqual(item.values);

    await redo(page).click();
    await expect(target).toHaveClass(/selected/);
    await expect(page.locator('.canvas-detail-list')).toBeVisible();
    expect(await values()).toEqual([item.values[0], item.values[2]]);

    // Continue directly from the same inspector without another canvas click.
    await page.getByRole('button', { name: '删除第 2 项', exact: true }).click();
    expect(await values()).toEqual([item.values[0]]);
    await undo(page).click();
    expect(await values()).toEqual([item.values[0], item.values[2]]);
  });
}

test('restoring a deleted node does not invent a selection or reopen its inspector', async ({ page }) => {
  await launchDocument(page, '# Delete boundary\n\n```mermaid\nflowchart LR\n  A["First"] --> B["Second"]\n```\n');
  await openDiagram(page);
  const target = page.locator('.mermaid-canvas-node[data-mermaid-node-id="A"]');
  await target.click();
  await page.locator('.canvas-context-bar').getByRole('button', { name: '删除', exact: true }).click();
  await expect(target).toHaveCount(0);
  await undo(page).click();
  await expect(target).toHaveCount(1);
  await expect(page.locator('.mermaid-canvas-node.selected')).toHaveCount(0);
  await redo(page).click();
  await expect(target).toHaveCount(0);
  await expect(page.locator('.mermaid-canvas-node.selected')).toHaveCount(0);
});
