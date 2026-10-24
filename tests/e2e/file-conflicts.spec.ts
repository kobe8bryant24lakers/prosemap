import { test, expect, type Page } from '@playwright/test';
import { launchDocument, mod, savedSource } from './helpers';

const original = '# 原文\n\n磁盘基线🧭\n';
const external = '# 外部新内容\n\n另一编辑器的修改🧪\n';
const conflict = '文件已被外部修改，未覆盖磁盘内容。请重新载入，或另存为以保留当前修改。';
const diskContent = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__acceptance.disk['/acceptance/acceptance.md']);
async function changeDisk(page: import('@playwright/test').Page) {
  await page.evaluate(content => { (window as any).__acceptance.disk['/acceptance/acceptance.md'] = content; }, external);
}

async function appendText(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.insertText(text);
}

// Delay only the native save boundary. The UI takes its real snapshot, handles
// further edits, and updates its file/session state through production code.
async function pauseNextSave(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    const state = w.__saveAcceptance = { requests: [] as any[], release: null as null | (() => void), completed: 0 };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command !== 'save_local_markdown') return invoke(command, args);
      state.requests.push(args);
      try {
        if (state.requests.length === 1) await new Promise<void>(resolve => { state.release = resolve; });
        return await invoke(command, args);
      } finally { state.completed++; }
    };
  });
}

async function waitForSave(page: Page) {
  await expect.poll(() => page.evaluate(() => !!(window as any).__saveAcceptance.release)).toBe(true);
}

async function releaseSave(page: Page) {
  await page.evaluate(() => (window as any).__saveAcceptance.release());
  await expect.poll(() => page.evaluate(() => (window as any).__saveAcceptance.completed)).toBe(1);
}

test('external modification blocks save, preserves both versions, and Save As recovers local edits', async ({ page }) => {
  await launchDocument(page, original);
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.insertText('本地编辑');
  await changeDisk(page);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText(conflict, { exact: true })).toBeVisible();
  expect(await diskContent(page)).toBe(external);
  await expect(page.locator('.saved-state')).toContainText('未保存');
  await expect(page.locator('.cm-content')).toContainText('本地编辑');
  await page.getByRole('textbox', { name: '文档名称', exact: true }).fill('保留本地版本');
  await page.getByRole('button', { name: '另存为', exact: true }).click();
  await expect(page.locator('.saved-state')).toContainText('已保存到本地');
  expect(await diskContent(page)).toBe(external);
  expect(await page.evaluate(() => (window as any).__acceptance.disk['/acceptance/保留本地版本.md'])).toBe(original + '本地编辑');
  expect(await savedSource(page)).toBe(original + '本地编辑');
});

test('reload dirty file: cancel retains local edits, confirm reads disk, subsequent save uses new baseline', async ({ page }) => {
  await launchDocument(page, original);
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.insertText('本地编辑');
  await changeDisk(page);
  await page.getByRole('button', { name: '重新载入', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.getByRole('button', { name: '继续编辑', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '放弃修改并重新载入', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '关闭确认对话框', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: '放弃修改并重新载入', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByRole('button', { name: '重新载入', exact: true })).toBeFocused();
  await expect(page.locator('.cm-content')).toContainText('本地编辑');
  await page.getByRole('button', { name: '重新载入', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改并重新载入', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('另一编辑器的修改');
  await expect(page.locator('.saved-state')).toContainText('已保存到本地');
  expect(await savedSource(page)).toBe(external);
});

test('clean reload in preview retains view; read error preserves document and remains recoverable', async ({ page }) => {
  await launchDocument(page, original);
  await page.getByRole('button', { name: '纯预览', exact: true }).click();
  await changeDisk(page);
  await page.evaluate(() => { (window as any).__acceptance.readError = '测试：文件已删除'; });
  await page.getByRole('button', { name: '重新载入', exact: true }).click();
  await expect(page.getByText('测试：文件已删除', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '原文', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__acceptance.readError = ''; });
  await page.getByRole('button', { name: '重新载入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '外部新内容', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '纯预览', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('editing while reload is in flight never replaces new local input', async ({ page }) => {
  await launchDocument(page, original);
  await changeDisk(page);
  await page.evaluate(() => { (window as any).__acceptance.pauseRead = true; });
  await page.getByRole('button', { name: '重新载入', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__acceptance.releaseRead)).toBe(true);
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.insertText('载入时输入');
  await page.evaluate(() => { (window as any).__acceptance.releaseRead(); });
  await expect(page.getByText('载入期间文档已变化，请重新载入', { exact: true })).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('载入时输入');
  await expect(page.locator('.saved-state')).toContainText('未保存');
  expect(await diskContent(page)).toBe(external);
});

test('save snapshots once, ignores duplicate save actions, and leaves edits made in flight dirty', async ({ page }) => {
  await launchDocument(page, original);
  await pauseNextSave(page);
  await appendText(page, '保存前');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await waitForSave(page);
  await appendText(page, '保存期间');
  await page.keyboard.press(`${mod}+s`);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '另存为', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__saveAcceptance.requests.length)).toBe(1);
  expect(await diskContent(page)).toBe(original);
  await releaseSave(page);
  expect(await diskContent(page)).toBe(original + '保存前');
  await expect(page.locator('.saved-state')).toContainText('未保存');
  await expect(page.locator('.cm-content')).toContainText('保存前保存期间');
  await expect(page.getByText('已保存到 acceptance.md，保存期间产生的新修改仍待保存', { exact: true })).toBeVisible();
  expect(await savedSource(page)).toBe(original + '保存前保存期间');
  await expect(page.locator('.saved-state')).toContainText('已保存到本地');
  expect(await page.evaluate(() => (window as any).__saveAcceptance.requests[1].expectedContent)).toBe(original + '保存前');
});

test('Save As in flight keeps later edits dirty and subsequent Save writes the new destination', async ({ page }) => {
  await launchDocument(page, original);
  await pauseNextSave(page);
  await appendText(page, '另存前');
  await page.getByRole('textbox', { name: '文档名称', exact: true }).fill('异步副本');
  await page.getByRole('button', { name: '另存为', exact: true }).click();
  await waitForSave(page);
  await appendText(page, '另存期间');
  await releaseSave(page);
  await expect(page.locator('.saved-state')).toContainText('未保存');
  await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('异步副本');
  expect(await diskContent(page)).toBe(original);
  expect(await page.evaluate(() => (window as any).__acceptance.disk['/acceptance/异步副本.md'])).toBe(original + '另存前');
  expect(await savedSource(page)).toBe(original + '另存前另存期间');
  expect(await page.evaluate(() => (window as any).__saveAcceptance.requests[1])).toMatchObject({
    path: '/acceptance/异步副本.md', expectedContent: original + '另存前',
  });
  expect(await diskContent(page)).toBe(original);
  await expect(page.locator('.saved-state')).toContainText('已保存到本地');
});

for (const outcome of ['success', 'failure'] as const) {
  test(`late save ${outcome} after switching files never changes the new document or its save baseline`, async ({ page }) => {
    const next = '# 新文件\n\n独立基线\n';
    await launchDocument(page, original);
    await pauseNextSave(page);
    await appendText(page, '旧文件待保存');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await waitForSave(page);
    await page.evaluate(content => {
      const state = (window as any).__acceptance;
      state.nextFile = { path: '/acceptance/next.md', name: 'next.md', content };
      state.disk['/acceptance/next.md'] = content;
    }, next);
    await page.getByRole('button', { name: '打开文件', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: '放弃并打开', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('next');
    await expect(page.locator('.cm-content')).toContainText('独立基线');
    await appendText(page, '新文件输入');
    if (outcome === 'failure') await page.evaluate(() => { (window as any).__acceptance.saveError = '测试：旧文件保存迟到失败'; });
    await releaseSave(page);
    await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('next');
    await expect(page.locator('.cm-content')).toContainText('独立基线');
    await expect(page.locator('.cm-content')).toContainText('新文件输入');
    await expect(page.locator('.saved-state')).toContainText('未保存');
    await expect(page.getByText('测试：旧文件保存迟到失败', { exact: true })).toHaveCount(0);
    await expect(page.getByText('文件已保存', { exact: true })).toHaveCount(0);
    expect(await diskContent(page)).toBe(outcome === 'success' ? original + '旧文件待保存' : original);
    expect(await page.evaluate(() => (window as any).__acceptance.disk['/acceptance/next.md'])).toBe(next);
    await page.evaluate(() => { (window as any).__acceptance.saveError = ''; });
    expect(await savedSource(page)).toBe(next + '新文件输入');
    expect(await page.evaluate(() => (window as any).__saveAcceptance.requests[1])).toMatchObject({
      path: '/acceptance/next.md', expectedContent: next,
    });
    await expect(page.locator('.saved-state')).toContainText('已保存到本地');
  });
}

test('save failure preserves unsaved text and original disk baseline; retry saves the latest edits', async ({ page }) => {
  await launchDocument(page, original);
  await appendText(page, '失败前');
  await page.evaluate(() => { (window as any).__acceptance.saveError = '测试：磁盘空间不足'; });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('测试：磁盘空间不足', { exact: true })).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('失败前');
  await expect(page.locator('.saved-state')).toContainText('未保存');
  expect(await diskContent(page)).toBe(original);
  await appendText(page, '重试前继续输入');
  await page.evaluate(() => { (window as any).__acceptance.saveError = ''; });
  expect(await savedSource(page)).toBe(original + '失败前重试前继续输入');
  await expect(page.locator('.saved-state')).toContainText('已保存到本地');
  expect(await page.evaluate(() => (window as any).__acceptance.calls.filter((call: any) => call.command === 'save_local_markdown').map((call: any) => call.args.expectedContent))).toEqual([original, original]);
});

test('canceling Save As preserves edits and original file association, then retry creates only the requested copy', async ({ page }) => {
  await launchDocument(page, original);
  await appendText(page, '取消前');
  await page.evaluate(() => { (window as any).__acceptance.cancelSave = true; });
  await page.getByRole('button', { name: '另存为', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__acceptance.calls.filter((call: any) => call.command === 'save_local_markdown').length)).toBe(1);
  await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('acceptance');
  await expect(page.locator('.cm-content')).toContainText('取消前');
  await expect(page.locator('.saved-state')).toContainText('未保存');
  expect(await diskContent(page)).toBe(original);
  expect(await page.evaluate(() => (window as any).__acceptance.saved)).toHaveLength(0);
  await page.evaluate(() => { (window as any).__acceptance.cancelSave = false; });
  expect(await savedSource(page)).toBe(original + '取消前');
  expect(await page.evaluate(() => (window as any).__acceptance.saved.at(-1).path)).toBe('/acceptance/acceptance.md');
  await appendText(page, '重试副本');
  await page.getByRole('textbox', { name: '文档名称', exact: true }).fill('取消后副本');
  await page.getByRole('button', { name: '另存为', exact: true }).click();
  await expect(page.locator('.saved-state')).toContainText('已保存到本地');
  expect(await page.evaluate(() => (window as any).__acceptance.disk['/acceptance/取消后副本.md'])).toBe(original + '取消前重试副本');
  expect(await diskContent(page)).toBe(original + '取消前');
});
