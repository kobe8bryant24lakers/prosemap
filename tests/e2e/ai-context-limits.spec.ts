import { test, expect, type Page } from '@playwright/test';
import { launchDocument } from './helpers';

const original = '# Synthetic context document\n\nSYNTHETIC BODY\n';
function contexts(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    path: '/synthetic-context/context-' + (index + 1) + '.txt',
    name: 'synthetic-context-' + (index + 1) + '.txt',
    content: 'SYNTHETIC CONTEXT ' + (index + 1),
  }));
}
async function openContextPanel(page: Page) {
  await launchDocument(page, original, 'synthetic-contexts.md', 'ready', 'memory');
  await page.evaluate(() => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__contextAcceptance = { incoming: [], error: '', requests: [], pending: false, release: null, pickCalls: 0 };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      const state = w.__contextAcceptance;
      if (command === 'pick_ai_context_files') {
        state.pickCalls++;
        const { incoming, error } = state;
        if (state.pending) return new Promise((resolve, reject) => {
          state.release = () => { if (error) reject(error); else resolve(incoming); };
        });
        if (error) throw error;
        return incoming;
      }
      if (command === 'stream_ai') {
        state.requests.push(args.request);
        args.onEvent.onmessage({ type: 'delta', text: 'SYNTHETIC RESPONSE\n' });
        args.onEvent.onmessage({ type: 'done' });
        return;
      }
      return invoke(command, args);
    };
  });
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog');
  await settings.getByLabel('Model name', { exact: true }).fill('synthetic-model');
  await settings.getByLabel('API key', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
  await settings.getByRole('button', { name: 'Save securely', exact: true }).click();
  await page.getByRole('button', { name: 'AI writing assistant', exact: true }).click();
  return page.locator('.assistant-panel');
}
async function pick(page: Page, incoming: ReturnType<typeof contexts>, error = '') {
  const before = await page.evaluate(({ incoming, error }) => {
    const state = (window as any).__contextAcceptance;
    Object.assign(state, { incoming, error });
    return state.pickCalls;
  }, { incoming, error });
  await page.locator('.assistant-context-files').getByRole('button', { name: 'Add files', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__contextAcceptance.pickCalls)).toBe(before + 1);
  // Do not replace the next mock selection before the current IPC call takes it.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function requestPrompt(page: Page) {
  await page.getByRole('button', { name: 'Generate suggestion', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept and replace', exact: true })).toBeEnabled();
  const prompt = await page.evaluate<string>(() => (window as any).__contextAcceptance.requests.at(-1).prompt);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.getByRole('button', { name: 'AI writing assistant', exact: true }).click();
  return prompt;
}
async function expectDocumentUnchanged(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__acceptance.saved.at(-1)?.content)).toBe(original);
}

test('context selection rejects overflow atomically and keeps existing reference content', async ({ page }) => {
  const panel = await openContextPanel(page);
  const initial = contexts(12);
  await pick(page, initial);
  await expect(panel.locator('.assistant-context-list > div')).toHaveCount(12);
  const before = await panel.locator('.assistant-context-list').textContent();
  const updated = { ...initial[0], content: 'SYNTHETIC UPDATED FIRST THAT MUST NOT BE APPLIED' };
  await pick(page, [updated, contexts(13)[12]]);
  await expect(page.locator('.toast.error')).toHaveText('Keep up to 12 context files. Remove existing files before adding more.', { timeout: 1000 });
  await expect(panel.locator('.assistant-context-list')).toHaveText(before!);
  const prompt = await requestPrompt(page);
  expect(prompt).toContain(initial[0].content);
  expect(prompt).not.toContain(updated.content);
  expect(prompt).not.toContain(contexts(13)[12].content);
  await expectDocumentUnchanged(page);
});

test('context selection allows duplicate updates at capacity and recovers after removal', async ({ page }) => {
  const panel = await openContextPanel(page);
  const initial = contexts(12);
  await pick(page, initial);
  const updated = { ...initial[0], content: 'SYNTHETIC UPDATED FIRST' };
  await pick(page, [updated, updated]);
  await expect(page.locator('.toast.success')).toHaveText('Context files updated');
  await expect(panel.locator('.assistant-context-list > div')).toHaveCount(12);
  expect(await requestPrompt(page)).toContain(updated.content);
  await pick(page, [contexts(13)[12]]);
  await expect(page.locator('.toast.error')).toBeVisible({ timeout: 1000 });
  await panel.getByRole('button', { name: 'Remove context file synthetic-context-2.txt', exact: true }).click();
  await pick(page, [contexts(13)[12]]);
  await expect(page.locator('.toast.success')).toHaveText('Context files updated');
  await expect(panel.locator('.assistant-context-list > div')).toHaveCount(12);
  const prompt = await requestPrompt(page);
  expect(prompt).toContain(updated.content);
  expect(prompt).toContain(contexts(13)[12].content);
  expect(prompt).not.toContain('<reference_file index="2" name="synthetic-context-2.txt">');
  await expectDocumentUnchanged(page);
});

test('context native string errors keep their precise localized reason and existing list', async ({ page }) => {
  const panel = await openContextPanel(page);
  await pick(page, contexts(12));
  const before = await panel.locator('.assistant-context-list').textContent();
  for (const [native, translated] of [
    ['一次最多选择 12 个上下文文件', 'Select up to 12 context files at once'],
    ['上下文文件必须使用 UTF-8 编码', 'Context files must use UTF-8 encoding'],
    ['上下文仅支持常见文本、资料与代码文件', 'Context supports common text, reference, and code files'],
    ['上下文文件 synthetic-large.txt 不能超过 2 MB', 'Context file synthetic-large.txt must be no larger than 2 MB'],
  ]) {
    await pick(page, [], native);
    await expect(page.locator('.toast.error')).toHaveText(translated, { timeout: 1000 });
    await expect(page.locator('.toast.error')).not.toContainText('/synthetic-context/');
    await expect(panel.locator('.assistant-context-list')).toHaveText(before!);
  }
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  await expect(page.locator('.toast.error')).toHaveText('上下文文件 synthetic-large.txt 不能超过 2 MB');
});

test('cancelling context selection preserves the list and request content', async ({ page }) => {
  const panel = await openContextPanel(page);
  await pick(page, contexts(2));
  const before = await panel.locator('.assistant-context-list').textContent();
  await pick(page, []);
  await expect(panel.locator('.assistant-context-list')).toHaveText(before!);
  const prompt = await requestPrompt(page);
  for (const document of contexts(2)) expect(prompt).toContain(document.content);
  await expectDocumentUnchanged(page);
});

test('a pending context selection merges with the latest removals', async ({ page }) => {
  const panel = await openContextPanel(page);
  await pick(page, contexts(12));
  await page.evaluate(() => { (window as any).__contextAcceptance.pending = true; });
  await pick(page, [contexts(13)[12]]);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__contextAcceptance.release)).toBe('function');
  await panel.getByRole('button', { name: 'Remove context file synthetic-context-2.txt', exact: true }).click();
  await page.evaluate(() => { (window as any).__contextAcceptance.release(); });
  await expect(panel.locator('.assistant-context-list > div')).toHaveCount(12);
  await expect(panel.locator('.assistant-context-list')).toContainText('synthetic-context-13.txt');
  await expect(panel.locator('.assistant-context-list')).not.toContainText('synthetic-context-2.txt');
  await expectDocumentUnchanged(page);
});

for (const selectionError of ['', '一次最多选择 12 个上下文文件']) {
  test('a pending context selection cannot change a later document' + (selectionError ? ' or show a stale error' : ''), async ({ page }) => {
    const panel = await openContextPanel(page);
    await pick(page, contexts(1));
    await page.evaluate(() => { (window as any).__contextAcceptance.pending = true; });
    await pick(page, [contexts(2)[1]], selectionError);
    await expect.poll(() => page.evaluate(() => typeof (window as any).__contextAcceptance.release)).toBe('function');
    const nextContent = '# Synthetic next document\n';
    await page.evaluate((content) => {
      const state = (window as any).__acceptance;
      state.nextFile = { path: '/acceptance/synthetic-next.md', name: 'synthetic-next.md', content };
      state.disk[state.nextFile.path] = content;
    }, nextContent);
    await page.getByRole('button', { name: 'Open file', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Document name', exact: true })).toHaveValue('synthetic-next');
    await expect(panel.locator('.assistant-context-list')).toHaveCount(0, { timeout: 1000 });
    await page.evaluate(async () => {
      (window as any).__contextAcceptance.release();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await expect(panel.locator('.assistant-context-list')).toHaveCount(0, { timeout: 1000 });
    await expect(page.locator('.toast')).toHaveText('Opened synthetic-next.md', { timeout: 1000 });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__acceptance.saved.at(-1)?.content)).toBe(nextContent);
  });
}
