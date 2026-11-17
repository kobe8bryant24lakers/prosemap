import { expect, test, type Page } from '@playwright/test';
import { editorSource, launchDocument, mod, savedSource } from './helpers';

// Synthetic documents and model IPC only. This tests application safeguards,
// not a live model's ability to interpret natural-language editing scope.
const original = '# SYNTHETIC document\r\n\r\nKeep this introduction.  \r\n\r\n## SYNTHETIC target\r\nValue: 10 🧭\r\n\r\n## SYNTHETIC appendix\r\n| Keep | Table |\r\n| --- | --- |\r\n| A | B |\r\n\r\n```mermaid\r\nflowchart LR\r\n A-->B\r\n```\r\n\r\nKeep this ending.  \r\n';
const edits = (...items: Array<[string, string]>) => JSON.stringify({ edits: items.map(([oldText, newText]) => ({ oldText, newText })) });
const change = edits(['Value: 10 🧭', 'Value: 20 🧭']);
const normalize = (text: string) => text.replace(/\r\n?/g, '\n');

async function setup(page: Page, content = original) {
  await launchDocument(page, content, 'synthetic-edit-scope.md', 'ready', 'memory');
  await page.evaluate(() => {
    const w = window as any, invoke = w.__TAURI_INTERNALS__.invoke;
    w.__editScope = { response: '', requests: [], hold: false, release: null, error: '', done: true, lateDelivery: false };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command === 'stream_ai') {
        const state = w.__editScope;
        state.requests.push(structuredClone(args.request));
        const response = state.response;
        const middle = Math.floor(response.length / 2);
        const deliver = async () => {
          args.onEvent.onmessage({ type: 'delta', text: response.slice(0, middle) });
          if (state.hold) await new Promise<void>(resolve => { state.release = resolve; });
          args.onEvent.onmessage({ type: 'delta', text: response.slice(middle) });
          if (state.error) args.onEvent.onmessage({ type: 'error', message: state.error });
          if (state.done) args.onEvent.onmessage({ type: 'done' });
        };
        if (state.lateDelivery) state.release = deliver;
        else await deliver();
        return;
      }
      if (command === 'cancel_ai') return;
      return invoke(command, args);
    };
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('模型名称', { exact: true }).fill('SYNTHETIC_MODEL');
  await page.getByLabel('API 密钥', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
  await page.getByRole('button', { name: '安全保存', exact: true }).click();
}

async function generate(page: Page, response = change, instruction = '只把 target 章节的 Value: 10 改成 Value: 20，其他内容保持不变') {
  await page.evaluate(response => { (window as any).__editScope.response = response; }, response);
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await page.getByLabel('告诉 AI 你的要求', { exact: true }).fill(instruction);
  await page.getByRole('button', { name: '生成建议', exact: true }).click();
}

const accept = (page: Page) => page.getByRole('button', { name: '接受并替换', exact: true });

test('a short streamed edit preserves long unmentioned sections and exact saved bytes, with undo and redo', async ({ page }) => {
  const large = original.replace('Keep this introduction.', 'SYNTHETIC unchanged paragraph.  \r\n'.repeat(700));
  await setup(page, large);
  await page.evaluate(() => { (window as any).__editScope.hold = true; });
  await generate(page);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__editScope.release)).toBe('function');
  await expect(accept(page)).toBeDisabled();
  await expect(page.locator('.diff-line.removed')).toHaveCount(0);
  expect(await editorSource(page)).toBe(normalize(large));
  await page.evaluate(() => { (window as any).__editScope.release(); });
  await expect(accept(page)).toBeEnabled();
  await expect(page.locator('.diff-line.removed')).toHaveCount(1);
  await expect(page.locator('.diff-line.added')).toHaveCount(1);
  await expect(page.locator('.diff-content')).not.toContainText('oldText');
  await accept(page).click();
  expect(await savedSource(page)).toBe(large.replace('Value: 10', 'Value: 20'));
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await savedSource(page)).toBe(large);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(await savedSource(page)).toBe(large.replace('Value: 10', 'Value: 20'));
});

test('a selected duplicate is edited within the selection and outside text cannot be targeted', async ({ page }) => {
  const text = 'SYNTHETIC duplicate\nSYNTHETIC duplicate\nSYNTHETIC tail\n';
  await setup(page, text);
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+Home`);
  await page.keyboard.press('Shift+End');
  await generate(page, edits(['SYNTHETIC tail', 'UNAUTHORIZED']), '只修改选中文字');
  await expect(page.locator('.diff-error')).toContainText('无法唯一匹配原文');
  await expect(accept(page)).toBeDisabled();
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  expect(await savedSource(page)).toBe(text);
  await generate(page, edits(['SYNTHETIC duplicate', 'SYNTHETIC changed']), '只修改选中文字');
  await expect(accept(page)).toBeEnabled();
  const request = await page.evaluate(() => (window as any).__editScope.requests.at(-1));
  expect(request.prompt).toContain('用户选区');
  expect(request.prompt).not.toContain('SYNTHETIC tail');
  expect(request.history).toEqual([]);
  await accept(page).click();
  expect(await savedSource(page)).toBe('SYNTHETIC changed\nSYNTHETIC duplicate\nSYNTHETIC tail\n');
});

const failures = [
  { name: 'paragraph-only response', response: 'Value: 20 🧭', error: '局部修改格式无效' },
  { name: 'truncated JSON', response: change.slice(0, -2), error: '局部修改格式无效' },
  { name: 'reference-only anchor', response: edits(['SYNTHETIC reference text', 'Value: 20 🧭']), error: '无法唯一匹配原文' },
  { name: 'ambiguous anchor', response: edits(['SYNTHETIC', 'Changed']), error: '无法唯一匹配原文' },
  { name: 'overlapping edits', response: edits(['Value: 10 🧭', 'Value: 20 🧭'], ['10 🧭', '30']), error: '修改范围重叠' },
  { name: 'valid first edit then missing anchor', response: edits(['Value: 10 🧭', 'Value: 20 🧭'], ['Synthetic missing', 'Changed']), error: '无法唯一匹配原文' },
  { name: 'no stream completion event', response: change, done: false, error: '模型响应提前结束' },
  { name: 'output limit after syntactically valid JSON', response: change, streamError: '模型输出达到长度上限，结果不完整，请缩小修改范围后重试；原文未改动。', error: '模型输出达到长度上限' },
];
for (const failure of failures) {
  test(`${failure.name} cannot become an accepted edit or conversation turn`, async ({ page }) => {
    await setup(page);
    await page.evaluate(({ done, streamError }) => {
      Object.assign((window as any).__editScope, { done: done ?? true, error: streamError ?? '' });
    }, { done: failure.done, streamError: failure.streamError });
    await generate(page, failure.response);
    await expect(page.locator('.diff-error')).toContainText(failure.error);
    await expect(accept(page)).toBeDisabled();
    expect(await editorSource(page)).toBe(normalize(original));
    await page.getByRole('button', { name: '拒绝', exact: true }).click();
    expect(await savedSource(page)).toBe(original);
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await expect(page.locator('.ai-conversation-turns > li')).toHaveCount(0);
  });
}

test('cancelling a partial edit ignores late completion and leaves the original intact', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).__editScope.hold = true; });
  await generate(page);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__editScope.release)).toBe('function');
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await page.evaluate(() => { (window as any).__editScope.release(); });
  await expect(page.locator('.diff-error')).toContainText('生成已停止');
  await expect(accept(page)).toBeDisabled();
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  expect(await savedSource(page)).toBe(original);
});

test('a resolved native command waits for late channel delivery before allowing acceptance', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).__editScope.lateDelivery = true; });
  await generate(page);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__editScope.release)).toBe('function');
  await expect(accept(page)).toBeDisabled();
  await expect(page.locator('.diff-error')).toHaveCount(0);
  expect(await editorSource(page)).toBe(normalize(original));
  await page.evaluate(() => { (window as any).__editScope.release(); });
  await expect(accept(page)).toBeEnabled();
  await accept(page).click();
  expect(await savedSource(page)).toBe(original.replace('Value: 10', 'Value: 20'));
});

test('an empty document can be created and an explicit complete deletion has a reviewable diff', async ({ page }) => {
  await setup(page, '');
  const created = '# SYNTHETIC new document\n';
  await generate(page, edits(['', created]), '创建一篇新的测试文档');
  await expect(accept(page)).toBeEnabled();
  await accept(page).click();
  expect(await savedSource(page)).toBe(created);
  await generate(page, edits([created, '']), '删除全文');
  await expect(accept(page)).toBeEnabled();
  await expect(page.locator('.diff-line.removed')).toHaveCount(1);
  await expect(page.locator('.diff-waiting')).toHaveCount(0);
  await accept(page).click();
  expect(await savedSource(page)).toBe('');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await savedSource(page)).toBe(created);
});

test('edit validation errors retranslate without losing the draft', async ({ page }) => {
  await setup(page);
  await generate(page, 'SYNTHETIC incomplete replacement');
  await expect(page.locator('.diff-error')).toContainText('局部修改格式无效');
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await expect(page.locator('.diff-error')).toContainText('The AI returned invalid edits');
  await expect(page.getByRole('button', { name: 'Accept and replace', exact: true })).toBeDisabled();
  expect(await editorSource(page)).toBe(normalize(original));
});
