import { test, expect } from '@playwright/test';
import { launchDocument, openDiagram, savedSource, mod } from './helpers';

const lines = ['# 中文🧭', '', '```mermaid', 'graph LR', '  A[第一幅] --> B[不改]', '```', '', '- 列表', '',
  '  ```mermaid', '  graph LR', '    %% 原注释 --> 保留', '    A[入口]  -->|路线| B([处理])', '  ```', '', '尾文不变'];

for (const endings of [['CRLF', ['\r\n']], ['CR', ['\r']], ['mixed', ['\r\n', '\n', '\r']]] as const) {
  test(`${endings[0]}: exact save, nested preview target, minimal graph edit, cross-view undo/redo and next file history isolation`, async ({ page }) => {
    const original = lines.map((line, i) => line + (i === lines.length - 1 ? '' : endings[1][i % endings[1].length])).join('');
    await launchDocument(page, original);
    expect(await savedSource(page)).toBe(original);
    await openDiagram(page, 1);
    const node = page.locator('.mermaid-canvas-node[data-mermaid-node-id="A"]');
    await node.dblclick();
    await node.locator('input').fill('分支 --> 下一步');
    await node.locator('input').press('Enter');
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
    const expected = original.replace('A[入口]', 'A["分支 --> 下一步"]');
    expect(await savedSource(page)).toBe(expected);
    await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
    expect(await savedSource(page)).toBe(expected);
    await page.getByRole('button', { name: '纯预览', exact: true }).click();
    await expect(page.locator('.preview-pane .mermaid-svg svg')).toHaveCount(2);
    await page.getByRole('button', { name: '文档编辑', exact: true }).click();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(await savedSource(page)).toBe(original);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect(await savedSource(page)).toBe(expected);
    await page.evaluate(() => {
      const a = (window as any).__acceptance;
      a.disk['/acceptance/next.md'] = '# 下一份\n\nLF\n';
      a.nextFile = { path: '/acceptance/next.md', name: 'next.md', content: a.disk['/acceptance/next.md'] };
    });
    await page.getByRole('button', { name: '打开文件', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('next');
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(await savedSource(page)).toBe('# 下一份\n\nLF\n');
    await page.locator('.cm-content').click();
    await page.keyboard.press(`${mod}+End`);
    await page.keyboard.press('Enter');
    expect(await savedSource(page)).toBe('# 下一份\n\nLF\n\n');
  });
}

test('CRLF typed newline, search replacement, undo and external reload preserve disk comparison bytes', async ({ page }) => {
  const original = '# 原文\r\n\r\nword Word\r\n尾';
  await launchDocument(page, original);
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.press('Enter');
  expect(await savedSource(page)).toBe(original + '\r\n');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await savedSource(page)).toBe(original);
  await page.getByRole('button', { name: '查找与替换', exact: true }).click();
  await page.getByRole('textbox', { name: '查找', exact: true }).fill('word');
  await page.getByRole('textbox', { name: '替换为', exact: true }).fill('替换🧭');
  await page.getByRole('checkbox', { name: '区分大小写', exact: true }).check();
  await page.getByRole('button', { name: '全部替换', exact: true }).click();
  expect(await savedSource(page)).toBe(original.replace('word', '替换🧭'));
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await savedSource(page)).toBe(original);
  await page.evaluate(() => { (window as any).__acceptance.disk['/acceptance/acceptance.md'] = '外部\r\n内容\r\n'; });
  await page.getByRole('button', { name: '重新载入', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('外部');
  expect(await savedSource(page)).toBe('外部\r\n内容\r\n');
});
