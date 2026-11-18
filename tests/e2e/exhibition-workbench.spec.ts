import { expect, test, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { draftSource, editorSource, launchDocument, mod, openDiagram } from './helpers';

const handbook = readFileSync(new URL('../../examples/traveling-exhibition.zh-CN.md', import.meta.url), 'utf8');
const diagrams = [...handbook.matchAll(/^```mermaid\n([\s\S]*?)\n```$/gm)].map(match => match[1]);
const cases = [
  ['流程', 'Pack', '装箱并记录封签'], ['用例', 'Receiver', '«actor» 接收馆'],
  ['4+1', 'Logic', '逻辑：调拨单与签收凭证'], ['分层架构', 'Outbox', '待发通知'],
  ['包结构', 'Notify', '通知投递'], ['时序', '事务已提交', '事务已提交'],
  ['状态', '已签收', '已签收'], ['类', 'TransferOrder', 'TransferOrder'],
  ['ER 字段', 'custodian_venue_id', 'EXHIBIT'], ['甘特任务编号', 'receive', '岩桥核对签收'],
  ['思维导图', '异常不能绕过复核', '异常不能绕过复核'],
] as const;

async function centeredInCanvas(selected: Locator) {
  return selected.evaluate(el => {
    const rect = el.getBoundingClientRect(), canvas = el.closest('.canvas-editor-viewport')!.getBoundingClientRect();
    return Math.abs(rect.x + rect.width / 2 - canvas.x - canvas.width / 2) < 4
      && Math.abs(rect.y + rect.height / 2 - canvas.y - canvas.height / 2) < 4;
  });
}

test('all eleven exhibition diagrams render and can be located by name, ID, member or message without changing source or zoom', async ({ page }) => {
  await launchDocument(page, handbook, 'synthetic-exhibition.md');
  const preview = page.locator('.preview-pane');
  await expect(preview.locator('.mermaid-svg > svg')).toHaveCount(cases.length, { timeout: 30000 });
  for (const link of await preview.locator('a[href^="#"]').all()) {
    expect(await link.evaluate(el => Boolean(document.getElementById(decodeURIComponent((el as HTMLAnchorElement).hash.slice(1)))))).toBe(true);
  }
  for (const [i, [name, query, label]] of cases.entries()) await test.step(name, async () => {
    await openDiagram(page, i);
    const canvas = page.locator('.mermaid-canvas-editor');
    const zoom = await canvas.locator('.canvas-zoom-value').textContent();
    await canvas.focus();
    await page.keyboard.press(mod + '+f');
    const find = canvas.getByRole('combobox', { name: '查找图中对象' });
    await expect(find).toBeFocused();
    await find.fill(query);
    await expect(canvas.getByRole('option').first()).toContainText(label);
    await find.press('Enter');
    await expect(canvas.locator('.canvas-selection-title b')).toHaveText(label);
    const selected = canvas.locator(i === 5 ? '.canvas-edge-label.selected' : '.mermaid-canvas-node.selected');
    await expect.poll(() => centeredInCanvas(selected)).toBe(true);
    await expect(canvas.locator('.canvas-zoom-value')).toHaveText(zoom!);
    await expect(canvas.locator('.history-tools button').first()).toBeDisabled();
    expect(await draftSource(page)).toBe(diagrams[i]);
    await page.getByRole('button', { name: '关闭图表工作台', exact: true }).click();
  });
  expect(await editorSource(page)).toBe(handbook);
});

test('editing a located field updates just its diagram in the handbook and a document undo restores the original', async ({ page }) => {
  await launchDocument(page, handbook, 'synthetic-exhibition.md');
  await openDiagram(page, 8);
  await page.getByRole('button', { name: '查找图中对象', exact: true }).click();
  await page.getByRole('combobox', { name: '查找图中对象' }).fill('string target_venue_id');
  await page.getByRole('combobox', { name: '查找图中对象' }).press('Enter');
  await expect(page.getByRole('textbox', { name: '实体字段 1', exact: true })).toBeFocused();
  const field = page.getByRole('textbox', { name: '实体字段 4', exact: true });
  await expect(field).toHaveValue('string target_venue_id FK');
  await field.fill('string receiving_venue_id FK');
  await field.press('Tab');
  const apply = page.getByRole('button', { name: '应用到文档' });
  await expect(page.locator('.workbench-draft-state')).toHaveText('草稿有改动，尚未写入文档');
  expect(await editorSource(page)).toBe(handbook);
  await apply.click();
  await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
  const changed = await editorSource(page);
  const [before, after] = handbook.split(diagrams[8]);
  expect(changed.startsWith(before) && changed.endsWith(after)).toBe(true);
  expect(changed.slice(before.length, changed.length - after.length)).toContain('string receiving_venue_id FK');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await editorSource(page)).toBe(handbook);
});

test('narrow English tools, keyboard search, template recovery and source-only diagrams stay usable', async ({ page }) => {
  const source = '# Synthetic sequence\n\n```mermaid\n' + diagrams[5] + '\n```\n';
  await launchDocument(page, source);
  await openDiagram(page);
  await page.getByRole('button', { name: '关闭图表工作台', exact: true }).click();
  await page.getByRole('combobox', { name: '界面语言' }).selectOption('en');
  await page.setViewportSize({ width: 390, height: 740 });
  await page.getByRole('button', { name: 'Edit diagram on the visual canvas', exact: true }).click();
  const dialog = page.locator('.mermaid-workbench');
  const more = dialog.getByRole('button', { name: 'More tools' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(dialog.locator('.canvas-tool-shelf .canvas-node-library')).toBeVisible();
  await more.click();
  const trigger = dialog.getByRole('button', { name: 'Find in diagram' });
  await trigger.click();
  const find = dialog.getByRole('combobox', { name: 'Find in diagram' });
  await find.fill('Synthetic missing object');
  await expect(dialog.getByText('No matches. Try a name or an ID.')).toBeVisible();
  await find.fill('签收');
  await find.press('ArrowDown');
  const chosen = await dialog.locator('[role="option"][aria-selected="true"] strong').textContent();
  await find.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(find).toBeVisible();
  await find.press('Enter');
  await expect(dialog.locator('.canvas-selection-title b')).toHaveText(chosen!);
  await trigger.click();
  await find.press('Escape');
  await expect(trigger).toBeFocused();
  await dialog.locator('.workbench-tabs button').nth(1).click();
  const templates = dialog.getByLabel('Find templates');
  await templates.fill('gantt');
  await expect(dialog.locator('.workbench-template-grid button')).toHaveCount(1);
  await templates.fill('no such synthetic template');
  await expect(dialog.getByRole('status').filter({ hasText: 'No matching templates' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Clear template search' }).click();
  await expect(templates).toBeFocused();
  await expect(dialog.locator('.workbench-template-grid button')).toHaveCount(11);
  await dialog.locator('.workbench-tabs button').nth(3).click();
  const raw = 'pie title Synthetic attendance\n  "Local" : 4\n  "Visiting" : 3';
  await dialog.locator('.workbench-source-panel textarea').fill(raw);
  await dialog.locator('.workbench-tabs button').first().click();
  await dialog.getByRole('button', { name: 'Edit source' }).click();
  await expect(dialog.locator('.workbench-source-panel textarea')).toBeFocused();
  await expect(dialog.locator('.workbench-source-panel textarea')).toHaveValue(raw);
  await dialog.locator('.workbench-source-panel textarea').fill('not a diagram');
  await dialog.locator('.workbench-footer .confirm-button').click();
  await expect(dialog.locator('.workbench-footer .error')).toBeInViewport({ ratio: 0.99 });
  await expect(dialog.locator('.workbench-footer .confirm-button')).toBeInViewport({ ratio: 0.99 });
  expect(await editorSource(page)).toBe(source);
});
