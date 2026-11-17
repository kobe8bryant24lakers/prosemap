import { expect, test, type Page } from '@playwright/test';
import { editorSource, launchDocument } from './helpers';

// Synthetic content and mocked model IPC only. These cases verify orchestration,
// budgets and editor integrity, not the semantic quality of a live model summary.
const original = '# SYNTHETIC compression document\n\nSYNTHETIC current document is authoritative.\n';
const applied = '# SYNTHETIC accepted version\n\nKeep the SYNTHETIC approval requirement.\n';
const oversized = '# SYNTHETIC long proposal\n\n' + 'SYNTHETIC pending detail. '.repeat(1_000);
const summaryOne = 'SYNTHETIC MEMORY ONE: Preserve approval requirements. An accepted version exists; the long alternative was rejected.';
const summaryTwo = 'SYNTHETIC MEMORY TWO: Preserve approval requirements and the later requested sequence. Pending outputs are not current document content.';
const compactMarker = 'PROSEMAP_CONVERSATION_COMPACTION';

async function setup(page: Page, content = original) {
  await launchDocument(page, content, 'synthetic-compaction.md', 'ready', 'memory');
  await page.evaluate(marker => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__documentCompaction = {
      edits: [], compressions: [], calls: [], cancellations: [],
      response: '# SYNTHETIC result\n', summary: '', summaryError: '',
      pauseSummary: false, releaseSummary: null, completedSummaries: 0,
      references: [],
    };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      const state = w.__documentCompaction;
      if (command === 'pick_ai_context_files') return structuredClone(state.references);
      if (command === 'cancel_ai') { state.cancellations.push(args.requestId); return; }
      if (command === 'stream_ai') {
        const compression = args.request.system.includes(marker);
        const request = structuredClone(args.request);
        state.calls.push({ kind: compression ? 'compression' : 'edit', request });
        (compression ? state.compressions : state.edits).push(request);
        const text = compression ? state.summary : state.response;
        const error = compression ? state.summaryError : '';
        if (compression && state.pauseSummary) await new Promise<void>(resolve => { state.releaseSummary = resolve; });
        if (compression) state.completedSummaries++;
        if (error) throw error;
        args.onEvent.onmessage({ type: 'delta', text });
        args.onEvent.onmessage({ type: 'done' });
        return;
      }
      return invoke(command, args);
    };
  }, compactMarker);
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog');
  await settings.getByLabel('API endpoint', { exact: true }).fill('http://127.0.0.1:1/v1');
  await settings.getByLabel('Model name', { exact: true }).fill('synthetic-model');
  await settings.getByLabel('API key', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
  await settings.getByRole('button', { name: 'Save securely', exact: true }).click();
  await openAssistant(page);
}

async function openAssistant(page: Page) {
  await page.getByRole('button', { name: 'AI writing assistant', exact: true }).click();
  await expect(page.locator('.assistant-panel')).toBeVisible();
}

async function generate(page: Page, instruction: string, response = '# SYNTHETIC follow-up result\n') {
  const oldText = await editorSource(page);
  await page.evaluate(response => { (window as any).__documentCompaction.response = response; }, JSON.stringify({ edits: [{ oldText, newText: response }] }));
  await page.locator('.assistant-action').filter({ hasText: 'Custom instruction' }).click();
  await page.getByLabel('Tell AI what you need', { exact: true }).fill(instruction);
  await page.getByRole('button', { name: 'Generate suggestion', exact: true }).click();
}

async function ready(page: Page) {
  await expect(page.getByRole('button', { name: 'Accept and replace', exact: true })).toBeEnabled();
}

async function continueConversation(page: Page) {
  await ready(page);
  await page.getByRole('button', { name: 'Continue conversation', exact: true }).click();
  await expect(page.locator('.assistant-panel')).toBeVisible();
}

async function editRequest(page: Page, index: number) {
  return page.evaluate(index => (window as any).__documentCompaction.edits[index], index);
}

async function summaryRequest(page: Page, index: number) {
  return page.evaluate(index => (window as any).__documentCompaction.compressions[index], index);
}

async function prepareLargeHistory(page: Page) {
  await setup(page);
  await generate(page, 'SYNTHETIC keep all approval constraints in later edits', oversized);
  await continueConversation(page);
  await expect(page.locator('.ai-conversation-turns > li')).toHaveCount(1);
}

test('document compression preserves application state, accumulates memory and clears it for a new conversation', async ({ page, browserName }) => {
  await setup(page);
  await generate(page, 'SYNTHETIC accepted approval requirement', applied);
  await ready(page);
  await page.getByRole('button', { name: 'Accept and replace', exact: true }).click();
  expect(await editorSource(page)).toBe(applied);
  await openAssistant(page);
  await generate(page, 'SYNTHETIC rejected long alternative', oversized);
  await ready(page);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await openAssistant(page);
  await page.evaluate(summary => { (window as any).__documentCompaction.summary = summary; }, summaryOne);
  await generate(page, 'SYNTHETIC follow-up preserving confirmed requirements');
  await continueConversation(page);

  const summary = await summaryRequest(page, 0);
  expect(summary.system).toContain(compactMarker);
  expect(summary.prompt).toContain('SYNTHETIC accepted approval requirement');
  expect(summary.prompt).toContain('SYNTHETIC rejected long alternative');
  expect(summary.prompt).toContain('applied');
  expect(summary.prompt).toContain('discarded');
  const request = await editRequest(page, 2);
  expect(request.history[0].content).toContain('[Compressed conversation memory]');
  expect(request.history[1].content).toBe(summaryOne);
  expect(request.history.some((message: any) => message.content === oversized)).toBe(false);
  expect(request.prompt).toContain(applied);
  expect(await editorSource(page)).toBe(applied);
  await expect(page.locator('.ai-conversation-memory')).toContainText(summaryOne);
  await expect(page.locator('.ai-conversation-turns > li')).toHaveCount(1);
  await page.locator('.ai-conversation-memory summary').click();
  await page.locator('.ai-conversation').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `outputs/document-compaction-${browserName}.png` });

  await generate(page, 'SYNTHETIC later requested sequence', oversized);
  await continueConversation(page);
  await page.evaluate(summary => { (window as any).__documentCompaction.summary = summary; }, summaryTwo);
  await generate(page, 'SYNTHETIC retain earlier decisions through another compression');
  await continueConversation(page);
  const accumulated = await summaryRequest(page, 1);
  expect(accumulated.prompt).toContain(summaryOne);
  expect(accumulated.prompt).toContain('SYNTHETIC later requested sequence');
  expect((await editRequest(page, 4)).history[1].content).toBe(summaryTwo);
  await expect(page.locator('.ai-conversation-memory')).toContainText(summaryTwo);
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(page.locator('.ai-conversation-memory')).toHaveCount(0);
  await expect(page.locator('.ai-conversation-turns > li')).toHaveCount(0);
  await generate(page, 'SYNTHETIC clean conversation');
  await ready(page);
  expect((await editRequest(page, 5)).history).toEqual([]);
  expect(await page.evaluate(() => (window as any).__documentCompaction.compressions.length)).toBe(2);
  expect(await editorSource(page)).toBe(applied);
});

test('failed or empty summaries stop generation without losing original conversation and can be retried', async ({ page }) => {
  await prepareLargeHistory(page);
  for (const error of ['SYNTHETIC summary unavailable', '']) {
    await page.evaluate(error => {
      Object.assign((window as any).__documentCompaction, { summaryError: error, summary: '' });
    }, error);
    await generate(page, 'SYNTHETIC request needing failed compression');
    await expect(page.locator('.diff-error')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept and replace', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => (window as any).__documentCompaction.edits.length)).toBe(1);
    expect(await editorSource(page)).toBe(original);
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    await openAssistant(page);
    await expect(page.locator('.ai-conversation-memory')).toHaveCount(0);
    await expect(page.locator('.ai-conversation-turns > li')).toHaveCount(1);
    await expect(page.locator('.ai-conversation-turns > li')).toContainText(oversized);
  }
  await page.evaluate(summary => {
    Object.assign((window as any).__documentCompaction, { summaryError: '', summary });
  }, summaryOne);
  await generate(page, 'SYNTHETIC retry successful compression');
  await ready(page);
  const retries = await page.evaluate(() => (window as any).__documentCompaction.compressions);
  expect(retries).toHaveLength(3);
  for (const request of retries) expect(request.prompt).toContain(JSON.stringify(oversized));
  expect((await editRequest(page, 1)).history[1].content).toBe(summaryOne);
});

test('cancelling compression rejects late summaries and keeps history for a later retry', async ({ page }) => {
  await prepareLargeHistory(page);
  await page.evaluate(summary => {
    Object.assign((window as any).__documentCompaction, { summary, pauseSummary: true });
  }, summaryOne);
  await generate(page, 'SYNTHETIC cancelled compression');
  await expect.poll(() => page.evaluate(() => typeof (window as any).__documentCompaction.releaseSummary)).toBe('function');
  await page.getByRole('button', { name: 'Stop generating', exact: true }).click();
  await page.evaluate(async () => {
    (window as any).__documentCompaction.releaseSummary();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(await page.evaluate(() => (window as any).__documentCompaction.edits.length)).toBe(1);
  await expect(page.getByRole('button', { name: 'Accept and replace', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await openAssistant(page);
  await expect(page.locator('.ai-conversation-memory')).toHaveCount(0);
  await expect(page.locator('.ai-conversation-turns > li')).toHaveCount(1);
  await page.evaluate(() => { (window as any).__documentCompaction.pauseSummary = false; });
  await generate(page, 'SYNTHETIC retry after cancellation');
  await ready(page);
  expect((await summaryRequest(page, 1)).prompt).toContain(JSON.stringify(oversized));
  expect((await editRequest(page, 1)).history[1].content).toBe(summaryOne);
  expect(await editorSource(page)).toBe(original);
});

test('document replacement invalidates pending compression and never carries its memory into the new document', async ({ page }) => {
  await prepareLargeHistory(page);
  await page.evaluate(summary => {
    Object.assign((window as any).__documentCompaction, { summary, pauseSummary: true });
  }, summaryOne);
  await generate(page, 'SYNTHETIC compression abandoned on document replacement');
  await expect.poll(() => page.evaluate(() => typeof (window as any).__documentCompaction.releaseSummary)).toBe('function');
  const next = '# SYNTHETIC independent next document\n';
  await page.evaluate(content => {
    const state = (window as any).__acceptance;
    const document = { path: '/acceptance/synthetic-next.md', name: 'synthetic-next.md', content };
    state.disk[document.path] = content;
    state.emit('local-opened', { kind: 'file', document });
  }, next);
  await expect(page.getByRole('textbox', { name: 'Document name', exact: true })).toHaveValue('synthetic-next');
  await page.evaluate(async () => {
    (window as any).__documentCompaction.releaseSummary();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(page.locator('.diff-modal')).toHaveCount(0);
  await openAssistant(page);
  await expect(page.locator('.ai-conversation-memory')).toHaveCount(0);
  await expect(page.locator('.ai-conversation-turns > li')).toHaveCount(0);
  await generate(page, 'SYNTHETIC fresh document request');
  await ready(page);
  expect(await page.evaluate(() => (window as any).__documentCompaction.compressions.length)).toBe(1);
  expect((await editRequest(page, 1)).history).toEqual([]);
  expect((await editRequest(page, 1)).prompt).toContain(next);
  expect(await editorSource(page)).toBe(next);
});

test('compressed memory and long references stay within the complete provider request budget', async ({ page }) => {
  const content = '# SYNTHETIC long current document\n\n' + 'x'.repeat(98_000);
  await setup(page, content);
  await page.evaluate(() => {
    (window as any).__documentCompaction.references = [{
      path: '/synthetic-reference/budget.txt', name: 'synthetic-budget.txt', content: 'SYNTHETIC REFERENCE '.repeat(5_000),
    }];
  });
  await page.getByRole('button', { name: 'Add files', exact: true }).click();
  await expect(page.locator('.assistant-context-list > div')).toHaveCount(1);
  await generate(page, 'SYNTHETIC preserve long document context', oversized);
  await continueConversation(page);
  const memory = 'SYNTHETIC BUDGET MEMORY\n' + 'm'.repeat(3_900);
  await page.evaluate(summary => { (window as any).__documentCompaction.summary = summary; }, memory);
  await generate(page, 'SYNTHETIC next request with bounded summary and references');
  await ready(page);
  const request = await editRequest(page, 1);
  expect(request.history[1].content).toBe(memory);
  expect(request.history.map((message: any) => message.content).join('')).not.toContain(oversized);
  expect(request.prompt).toContain(content);
  expect(request.prompt.length).toBeLessThanOrEqual(120_000);
  const historyLength = request.history.reduce((total: number, message: any) => total + message.content.length, 0);
  expect(historyLength).toBeLessThanOrEqual(20_000);
  expect(request.system.length + request.prompt.length + historyLength).toBeLessThanOrEqual(140_000);
  await expect(page.locator('.diff-request-notice')).toContainText('References were truncated');
  expect(await editorSource(page)).toBe(content);
});
