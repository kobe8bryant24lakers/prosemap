import { expect, test, type Page } from '@playwright/test';
import { draftSource, editorSource, launchDocument, openDiagram } from './helpers';

// Synthetic data and mocked native IPC. These exercise actual Mermaid validation,
// draft state and compaction lifecycle without claiming real-model acceptance.
const original = 'flowchart LR\n  A["SYNTHETIC original"] --> B["SYNTHETIC retained"]';
const edited = 'flowchart LR\n  A["SYNTHETIC edited"] --> B["SYNTHETIC retained"]';
const largeDraft = `${edited}\n%% SYNTHETIC complete prior output ${'x'.repeat(22_000)}`;
const document = `# SYNTHETIC compaction\n\n\`\`\`mermaid\n${original}\n\`\`\`\n`;
const summary = 'SYNTHETIC memory: preserve the retained node; earlier generated diagram is a proposal, not applied to the document.';

async function setup(page: Page) {
  await launchDocument(page, document, 'synthetic-mermaid-compaction.md', 'ready', 'memory');
  await page.evaluate(() => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__mermaidCompaction = { streams: [], cancellations: [] };
    w.__TAURI_INTERNALS__.invoke = (command: string, args: any = {}) => {
      if (command === 'cancel_ai') { w.__mermaidCompaction.cancellations.push(args.requestId); return Promise.resolve(); }
      if (command === 'stream_ai') return new Promise<void>((resolve, reject) => {
        w.__mermaidCompaction.streams.push({ request: args.request, send: (event: unknown) => args.onEvent.onmessage(event), resolve, reject });
      });
      return invoke(command, args);
    };
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '模型连接', exact: true });
  await settings.getByLabel('配置名称', { exact: true }).fill('SYNTHETIC compaction');
  await settings.getByLabel('API 地址', { exact: true }).fill('http://127.0.0.1:1/v1');
  await settings.getByLabel('模型名称', { exact: true }).fill('synthetic-model');
  await settings.getByLabel('API 密钥', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
  await settings.getByRole('button', { name: '安全保存', exact: true }).click();
  await openDiagram(page);
  await aiTab(page);
}

async function aiTab(page: Page) {
  await page.locator('.workbench-tabs').getByRole('button', { name: 'AI 辅助', exact: true }).click();
}
async function streamCount(page: Page) {
  return page.evaluate(() => (window as any).__mermaidCompaction.streams.length);
}
async function start(page: Page, instruction: string) {
  const index = await streamCount(page);
  await page.getByLabel('描述你想要的图', { exact: true }).fill(instruction);
  await page.getByRole('button', { name: '生成图表草稿', exact: true }).click();
  await expect.poll(() => streamCount(page)).toBe(index + 1);
  return index;
}
async function request(page: Page, index: number) {
  return page.evaluate(index => (window as any).__mermaidCompaction.streams[index].request, index);
}
async function finish(page: Page, index: number, text: string) {
  await page.evaluate(({ index, text }) => {
    const stream = (window as any).__mermaidCompaction.streams[index];
    stream.send({ type: 'delta', text });
    stream.send({ type: 'done' });
    stream.resolve();
  }, { index, text });
}
async function nextEditAfterSummary(page: Page, summaryIndex: number, text = summary) {
  await finish(page, summaryIndex, text);
  await expect.poll(() => streamCount(page)).toBe(summaryIndex + 2);
  const edit = await request(page, summaryIndex + 1);
  expect(edit.system).not.toContain('PROSEMAP_CONVERSATION_COMPACTION');
  return edit;
}
async function seedLargeTurn(page: Page) {
  const index = await start(page, 'SYNTHETIC keep the retained node');
  expect((await request(page, index)).system).not.toContain('PROSEMAP_CONVERSATION_COMPACTION');
  await finish(page, index, largeDraft);
  await expect(page.locator('.workbench-ai-status')).toHaveClass(/success/);
  await expect(page.locator('.ai-conversation-turns > li')).toHaveCount(1);
}

// Repeated compaction updates one cumulative memory; it is not a hidden crop of
// old outputs and it never replaces the actual current Mermaid draft.
test('Mermaid automatically summarizes oversized history and reuses cumulative memory until reset', async ({ page, browserName }) => {
  await setup(page);
  await seedLargeTurn(page);
  const compact = await start(page, 'SYNTHETIC refine the current diagram');
  const compactRequest = await request(page, compact);
  expect(compactRequest.system).toContain('PROSEMAP_CONVERSATION_COMPACTION');
  expect(compactRequest.prompt).toContain('SYNTHETIC keep the retained node');
  expect(compactRequest.prompt).toContain('SYNTHETIC complete prior output');
  await expect(page.locator('.workbench-ai-status')).toContainText('正在压缩对话上下文');
  await expect(page.getByRole('button', { name: '新对话', exact: true })).toBeDisabled();
  expect(await editorSource(page)).toBe(document);
  const edit = await nextEditAfterSummary(page, compact);
  expect(edit.history[0].content).toContain('[Compressed conversation memory]');
  expect(edit.history[1].content).toBe(summary);
  expect(edit.prompt).toContain(largeDraft);
  expect(edit.history.reduce((total: number, message: any) => total + message.content.length, 0)).toBeLessThanOrEqual(20_000);
  const secondLarge = largeDraft.replace('SYNTHETIC edited', 'SYNTHETIC second draft');
  await finish(page, compact + 1, secondLarge);
  await expect(page.locator('.workbench-ai-status')).toHaveClass(/success/);
  const memory = page.locator('.ai-conversation-memory');
  await expect(memory).toContainText('已压缩 1 轮较早对话');
  await memory.locator('summary').click();
  await expect(memory.locator('pre')).toHaveText(summary);
  await expect(page.locator('.workbench-preview .mermaid-svg svg')).toContainText('SYNTHETIC second draft');
  await page.screenshot({ path: `outputs/mermaid-compaction-${browserName}.png` });

  const compactAgain = await start(page, 'SYNTHETIC keep both decisions');
  expect((await request(page, compactAgain)).system).toContain('PROSEMAP_CONVERSATION_COMPACTION');
  expect((await request(page, compactAgain)).prompt).toContain(summary);
  expect((await request(page, compactAgain)).prompt).toContain('SYNTHETIC refine the current diagram');
  const cumulative = 'SYNTHETIC cumulative memory: preserve the retained node and refine only the first node. Both outputs remained proposals.';
  const finalRequest = await nextEditAfterSummary(page, compactAgain, cumulative);
  expect(finalRequest.history[1].content).toBe(cumulative);
  expect(finalRequest.prompt).toContain(secondLarge);
  await finish(page, compactAgain + 1, edited);
  await expect(page.locator('.workbench-ai-status')).toHaveClass(/success/);
  await expect(memory).toContainText('已压缩 2 轮较早对话');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await expect(memory).toHaveCount(0);
  await expect(page.locator('.ai-conversation-turns > li')).toHaveCount(0);
  expect(await draftSource(page)).toBe(edited);
  await aiTab(page);
  const fresh = await start(page, 'SYNTHETIC fresh conversation');
  expect((await request(page, fresh)).history).toEqual([]);
  await finish(page, fresh, edited);
  await expect(page.locator('.workbench-ai-status')).toHaveClass(/success/);
  expect(await editorSource(page)).toBe(document);
});

test('Mermaid compacts older complete turns after the normal turn limit and keeps recent raw exchanges', async ({ page }) => {
  await setup(page);
  for (let turn = 1; turn <= 7; turn++) {
    const index = await start(page, `SYNTHETIC instruction ${turn}`);
    expect((await request(page, index)).system).not.toContain('PROSEMAP_CONVERSATION_COMPACTION');
    await finish(page, index, edited.replace('edited', `draft ${turn}`));
    await expect(page.locator('.workbench-ai-status')).toHaveClass(/success/);
  }
  const compact = await start(page, 'SYNTHETIC instruction 8');
  expect((await request(page, compact)).system).toContain('PROSEMAP_CONVERSATION_COMPACTION');
  expect((await request(page, compact)).prompt).toContain('SYNTHETIC instruction 1');
  const edit = await nextEditAfterSummary(page, compact);
  expect(edit.history[1].content).toBe(summary);
  expect(edit.history.map((message: any) => message.content).join('\n')).toContain('SYNTHETIC instruction 7');
  expect(edit.history.length).toBeLessThanOrEqual(12);
  expect(edit.history.length).toBeGreaterThan(2);
  await finish(page, compact + 1, edited);
  await expect(page.locator('.workbench-ai-status')).toHaveClass(/success/);
  await expect(page.locator('.ai-conversation-memory')).toContainText('已压缩 4 轮较早对话');
});

test('cancelled or stale Mermaid compaction never updates memory or starts a diagram generation', async ({ page }) => {
  await setup(page);
  await seedLargeTurn(page);
  const cancelled = await start(page, 'SYNTHETIC cancel while summarizing');
  expect((await request(page, cancelled)).system).toContain('PROSEMAP_CONVERSATION_COMPACTION');
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await finish(page, cancelled, 'SYNTHETIC cancelled summary must not survive');
  await expect(page.locator('.workbench-ai-status')).toHaveClass(/idle/);
  await expect(page.locator('.ai-conversation-memory')).toHaveCount(0);
  await expect(page.locator('.ai-conversation-turns > li')).toHaveCount(1);
  expect(await draftSource(page)).toBe(largeDraft);
  await aiTab(page);
  expect(await streamCount(page)).toBe(cancelled + 1);

  const stale = await start(page, 'SYNTHETIC edit source while summarizing');
  const manual = edited.replace('edited', 'SYNTHETIC manual wins');
  await draftSource(page);
  await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(manual);
  await finish(page, stale, 'SYNTHETIC stale summary must not survive');
  await aiTab(page);
  await expect(page.locator('.ai-conversation-memory')).toHaveCount(0);
  await expect(page.locator('.ai-conversation-turns > li')).toHaveCount(1);
  expect(await streamCount(page)).toBe(stale + 1);
  const retry = await start(page, 'SYNTHETIC retry using the current source');
  const requestAfterRetry = await nextEditAfterSummary(page, retry);
  expect(requestAfterRetry.prompt).toContain(manual);
  expect(JSON.stringify(requestAfterRetry)).not.toContain('summary must not survive');
  await finish(page, retry + 1, edited);
  await expect(page.locator('.workbench-ai-status')).toHaveClass(/success/);
  expect(await editorSource(page)).toBe(document);
});

test('failed empty or oversized Mermaid compaction preserves the original history and allows retry', async ({ page }) => {
  await setup(page);
  await seedLargeTurn(page);
  for (const failure of ['transport', 'empty', 'oversized']) {
    const index = await start(page, `SYNTHETIC ${failure} compaction`);
    expect((await request(page, index)).system).toContain('PROSEMAP_CONVERSATION_COMPACTION');
    if (failure === 'transport') await page.evaluate(index => (window as any).__mermaidCompaction.streams[index].reject('SYNTHETIC compression transport failure'), index);
    else await finish(page, index, failure === 'empty' ? '' : 'SYNTHETIC '.repeat(600));
    await expect(page.locator('.workbench-ai-status')).toHaveClass(/error/);
    await expect(page.locator('.ai-conversation-memory')).toHaveCount(0);
    await expect(page.locator('.ai-conversation-turns > li')).toHaveCount(1);
    expect(await streamCount(page)).toBe(index + 1);
  }
  expect(await draftSource(page)).toBe(largeDraft);
  await aiTab(page);
  const retry = await start(page, 'SYNTHETIC successful compaction retry');
  const edit = await nextEditAfterSummary(page, retry);
  expect(edit.history[1].content).toBe(summary);
  await finish(page, retry + 1, edited);
  await expect(page.locator('.workbench-ai-status')).toHaveClass(/success/);
  expect(await editorSource(page)).toBe(document);
});
