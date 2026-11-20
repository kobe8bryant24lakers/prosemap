import { expect, test, type Page } from '@playwright/test';
import { editorSource, launchDocument, mod, savedSource } from './helpers';

const original = '# Synthetic field trip\r\n\r\nDeparture is at nine.\r\n\r\nReturn is at six.\r\n';
const normalized = original.replaceAll('\r\n', '\n');

async function setup(page: Page, configureModel = true) {
  await launchDocument(page, original, 'synthetic-field-trip.md');
  await page.evaluate(() => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    const model = w.__questionModel = { requests: [] as any[], reply: '**Nine** in the morning.', hold: false, fail: false, finish: () => {} };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any) => {
      if (command === 'cancel_ai') return;
      if (command === 'pick_ai_context_files') return [{ path: '/acceptance/synthetic-reference.txt', name: 'synthetic-reference.txt', content: 'SYNTHETIC REFERENCE '.repeat(5000) + 'SYNTHETIC TAIL' }];
      if (command !== 'stream_ai') return invoke(command, args);
      const { prompt, system, history } = args.request;
      model.requests.push({ prompt, system, history });
      const finish = () => {
        if (model.fail) args.onEvent.onmessage({ type: 'error', message: 'Synthetic model unavailable' });
        else {
          args.onEvent.onmessage({ type: 'delta', text: model.reply });
          args.onEvent.onmessage({ type: 'done' });
        }
      };
      if (model.hold) {
        args.onEvent.onmessage({ type: 'delta', text: 'Synthetic partial answer ' });
        await new Promise<void>(resolve => { model.finish = () => { finish(); resolve(); }; });
      } else finish();
    };
  });
  if (configureModel) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('模型名称', { exact: true }).fill('synthetic-model');
    await page.getByLabel('API 密钥', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
    await page.getByRole('button', { name: '安全保存', exact: true }).click();
  }
  await page.getByRole('button', { name: '纯编辑', exact: true }).click();
  await page.getByRole('button', { name: 'AI 文字助手', exact: true }).click();
  await page.getByRole('button', { name: '文档问答', exact: true }).click();
}

const field = (page: Page) => page.locator('#document-question');
const requests = (page: Page) => page.evaluate(() => (window as any).__questionModel.requests);
const send = (page: Page) => page.getByRole('button', { name: '发送问题', exact: true });
const close = (page: Page) => page.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();

test('model setup keeps an English question and the answer identifies truncated references', async ({ page }) => {
  await setup(page, false);
  await page.getByLabel('界面语言', { exact: true }).selectOption('en');
  const panel = page.locator('#writing-assistant');
  await panel.getByRole('button', { name: 'Summarize', exact: true }).click();
  await expect(field(page)).toHaveValue('Summarize the main points of this document.');
  await expect(panel.getByRole('button', { name: 'Send question' })).toBeDisabled();
  expect(await requests(page)).toHaveLength(0);
  await panel.getByRole('button', { name: /Connect a model first/ }).click();
  await page.getByLabel('Model name', { exact: true }).fill('synthetic-model');
  await page.getByLabel('API key', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
  await page.getByRole('button', { name: 'Save securely', exact: true }).click();
  await panel.getByText('Reference materials', { exact: true }).click();
  await panel.getByRole('button', { name: 'Add files', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Remove context file synthetic-reference.txt' })).toBeVisible();
  await panel.getByRole('button', { name: 'Send question' }).click();
  await expect(panel.locator('.question-answer')).toHaveCount(1);
  await expect(panel.locator('.question-exchange')).toContainText('References were truncated');
  const [request] = await requests(page);
  expect(request.prompt).toContain('Summarize the main points of this document.');
  expect(request.prompt).toContain('SYNTHETIC REFERENCE');
  expect(request.prompt).not.toContain('SYNTHETIC TAIL');
  await page.getByLabel('Interface language', { exact: true }).selectOption('zh-CN');
  expect(await savedSource(page)).toBe(original);
});

test('summaries and follow-up questions read fresh document text without proposing or applying an edit', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '总结要点', exact: true }).click();
  await expect(page.locator('.question-answer strong')).toHaveText('Nine');
  const [summary] = await requests(page);
  expect(summary.prompt).toContain(normalized);
  expect(summary.prompt).toContain('请总结这篇文档的主要内容。');
  expect(summary.history).toEqual([]);
  await expect(page.locator('.diff-modal')).toHaveCount(0);
  expect(await savedSource(page)).toBe(original);

  await page.locator('.cm-content').focus();
  await page.keyboard.press(mod + '+End');
  await page.keyboard.insertText('Bring a synthetic map.');
  await field(page).fill('What should I bring?');
  await field(page).dispatchEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true });
  expect(await requests(page)).toHaveLength(1);
  await field(page).press(mod + '+Enter');
  await expect(page.locator('.question-answer')).toHaveCount(2);
  const [, followUp] = await requests(page);
  expect(followUp.prompt).toContain('Bring a synthetic map.');
  expect(followUp.history[1].content).toContain('**Nine**');
  expect(followUp.history[0].content).toContain('did not edit');
  await page.getByRole('button', { name: '编辑文档', exact: true }).click();
  await expect(page.locator('.ai-conversation-turns li')).toHaveCount(0);
  await page.getByRole('button', { name: '文档问答', exact: true }).click();
  await expect(page.locator('.question-answer')).toHaveCount(2);
  await close(page);
  await page.getByRole('button', { name: 'AI 文字助手', exact: true }).click();
  await expect(page.locator('.question-answer')).toHaveCount(2);
});

test('selection scope sends only the selected passage and a new Q&A clears its history', async ({ page }) => {
  await setup(page);
  await page.locator('.cm-content').focus();
  await page.keyboard.press(mod + '+Home');
  await page.keyboard.press('Shift+End');
  await page.getByLabel('提问范围').selectOption('selection');
  await field(page).fill('What is the title?');
  await send(page).click();
  await expect(page.locator('.question-answer')).toHaveCount(1);
  const [turn] = await requests(page);
  expect(turn.prompt).toContain('# Synthetic field trip');
  expect(turn.prompt).not.toContain('Departure');
  await page.getByRole('button', { name: '新问答', exact: true }).click();
  await expect(page.locator('.question-exchange')).toHaveCount(0);
  await expect(page.getByLabel('提问范围')).toHaveValue('document');
  await page.getByRole('button', { name: '总结要点', exact: true }).click();
  await expect(page.locator('.question-answer')).toHaveCount(1);
  expect((await requests(page))[1].history).toEqual([]);
  expect(await savedSource(page)).toBe(original);
});

test('stop, retry and late delivery stay isolated from other files and editing suggestions', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).__questionModel.hold = true; });
  await field(page).fill('When do we leave?');
  await send(page).click();
  await expect(page.locator('.question-stream')).toContainText('partial answer');
  await page.getByRole('button', { name: '停止回答', exact: true }).click();
  await page.evaluate(() => {
    const m = (window as any).__questionModel; m.finish(); m.hold = false; m.fail = true;
  });
  await expect(page.getByText('回答已停止。')).toBeVisible();
  await page.getByRole('button', { name: '重新提问', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic model unavailable');
  await page.evaluate(() => { (window as any).__questionModel.fail = false; });
  await page.getByRole('button', { name: '重新提问', exact: true }).click();
  await expect(page.locator('.question-answer')).toHaveCount(1);
  expect((await requests(page))[2].history).toEqual([]);
  await page.evaluate(() => { (window as any).__questionModel.hold = true; });
  await field(page).fill('And the return?');
  await send(page).click();
  await expect(page.locator('.question-stream')).toBeVisible();
  await page.evaluate(() => {
    (window as any).__acceptance.nextFile = { path: '/acceptance/synthetic-next.md', name: 'synthetic-next.md', content: '# Synthetic second document' };
  });
  await page.getByRole('button', { name: '打开文件', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档名称' })).toHaveValue('synthetic-next');
  await page.evaluate(() => { (window as any).__questionModel.finish(); });
  await expect(page.locator('.question-exchange, .diff-modal')).toHaveCount(0);
  await expect(field(page)).toHaveValue('');
  expect(await editorSource(page)).toBe('# Synthetic second document');
});
