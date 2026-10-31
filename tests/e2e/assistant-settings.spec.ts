import { test, expect, type Page } from '@playwright/test';
import { launchDocument, mod, savedSource } from './helpers';

// Synthetic credentials and an IPC boundary only: no keychain or external AI requests.
async function boundary(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__assistantAcceptance = { profiles: null, saveError: '', switchError: '', response: '建议中文🧭', pending: false, finish: null, cancelCount: 0, requests: [], context: [] };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      const a = w.__assistantAcceptance;
      if (command === 'save_model_profiles') {
        if (a.saveError) throw a.saveError;
        a.profiles = args.settings;
        return 'system';
      }
      if (command === 'select_model_profile') {
        if (a.switchError) throw a.switchError;
        a.profiles.activeId = args.id;
        return;
      }
      if (command === 'pick_ai_context_files') return a.context;
      if (command === 'cancel_ai') { a.cancelCount++; return; }
      if (command === 'stream_ai') {
        a.requests.push(args.request);
        const send = () => {
          if (a.error) throw a.error;
          args.onEvent.onmessage({ type: 'reasoning_delta', text: '测试服务提供的说明' });
          args.onEvent.onmessage({ type: 'delta', text: a.response });
          args.onEvent.onmessage({ type: 'done' });
        };
        if (a.pending) return new Promise<void>((resolve, reject) => { a.finish = () => { try { send(); resolve(); } catch (e) { reject(e); } }; });
        send(); return;
      }
      return invoke(command, args);
    };
  });
}
async function configure(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '模型连接', exact: true });
  await dialog.getByLabel('配置名称', { exact: true }).fill('验收模型');
  await dialog.getByLabel('API 地址', { exact: true }).fill('http://127.0.0.1:1/v1');
  await dialog.getByLabel('模型名称', { exact: true }).fill('synthetic-model');
  await dialog.getByLabel('API 密钥', { exact: true }).fill('acceptance-placeholder-no-real-credential');
  return dialog;
}
async function ready(page: Page, original = '# 原文\n\n保持内容\n') {
  await launchDocument(page, original);
  await boundary(page);
  const dialog = await configure(page);
  await dialog.getByRole('button', { name: '安全保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function generate(page: Page) {
  await page.getByRole('button', { name: 'AI 文字助手', exact: true }).click();
  await page.getByRole('button', { name: '生成建议', exact: true }).click();
  await expect(page.locator('.diff-modal')).toBeVisible();
}

test('settings: required validation, endpoint rejection, provider reset, show/hide and cancel isolation', async ({ page }) => {
  await launchDocument(page, '# 配置取消不改文档\n');
  await boundary(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '模型连接', exact: true });
  await expect(dialog.getByRole('button', { name: '安全保存', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  dialog = await configure(page);
  const save = dialog.getByRole('button', { name: '安全保存', exact: true });
  for (const invalid of ['file:///tmp', 'https://user:password@example.test/v1', 'https://example.test/v1?key=x', 'http://localhost:0']) {
    await dialog.getByLabel('API 地址', { exact: true }).fill(invalid);
    await expect(save).toBeDisabled();
  }
  await dialog.getByLabel('API 地址', { exact: true }).fill('http://127.0.0.1:1/v1');
  await expect(save).toBeEnabled();
  await expect(dialog.getByLabel('API 密钥', { exact: true })).toHaveAttribute('type', 'password');
  await dialog.getByRole('button', { name: '显示密钥', exact: true }).click();
  await expect(dialog.getByLabel('API 密钥', { exact: true })).toHaveAttribute('type', 'text');
  await dialog.getByRole('button', { name: '隐藏密钥', exact: true }).click();
  await dialog.getByRole('button', { name: /Anthropic Claude/ }).click();
  await expect(dialog.getByLabel('API 地址', { exact: true })).toHaveValue('https://api.anthropic.com/v1');
  await expect(dialog.getByLabel('模型名称', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('API 密钥', { exact: true })).toHaveValue('');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).__assistantAcceptance.profiles)).toBeNull();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('模型名称', { exact: true })).toHaveValue('');
  await page.keyboard.press('Escape');
  expect(await savedSource(page)).toBe('# 配置取消不改文档\n');
});

test('settings: save failure preserves draft, retry commits and later cancel does not mutate saved profile', async ({ page }) => {
  await launchDocument(page, '# 设置失败\n');
  await boundary(page);
  const dialog = await configure(page);
  await page.evaluate(() => { (window as any).__assistantAcceptance.saveError = '测试：安全存储写入失败'; });
  await dialog.getByRole('button', { name: '安全保存', exact: true }).click();
  await expect(page.getByText('测试：安全存储写入失败', { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('模型名称', { exact: true })).toHaveValue('synthetic-model');
  await page.evaluate(() => { (window as any).__assistantAcceptance.saveError = ''; });
  await dialog.getByRole('button', { name: '安全保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('模型名称', { exact: true }).fill('不应保存');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('模型名称', { exact: true })).toHaveValue('synthetic-model');
});

test('assistant: missing model and custom instruction disable generation; a new action starts with an empty draft', async ({ page }) => {
  await launchDocument(page, '原文');
  await boundary(page);
  await page.getByRole('button', { name: 'AI 文字助手', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成建议', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
  const dialog = await configure(page);
  await dialog.getByRole('button', { name: '安全保存', exact: true }).click();
  await page.getByRole('button', { name: 'AI 文字助手', exact: true }).click();
  await page.getByRole('button', { name: /自定义指令 按你的/ }).click();
  await expect(page.getByRole('button', { name: '生成建议', exact: true })).toBeDisabled();
  await page.getByLabel('告诉 AI 你的要求', { exact: true }).fill('  ');
  await expect(page.getByRole('button', { name: '生成建议', exact: true })).toBeDisabled();
  await page.getByLabel('告诉 AI 你的要求', { exact: true }).fill('保留原意');
  await expect(page.getByRole('button', { name: '生成建议', exact: true })).toBeEnabled();
  await page.locator('.assistant-panel').getByRole('button', { name: /Mermaid 智能绘图 用自然/ }).click();
  await expect(page.getByLabel('告诉 AI 你的要求', { exact: true })).toHaveValue('');
});

test('diff: reject keeps bytes; accepting CRLF suggestion replaces only selection and one undo restores document', async ({ page }) => {
  const original = '# 标题\r\n\r\n原文\r\n尾文';
  await ready(page, original);
  await page.evaluate(() => { (window as any).__assistantAcceptance.response = '建议第一行\r\n建议第二行'; });
  await generate(page);
  await expect(page.getByRole('button', { name: '接受并替换', exact: true })).toBeEnabled();
  await expect(page.locator('.reasoning-content')).toContainText('测试服务提供的说明');
  await page.getByRole('button', { name: /AI 思考过程/ }).click();
  await expect(page.locator('.reasoning-content')).toHaveCount(0);
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  expect(await savedSource(page)).toBe(original);
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+Home`);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await generate(page);
  await page.getByRole('button', { name: '接受并替换', exact: true }).click();
  expect(await savedSource(page)).toBe(original.replace('原文', '建议第一行\r\n建议第二行'));
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await savedSource(page)).toBe(original);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(await savedSource(page)).toBe(original.replace('原文', '建议第一行\r\n建议第二行'));
});

for (const response of ['', '   \n\t', 'failure']) {
  test(`diff: ${response || 'empty'} response cannot apply and next request recovers`, async ({ page }) => {
    await ready(page);
    await page.evaluate((response) => { const a = (window as any).__assistantAcceptance; a.response = response === 'failure' ? '' : response; a.error = response === 'failure' ? '测试：模型连接失败' : ''; }, response);
    await generate(page);
    await expect(page.locator('.diff-error')).toContainText(response === 'failure' ? '测试：模型连接失败' : '模型返回了空内容');
    await expect(page.getByRole('button', { name: '接受并替换', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '拒绝', exact: true }).click();
    expect(await savedSource(page)).toBe('# 原文\n\n保持内容\n');
    await page.evaluate(() => { const a = (window as any).__assistantAcceptance; a.error = ''; a.response = '恢复后的建议'; });
    await generate(page);
    await expect(page.getByRole('button', { name: '接受并替换', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '接受并替换', exact: true }).click();
    expect(await savedSource(page)).toBe('恢复后的建议');
  });
}

test('diff: stop, reject and late completion never apply partial or stale content', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { (window as any).__assistantAcceptance.pending = true; });
  await generate(page);
  await expect(page.getByRole('button', { name: '接受并替换', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await expect(page.locator('.diff-error')).toContainText('生成已停止');
  await expect(page.getByRole('button', { name: '接受并替换', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await page.evaluate(() => (window as any).__assistantAcceptance.finish());
  await expect(page.locator('.diff-modal')).toHaveCount(0);
  expect(await savedSource(page)).toBe('# 原文\n\n保持内容\n');
  expect(await page.evaluate(() => (window as any).__assistantAcceptance.cancelCount)).toBeGreaterThan(0);
});

test('diff: separated changes preserve every intervening mixed line ending and one undo restores all', async ({ page }) => {
  const original = 'first\r\nmiddle\nthird\rend\r\n';
  await ready(page, original);
  await page.evaluate(() => { (window as any).__assistantAcceptance.response = 'FIRST\nmiddle\nTHIRD\nend\n'; });
  await generate(page);
  await page.getByRole('button', { name: '接受并替换', exact: true }).click();
  // Unedited endings, including the final newline, remain exact.
  expect(await savedSource(page)).toBe('FIRST\r\nmiddle\nTHIRD\rend\r\n');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await savedSource(page)).toBe(original);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(await savedSource(page)).toBe('FIRST\r\nmiddle\nTHIRD\rend\r\n');
});

test('diff: accepting a complete suggestion preserves boundary indentation, blank lines and hard breaks through undo/redo', async ({ page }) => {
  const original = '\n    original code\n\nparagraph  \nnext line\n\n';
  const modified = original.replace('original', 'updated');
  await ready(page, original);
  await page.evaluate(response => { (window as any).__assistantAcceptance.response = response; }, modified);
  await generate(page);
  await expect(page.getByRole('button', { name: '接受并替换', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '接受并替换', exact: true }).click();
  expect(await savedSource(page)).toBe(modified);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await savedSource(page)).toBe(original);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(await savedSource(page)).toBe(modified);
});
