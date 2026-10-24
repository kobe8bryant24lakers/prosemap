import { test, expect } from '@playwright/test';
import { fixture, launchDocument, mod, savedSource } from './helpers';

const sample = '# 原生与浏览器分开记录\n\n段落中文 emoji 🧭\n下一行\n\n尾部保持\n';

test('all document view modes restore after reopening the frontend', async ({ page }) => {
  await launchDocument(page, sample);
  for (const name of ['纯编辑', '纯预览', '左编辑右预览']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await savedSource(page)).toBe(sample);
  }
});
for (const name of ['粗体', '斜体', '链接', '行内代码', '二级标题', '列表', '任务清单', '引用', '插入表格', '插入代码块']) {
  test(`format ${name}: one undo restores all bytes across views`, async ({ page }) => {
    await launchDocument(page, sample);
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press(`${mod}+a`);
    await page.getByRole('button', { name, exact: true }).click();
    const changed = await savedSource(page);
    expect(changed).not.toBe(sample);
    await page.getByRole('button', { name: '纯预览', exact: true }).click();
    await expect(editor).toBeHidden();
    await page.getByRole('button', { name: '左编辑右预览', exact: true }).click();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(await savedSource(page)).toBe(sample);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect(await savedSource(page)).toBe(changed);
  });
}

test('file keyboard shortcuts distinguish save/save as/open and isolate modal drafts', async ({ page }) => {
  await launchDocument(page, sample);
  const callArgs = () => page.evaluate(() => (window as any).__acceptance.calls.filter((call: any) => call.command === 'save_local_markdown').map((call: any) => call.args));
  await page.keyboard.press(`${mod}+s`);
  await expect.poll(async () => (await callArgs()).length).toBe(1);
  expect((await callArgs())[0].path).toBe('/acceptance/acceptance.md');
  await page.keyboard.press(`${mod}+Shift+s`);
  await expect.poll(async () => (await callArgs()).length).toBe(2);
  expect((await callArgs())[1].path).toBeNull();
  await page.keyboard.press(`${mod}+o`);
  await expect.poll(() => page.evaluate(() => (window as any).__acceptance.calls.filter((c: any) => c.command === 'pick_markdown_file').length)).toBe(1);
  await page.getByRole('button', { name: 'Mermaid 可视化画布', exact: true }).click();
  await expect(page.locator('.mermaid-workbench')).toBeVisible();
  await page.keyboard.press(`${mod}+Shift+s`);
  await page.keyboard.press(`${mod}+o`);
  expect((await callArgs()).length).toBe(2);
  expect(await page.evaluate(() => (window as any).__acceptance.calls.filter((c: any) => c.command === 'pick_markdown_file').length)).toBe(1);
  await page.keyboard.press(`${mod}+s`);
  await expect.poll(async () => (await callArgs()).length).toBe(3);
  expect((await callArgs())[2].content).toBe(sample);
  await expect(page.locator('.mermaid-workbench')).toBeVisible();
});

test('document navigation returns from preview to the original edit selection', async ({ page }) => {
  await launchDocument(page, sample);
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+Home`);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  await page.getByRole('button', { name: '纯预览', exact: true }).click();
  await page.getByRole('button', { name: '文档编辑', exact: true }).click();
  await expect(page.getByRole('button', { name: '纯编辑', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cm-content')).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  expect(await savedSource(page)).toBe(sample);
});

test('save cancellation and rejection keep dirty content and allow recovery', async ({ page }) => {
  await launchDocument(page, sample);
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.insertText('新增保留');
  await page.evaluate(() => { (window as any).__acceptance.cancelSave = true; });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.saved-state')).toContainText('未保存');
  await page.evaluate(() => { (window as any).__acceptance.cancelSave = false; (window as any).__acceptance.saveError = '测试：磁盘写入失败'; });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('测试：磁盘写入失败', { exact: true })).toBeVisible();
  await expect(page.locator('.saved-state')).toContainText('未保存');
  await page.evaluate(() => { (window as any).__acceptance.saveError = ''; });
  expect(await savedSource(page)).toContain('新增保留');
  await expect(page.locator('.saved-state')).toContainText('已保存');
});

test('search replace, options, locale change and undo keep the document consistent', async ({ page }) => {
  await launchDocument(page, 'word Word words\nword\n');
  await page.getByRole('button', { name: '查找与替换', exact: true }).click();
  await page.getByRole('textbox', { name: '查找', exact: true }).fill('word');
  await page.getByRole('textbox', { name: '替换为', exact: true }).fill('替换');
  await page.getByRole('checkbox', { name: '区分大小写', exact: true }).check();
  await page.getByRole('checkbox', { name: '全词匹配', exact: true }).check();
  await page.getByRole('button', { name: '全部替换', exact: true }).click();
  expect(await savedSource(page)).toBe('替换 Word words\n替换\n');
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await expect(page.getByRole('textbox', { name: 'Find', exact: true })).toHaveValue('word');
  await expect(page.getByRole('textbox', { name: 'Replace', exact: true })).toHaveValue('替换');
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await savedSource(page)).toBe('word Word words\nword\n');
});

test('8406-line document: scroll to end, edit, switch views, save and undo', async ({ page }, testInfo) => {
  const original = fixture('long-document-600-sections.md');
  const start = Date.now();
  await launchDocument(page, original);
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('末尾验收_8406🧭');
  await page.getByRole('button', { name: '纯编辑', exact: true }).click();
  expect(await savedSource(page)).toBe(original + '\n末尾验收_8406🧭');
  await page.getByRole('button', { name: '左编辑右预览', exact: true }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await savedSource(page)).toBe(original + '\n');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await savedSource(page)).toBe(original);
  await testInfo.attach('elapsed-ms', { body: String(Date.now() - start), contentType: 'text/plain' });
});
