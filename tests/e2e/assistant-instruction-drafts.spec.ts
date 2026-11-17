import { test, expect, type Page } from '@playwright/test';
import { launchDocument, mod, savedSource } from './helpers';

// Synthetic documents and an IPC boundary only; no credentials or network service.
const original = 'SYNTHETIC TARGET A\nSYNTHETIC TARGET B\n';
const actions = [
  { id: 'polish', label: '润色表达', entry: '润色' },
  { id: 'continue', label: '智能续写', entry: '续写' },
  { id: 'summarize', label: '提炼总结', entry: '总结' },
  { id: 'custom', label: '自定义指令', entry: 'AI 助手' },
  { id: 'mermaid', label: 'Mermaid 智能绘图', entry: 'Mermaid 智能绘图' },
] as const;
type Action = typeof actions[number];
const panel = (page: Page) => page.locator('.assistant-panel');
const instruction = (page: Page) => panel(page).locator('#ai-instruction');
const draft = (action: Action) => '  SYNTHETIC ' + action.id + ' REQUIREMENT\nKeep exact spacing.  ';

async function ready(page: Page) {
  await launchDocument(page, original, 'synthetic-instruction-a.md', 'ready', 'memory');
  await page.evaluate(() => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__instructionAcceptance = { error: '', requests: [] };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command === 'stream_ai') {
        const state = w.__instructionAcceptance;
        state.requests.push(args.request);
        if (state.error) throw state.error;
        const oldText = args.request.prompt.split('待处理 Markdown：\n')[1];
        args.onEvent.onmessage({ type: 'delta', text: JSON.stringify({ edits: [{ oldText, newText: 'SYNTHETIC SUGGESTION' }] }) });
        args.onEvent.onmessage({ type: 'done' });
        return;
      }
      return invoke(command, args);
    };
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog');
  await settings.getByLabel('模型名称', { exact: true }).fill('synthetic-model');
  await settings.getByLabel('API 密钥', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
  await settings.getByRole('button', { name: '安全保存', exact: true }).click();
}

async function choose(page: Page, action: Action) {
  await panel(page).getByRole('button', { name: new RegExp('^' + action.label) }).click();
  await expect(panel(page).locator('.compose-context')).toContainText(action.label);
}

async function openAction(page: Page, action: Action) {
  // Each entry explicitly names its action; the general writing rail selects polish.
  await page.getByRole('button', { name: action.entry, exact: true }).click();
  await expect(panel(page).locator('.compose-context')).toContainText(action.label);
}

async function nextDocument(page: Page, name = 'synthetic-instruction-b.md', content = 'SYNTHETIC DOCUMENT B\n') {
  await page.evaluate(({ name, content }) => {
    const state = (window as any).__acceptance;
    state.nextFile = { path: '/acceptance/' + name, name, content };
    state.disk[state.nextFile.path] = content;
  }, { name, content });
  await page.getByRole('button', { name: '打开文件', exact: true }).click();
}

async function selectLine(page: Page, index: number) {
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press('ArrowLeft');
  const lines = original.split('\n');
  const offset = lines.slice(0, index).reduce((length, line) => length + line.length + 1, 0);
  for (let position = 0; position < offset; position++) await page.keyboard.press('ArrowRight');
  for (let position = 0; position < lines[index].length; position++) await page.keyboard.press('Shift+ArrowRight');
}

test('each assistant action keeps an independent exact instruction draft', async ({ page }) => {
  await ready(page);
  await openAction(page, actions[0]);
  for (const action of actions) {
    await choose(page, action);
    await expect(instruction(page)).toHaveValue('');
    await instruction(page).fill(draft(action));
  }
  for (const action of actions) {
    await choose(page, action);
    await expect.soft(instruction(page), action.id + ' draft after switching back').toHaveValue(draft(action), { timeout: 1000 });
  }
  expect(await savedSource(page)).toBe(original);
});

test('clicking the current action does not erase its instruction', async ({ page }) => {
  await ready(page);
  await openAction(page, actions[3]);
  await instruction(page).fill(draft(actions[3]));
  await choose(page, actions[3]);
  await expect(instruction(page)).toHaveValue(draft(actions[3]), { timeout: 1000 });
});

test('closing and reopening each explicit action preserves its instruction', async ({ page }) => {
  await ready(page);
  for (const action of actions) {
    await openAction(page, action);
    await instruction(page).fill(draft(action));
    await panel(page).getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
    await expect(panel(page)).toHaveCount(0);
    await openAction(page, action);
    await expect.soft(instruction(page), action.id + ' draft after reopening').toHaveValue(draft(action), { timeout: 1000 });
    await panel(page).getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
  }
  expect(await savedSource(page)).toBe(original);
});

for (const outcome of ['error', 'ready'] as const) {
  test(outcome + ' suggestion rejection retains requirements and retry uses the current selection', async ({ page }) => {
    await ready(page);
    await selectLine(page, 0);
    await openAction(page, actions[3]);
    await expect(panel(page).locator('.compose-context')).toContainText('已选中 18 个字符');
    const first = 'SYNTHETIC FIRST REQUIREMENT';
    const revised = 'SYNTHETIC REVISED REQUIREMENT';
    await instruction(page).fill(first);
    await page.evaluate((outcome) => { (window as any).__instructionAcceptance.error = outcome === 'error' ? 'SYNTHETIC REQUEST FAILURE' : ''; }, outcome);
    await panel(page).getByRole('button', { name: '生成建议', exact: true }).click();
    if (outcome === 'error') await expect(page.locator('.diff-error')).toHaveText('SYNTHETIC REQUEST FAILURE');
    else await expect(page.getByRole('button', { name: '接受并替换', exact: true })).toBeEnabled();
    const firstPrompt = await page.evaluate<string>(() => (window as any).__instructionAcceptance.requests[0].prompt);
    expect(firstPrompt).toContain(first);
    expect(firstPrompt).toContain('待处理 Markdown：\nSYNTHETIC TARGET A');
    expect(firstPrompt).not.toContain('SYNTHETIC TARGET B');
    await page.getByRole('button', { name: '拒绝', exact: true }).click();
    expect(await savedSource(page)).toBe(original);
    await selectLine(page, 1);
    await openAction(page, actions[3]);
    await expect(panel(page).locator('.compose-context')).toContainText('已选中 18 个字符');
    await expect(instruction(page)).toHaveValue(first, { timeout: 1000 });
    await instruction(page).fill(revised);
    await page.evaluate(() => { (window as any).__instructionAcceptance.error = ''; });
    await panel(page).getByRole('button', { name: '生成建议', exact: true }).click();
    await expect(page.getByRole('button', { name: '接受并替换', exact: true })).toBeEnabled();
    const retryPrompt = await page.evaluate<string>(() => (window as any).__instructionAcceptance.requests.at(-1).prompt);
    expect(retryPrompt).toContain(revised);
    expect(retryPrompt).not.toContain(first);
    expect(retryPrompt).toContain('待处理 Markdown：\nSYNTHETIC TARGET B');
    expect(retryPrompt).not.toContain('SYNTHETIC TARGET A');
    await page.getByRole('button', { name: '接受并替换', exact: true }).click();
    expect(await savedSource(page)).toBe('SYNTHETIC TARGET A\nSYNTHETIC SUGGESTION\n');
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(await savedSource(page)).toBe(original);
  });
}

test('a confirmed document replacement clears every action draft and does not resurrect the previous session', async ({ page }) => {
  await ready(page);
  await openAction(page, actions[0]);
  for (const action of actions) {
    await choose(page, action);
    await instruction(page).fill(draft(action));
  }
  await nextDocument(page);
  await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('synthetic-instruction-b');
  // Check the still-mounted action before another action click could clear it.
  await expect.soft(instruction(page)).toHaveValue('', { timeout: 1000 });
  for (const action of actions) {
    await choose(page, action);
    await expect(instruction(page)).toHaveValue('');
  }
  await nextDocument(page, 'synthetic-instruction-a.md', original);
  await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('synthetic-instruction-a');
  for (const action of actions) {
    await choose(page, action);
    await expect(instruction(page)).toHaveValue('');
  }
});

test('cancelling a dirty document replacement retains the current instruction draft', async ({ page }) => {
  await ready(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText('SYNTHETIC UNSAVED DOCUMENT\n');
  await expect(page.locator('.saved-state')).toContainText('未保存');
  await openAction(page, actions[3]);
  await instruction(page).fill(draft(actions[3]));
  await nextDocument(page);
  const confirmation = page.getByRole('alertdialog', { name: '放弃未保存的修改？', exact: true });
  await expect(confirmation).toBeVisible({ timeout: 1000 });
  await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('synthetic-instruction-a');
  await expect(instruction(page)).toHaveValue(draft(actions[3]));
  // The next confirmed replacement clears the same still-mounted action.
  await nextDocument(page);
  await expect(confirmation).toBeVisible({ timeout: 1000 });
  await confirmation.getByRole('button', { name: '放弃并打开', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('synthetic-instruction-b');
  await expect(instruction(page)).toHaveValue('', { timeout: 1000 });
  expect(await savedSource(page)).toBe('SYNTHETIC DOCUMENT B\n');
});

for (const entry of ['rail', 'shortcut'] as const) {
  test('drawing ' + entry + ' selects its own draft without importing writing requirements', async ({ page }) => {
    await ready(page);
    await openAction(page, actions[3]);
    await instruction(page).fill(draft(actions[3]));
    if (entry === 'rail') await openAction(page, actions[4]);
    else {
      await page.locator('.cm-content').focus();
      await page.keyboard.press(`${mod}+Shift+m`);
      await expect(panel(page).locator('.compose-context')).toContainText(actions[4].label);
    }
    await expect(instruction(page)).toHaveValue('', { timeout: 1000 });
    await expect(panel(page).getByRole('button', { name: '生成建议', exact: true })).toBeDisabled();
    await instruction(page).fill(draft(actions[4]));
    await openAction(page, actions[3]);
    await expect(instruction(page)).toHaveValue(draft(actions[3]));
    await openAction(page, actions[4]);
    await expect(instruction(page)).toHaveValue(draft(actions[4]));
    expect(await savedSource(page)).toBe(original);
  });
}
