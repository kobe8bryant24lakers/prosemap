import { expect, test, type Page } from '@playwright/test';
import { draftSource, editorSource, launchDocument, openDiagram } from './helpers';

// Synthetic documents and credentials. Native IPC is mocked; these assertions
// cover the real UI and conversation lifecycle, not a live provider or OS dialog.
const original = 'flowchart LR\n  A["SYNTHETIC original"] --> B["SYNTHETIC retained"]';
const firstDraft = 'flowchart LR\n  A["SYNTHETIC first draft"] --> B["SYNTHETIC retained"]';
const nextDraft = 'flowchart LR\n  A["SYNTHETIC next draft"] --> B["SYNTHETIC retained"]';
const document = `# SYNTHETIC conversation\n\n\`\`\`mermaid\n${original}\n\`\`\`\n`;

async function setup(page: Page) {
  await launchDocument(page, document, 'synthetic-conversation.md', 'ready', 'memory');
  await page.evaluate(() => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__syntheticConversation = { streams: [], cancellations: [], context: [] };
    w.__TAURI_INTERNALS__.invoke = (command: string, args: any = {}) => {
      if (command === 'cancel_ai') { w.__syntheticConversation.cancellations.push(args.requestId); return Promise.resolve(); }
      if (command === 'pick_ai_context_files') return Promise.resolve(w.__syntheticConversation.context);
      if (command === 'pick_ai_context_folder') return Promise.resolve({
        id: 'synthetic-mermaid-folder', name: 'SYNTHETIC diagram repository', truncated: false,
        files: [{ path: 'docs/design.md', name: 'design.md', bytes: 120 }, { path: 'src/service.ts', name: 'service.ts', bytes: 160 }],
      });
      if (command === 'read_ai_context_folder_files') return Promise.resolve(args.paths.map((path: string) => ({
        path: `context:${args.folderId}/${path}`, name: path, content: 'SYNTHETIC service connects the original and retained nodes.',
      })));
      if (command === 'release_ai_context_folder') return Promise.resolve();
      if (command === 'stream_ai') return new Promise<void>((resolve, reject) => {
        w.__syntheticConversation.streams.push({ request: args.request, send: (event: unknown) => args.onEvent.onmessage(event), resolve, reject });
      });
      return invoke(command, args);
    };
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '模型连接', exact: true });
  await settings.getByLabel('配置名称', { exact: true }).fill('SYNTHETIC conversation');
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

async function start(page: Page, instruction: string) {
  const index = await page.evaluate(() => (window as any).__syntheticConversation.streams.length);
  await page.getByLabel('描述你想要的图', { exact: true }).fill(instruction);
  await page.getByRole('button', { name: '生成图表草稿', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__syntheticConversation.streams.length)).toBe(index + 1);
  return index;
}

async function finish(page: Page, index: number, source: string) {
  await page.evaluate(({ index, source }) => {
    const stream = (window as any).__syntheticConversation.streams[index];
    stream.send({ type: 'delta', text: source });
    stream.send({ type: 'done' });
    stream.resolve();
  }, { index, source });
}

async function request(page: Page, index: number) {
  return page.evaluate(index => (window as any).__syntheticConversation.streams[index].request, index);
}

test('Mermaid follow-ups carry completed turns and the current manually edited draft; new conversation preserves the draft', async ({ page, browserName }) => {
  await setup(page);
  const workbench = page.locator('.mermaid-workbench');
  const conversation = workbench.getByRole('region', { name: 'AI 对话记录', exact: true });
  await workbench.getByRole('button', { name: '选择代码仓或文件夹', exact: true }).click();
  await expect(workbench.locator('.project-context-heading')).toContainText('SYNTHETIC diagram repository');
  await workbench.locator('.project-context-files label').filter({ hasText: 'src/service.ts' }).locator('input').check();
  const first = await start(page, 'SYNTHETIC first request');
  expect((await request(page, first)).history).toEqual([]);
  expect((await request(page, first)).prompt).toContain('SYNTHETIC service connects');
  await finish(page, first, firstDraft);
  await expect(workbench.locator('.workbench-ai-status')).toHaveClass(/success/);
  await expect(conversation.locator('li')).toHaveCount(1);
  await expect(conversation).toContainText('SYNTHETIC first request');
  await conversation.locator('summary').click();
  await expect(conversation.locator('pre')).toHaveText(firstDraft);
  await expect(conversation).toContainText('待应用');
  await page.setViewportSize({ width: 1440, height: 1200 });
  await workbench.getByRole('button', { name: '全屏编辑', exact: true }).click();
  await workbench.locator('.workbench-control-scroll').evaluate(element => { element.scrollTop = 0; });
  await expect(workbench.locator('.workbench-preview .mermaid-svg svg')).toContainText('SYNTHETIC first draft');
  await page.screenshot({ path: `outputs/mermaid-conversation-${browserName}.png` });

  const manual = firstDraft.replace('first draft', 'manual revision');
  await draftSource(page);
  await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(manual);
  await aiTab(page);
  const second = await start(page, 'SYNTHETIC follow-up keep the manual change');
  const secondRequest = await request(page, second);
  expect(secondRequest.history.map((message: any) => message.role)).toEqual(['user', 'assistant']);
  expect(secondRequest.history[0].content).toContain('SYNTHETIC first request');
  expect(secondRequest.history[1].content).toContain(firstDraft);
  expect(secondRequest.prompt).toContain(manual);
  await expect(conversation.getByRole('button', { name: '新对话', exact: true })).toBeDisabled();
  await finish(page, second, nextDraft);
  await expect(workbench.locator('.workbench-ai-status')).toHaveClass(/success/);
  await expect(conversation.locator('li')).toHaveCount(2);
  await conversation.getByRole('button', { name: '新对话', exact: true }).click();
  await expect(conversation.locator('li')).toHaveCount(0);
  expect(await draftSource(page)).toBe(nextDraft);
  await aiTab(page);
  const third = await start(page, 'SYNTHETIC isolated request');
  expect((await request(page, third)).history).toEqual([]);
  expect((await request(page, third)).prompt).toContain(nextDraft);
  await finish(page, third, nextDraft);
  await expect(conversation.locator('li')).toHaveCount(1);
  expect(await editorSource(page)).toBe(document);
});

test('cancelled and stale Mermaid responses never enter conversation history', async ({ page }) => {
  await setup(page);
  const workbench = page.locator('.mermaid-workbench');
  const turns = workbench.locator('.ai-conversation-turns > li');
  const cancelled = await start(page, 'SYNTHETIC cancelled request');
  await workbench.getByRole('button', { name: '停止生成', exact: true }).click();
  await finish(page, cancelled, firstDraft);
  await expect(turns).toHaveCount(0);
  expect(await draftSource(page)).toBe(original);
  await aiTab(page);
  const stale = await start(page, 'SYNTHETIC stale request');
  expect((await request(page, stale)).history).toEqual([]);
  await draftSource(page);
  const manual = original.replace('original', 'manual wins');
  await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(manual);
  await finish(page, stale, firstDraft);
  await aiTab(page);
  await expect(turns).toHaveCount(0);
  const retry = await start(page, 'SYNTHETIC retry after cancellation and manual change');
  expect((await request(page, retry)).history).toEqual([]);
  expect((await request(page, retry)).prompt).toContain(manual);
  await finish(page, retry, nextDraft);
  await expect(turns).toHaveCount(1);
  await expect(turns).toContainText('SYNTHETIC retry');
  expect(await editorSource(page)).toBe(document);
});

test('failed and invalid Mermaid responses are excluded from the next conversation request', async ({ page }) => {
  await setup(page);
  const workbench = page.locator('.mermaid-workbench');
  const failed = await start(page, 'SYNTHETIC failed request');
  await page.evaluate(index => (window as any).__syntheticConversation.streams[index].reject('SYNTHETIC transport failure'), failed);
  await expect(workbench.locator('.workbench-ai-status')).toHaveClass(/error/);
  const invalid = await start(page, 'SYNTHETIC invalid request');
  expect((await request(page, invalid)).history).toEqual([]);
  await finish(page, invalid, 'flowchart LR\n  A[broken');
  await expect(workbench.locator('.workbench-ai-status')).toHaveClass(/error/);
  await expect(workbench.locator('.ai-conversation-turns > li')).toHaveCount(0);
  const retry = await start(page, 'SYNTHETIC successful retry');
  expect((await request(page, retry)).history).toEqual([]);
  await finish(page, retry, nextDraft);
  await expect(workbench.locator('.ai-conversation-turns > li')).toHaveCount(1);
});

test('large current drafts reserve the complete input budget with compacted history and truncated references', async ({ page }) => {
  await setup(page);
  const workbench = page.locator('.mermaid-workbench');
  const first = await start(page, 'SYNTHETIC initial detailed diagram');
  const largeOutput = `${firstDraft}\n%% SYNTHETIC ${'a'.repeat(19_500)}`;
  await finish(page, first, largeOutput);
  await expect(workbench.locator('.workbench-ai-status')).toHaveClass(/success/);
  await expect(workbench.locator('.ai-conversation-turns > li')).toHaveCount(1);
  await draftSource(page);
  const longCurrent = `${nextDraft}\n%% SYNTHETIC ${'b'.repeat(45_000)}`;
  await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(longCurrent);
  await aiTab(page);
  await page.evaluate(() => {
    (window as any).__syntheticConversation.context = [{
      path: '/synthetic/large-context.txt', name: 'SYNTHETIC large context.txt', content: 'SYNTHETIC REFERENCE\n' + 'c'.repeat(90_000),
    }];
  });
  await workbench.getByRole('button', { name: '添加文件', exact: true }).click();
  const second = await start(page, 'SYNTHETIC preserve current diagram while using these references');
  expect((await request(page, second)).system).toContain('PROSEMAP_CONVERSATION_COMPACTION');
  await finish(page, second, 'SYNTHETIC memory: keep the first diagram requirements, while the latest current diagram remains authoritative.');
  await expect.poll(() => page.evaluate(() => (window as any).__syntheticConversation.streams.length)).toBe(second + 2);
  const sent = await request(page, second + 1);
  expect(sent.prompt).toContain(longCurrent);
  expect(sent.prompt).toContain('SYNTHETIC REFERENCE');
  expect(sent.prompt.length).toBeLessThanOrEqual(120_000);
  expect(sent.history[0].content).toContain('[Compressed conversation memory]');
  expect(sent.history[1].content).toContain('SYNTHETIC memory');
  expect(sent.system.length + sent.prompt.length + sent.history.reduce((total: number, message: any) => total + message.content.length, 0)).toBeLessThanOrEqual(140_000);
  await expect(workbench.locator('.ai-conversation-memory')).toContainText('已压缩 1 轮较早对话');
  await expect(workbench.locator('.workbench-request-notice')).toContainText('参考资料已截断');
  await finish(page, second + 1, nextDraft);
  await expect(workbench.locator('.workbench-ai-status')).toHaveClass(/success/);
});
