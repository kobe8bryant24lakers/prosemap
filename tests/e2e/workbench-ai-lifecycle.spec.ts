import { expect, test, type Locator, type Page } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

// All documents, model names and credentials here are synthetic. Only native IPC
// is substituted; these tests do not prove an installed app's HTTP or Keychain path.
const initial = 'flowchart LR\n  A["SYNTHETIC original"] --> B["SYNTHETIC keep"]';
const generated = 'flowchart LR\n  A["SYNTHETIC generated"] --> B["SYNTHETIC keep"]\n  B --> C["SYNTHETIC added"]';
const original = `# SYNTHETIC AI lifecycle\n\n\`\`\`mermaid\n${initial}\n\`\`\`\n\nSYNTHETIC END\n`;
const contextFiles = [
  { path: '/synthetic-ai/requirements.md', name: 'synthetic-requirements.md', content: 'SYNTHETIC REQUIREMENTS 中文\n' },
  { path: '/synthetic-ai/contract.ts', name: 'synthetic-contract.ts', content: 'export const SYNTHETIC_CONTRACT = true;\n' },
];

async function setup(page: Page, configured = true, twoModels = false) {
  await launchDocument(page, original, 'synthetic-ai-lifecycle.md', 'ready', 'memory');
  await page.evaluate(() => {
    const w = window as any, invoke = w.__TAURI_INTERNALS__.invoke;
    w.__aiLifecycle = { streams: [], context: [], profiles: null, switchError: '', cancellations: [] };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      const state = w.__aiLifecycle;
      if (command === 'save_model_profiles') { state.profiles = args.settings; return 'memory'; }
      if (command === 'select_model_profile') {
        if (state.switchError) throw state.switchError;
        state.profiles.activeId = args.id; return;
      }
      if (command === 'pick_ai_context_files') return state.context;
      if (command === 'cancel_ai') { state.cancellations.push(args.requestId); return; }
      if (command === 'stream_ai') return new Promise<void>((resolve, reject) => {
        state.streams.push({ request: args.request, send: (event: unknown) => args.onEvent.onmessage(event), resolve, reject });
      });
      return invoke(command, args);
    };
  });
  if (configured) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await configure(page.getByRole('dialog', { name: '模型连接', exact: true }), twoModels);
  }
  await openDiagram(page);
  await aiTab(page);
  return page.locator('.mermaid-workbench');
}

async function configure(dialog: Locator, twoModels = false) {
  for (let i = 1; i <= (twoModels ? 2 : 1); i++) {
    if (i > 1) await dialog.getByRole('button', { name: '添加模型', exact: true }).click();
    await dialog.getByLabel('配置名称', { exact: true }).fill(`SYNTHETIC profile ${i}`);
    await dialog.getByLabel('API 地址', { exact: true }).fill('http://127.0.0.1:1/v1');
    await dialog.getByLabel('模型名称', { exact: true }).fill(`synthetic-model-${i}`);
    await dialog.getByLabel('API 密钥', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
  }
  await dialog.getByRole('button', { name: '安全保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function aiTab(page: Page) {
  await page.locator('.workbench-tabs').getByRole('button', { name: 'AI 辅助', exact: true }).click();
}
async function start(page: Page, instruction = 'SYNTHETIC 修改首节点\n保留其他节点 中文🧭') {
  const before = await page.evaluate(() => (window as any).__aiLifecycle.streams.length);
  await page.getByLabel('描述你想要的图', { exact: true }).fill(instruction);
  await page.getByRole('button', { name: '生成图表草稿', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__aiLifecycle.streams.length)).toBe(before + 1);
  return before;
}
async function event(page: Page, index: number, type: 'delta' | 'reasoning_delta' | 'error', text: string) {
  await page.evaluate(({ index, type, text }) => {
    (window as any).__aiLifecycle.streams[index].send(type === 'error' ? { type, message: text } : { type, text });
  }, { index, type, text });
}
async function finish(page: Page, index: number, source = generated) {
  await event(page, index, 'delta', source);
  await page.evaluate(index => {
    const stream = (window as any).__aiLifecycle.streams[index];
    stream.send({ type: 'done' }); stream.resolve();
  }, index);
}
async function unchangedDocument(page: Page) {
  await expect(page.locator('.cm-content')).toHaveText(original, { useInnerText: true });
  expect(await page.evaluate(() => (window as any).__acceptance.disk['/acceptance/synthetic-ai-lifecycle.md'])).toBe(original);
  expect(await page.evaluate(() => (window as any).__acceptance.saved)).toHaveLength(0);
}
async function sourceInAi(page: Page) {
  await page.getByRole('button', { name: '手动编辑', exact: true }).click();
  return page.getByLabel('AI 生成结果源码编辑器', { exact: true });
}

test('AI examples replace only the prompt; whitespace cannot run and all mutation controls lock during streaming', async ({ page }) => {
  const workbench = await setup(page);
  const prompt = page.getByLabel('描述你想要的图', { exact: true });
  for (const empty of ['', ' \n\t ']) {
    await prompt.fill(empty);
    await expect(workbench.getByRole('button', { name: '生成图表草稿', exact: true })).toBeDisabled();
  }
  const examples = workbench.locator('.workbench-prompt-examples button');
  await expect(examples).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    const value = await examples.nth(i).textContent();
    await examples.nth(i).click(); await expect(prompt).toHaveValue(value!);
    expect(await draftSource(page)).toBe(initial); await aiTab(page);
  }
  await page.evaluate(files => { (window as any).__aiLifecycle.context = files; }, contextFiles);
  await workbench.getByRole('button', { name: '添加文件', exact: true }).click();
  const index = await start(page);
  await expect(prompt).toBeDisabled();
  await expect(workbench.locator('.workbench-ai-context input')).toBeDisabled();
  for (const control of [
    workbench.getByRole('button', { name: '添加文件', exact: true }),
    workbench.getByRole('button', { name: '手动编辑', exact: true }),
    workbench.getByRole('button', { name: '应用到文档', exact: true }),
    ...await examples.all(), ...await workbench.locator('.workbench-context-files button[aria-label]').all(),
  ]) await expect(control).toBeDisabled();
  await unchangedDocument(page);
  await finish(page, index);
  await expect(workbench.locator('.workbench-ai-status')).toHaveClass(/success/);
  await expect(prompt).toBeEnabled();
  expect(await draftSource(page)).toBe(generated);
  await unchangedDocument(page);
});

for (const useCurrent of [true, false]) {
  test(`AI request includes the current draft only when enabled (${useCurrent}), and removes exactly one reference`, async ({ page }) => {
    const workbench = await setup(page);
    await page.evaluate(files => { (window as any).__aiLifecycle.context = files; }, contextFiles);
    await workbench.getByRole('button', { name: '添加文件', exact: true }).click();
    const list = workbench.locator('.workbench-context-files');
    for (const file of contextFiles) await expect(list.locator(`[title="${file.path}"]`)).toContainText(file.name);
    await expect(list.locator('footer')).toContainText(`${contextFiles[0].content.length + contextFiles[1].content.length} 字符`);
    await workbench.getByRole('button', { name: `移除上下文 ${contextFiles[0].name}`, exact: true }).click();
    await expect(list).not.toContainText(contextFiles[0].name);
    await expect(list.locator('footer')).toContainText(`1 个文件 · ${contextFiles[1].content.length} 字符`);
    await workbench.locator('.workbench-ai-context input').setChecked(useCurrent);
    const index = await start(page);
    const request = await page.evaluate(index => (window as any).__aiLifecycle.streams[index].request, index);
    expect(request.prompt.includes(initial)).toBe(useCurrent);
    expect(request.prompt).toContain(contextFiles[1].content);
    expect(request.prompt).not.toContain(contextFiles[0].content);
    expect(request.prompt).toContain('SYNTHETIC 修改首节点\n保留其他节点 中文🧭');
    expect(await page.evaluate(() => (window as any).__aiLifecycle.context)).toEqual(contextFiles);
    await finish(page, index); await expect(workbench.locator('.workbench-ai-status')).toHaveClass(/success/);
    await unchangedDocument(page);
  });
}

test('AI context truncates the actual request at the advertised 80000 characters', async ({ page }) => {
  const workbench = await setup(page);
  const files = [{ path: '/synthetic-ai/long.txt', name: 'synthetic-long.txt', content: 'SYNTHETIC_BEGIN\n' + 'x'.repeat(80000) + '\nSYNTHETIC_OMITTED_END' }];
  await page.evaluate(files => { (window as any).__aiLifecycle.context = files; }, files);
  await workbench.getByRole('button', { name: '添加文件', exact: true }).click();
  await expect(workbench.locator('.workbench-context-files footer')).toHaveClass(/truncated/);
  await expect(workbench.locator('.workbench-context-files footer')).toContainText('截取前 80,000');
  const index = await start(page);
  const prompt = await page.evaluate((index: number): string => (window as any).__aiLifecycle.streams[index].request.prompt, index);
  const included = prompt.match(/<reference_file[^>]*>\n([\s\S]*?)\n\n\[内容因上下文长度限制而截断\]/)?.[1];
  expect(included).toBe(files[0].content.slice(0, 80000));
  expect(prompt).not.toContain('SYNTHETIC_OMITTED_END');
  await finish(page, index); await expect(workbench.locator('.workbench-ai-status')).toHaveClass(/success/);
  await unchangedDocument(page);
});

test('removing the middle AI reference preserves both neighbors and excludes only its content from the request', async ({ page }) => {
  const workbench = await setup(page);
  const files = [...contextFiles, { path: '/synthetic-ai/schema.json', name: 'synthetic-schema.json', content: '{"synthetic":true}\n' }];
  await page.evaluate(files => { (window as any).__aiLifecycle.context = files; }, files);
  await workbench.getByRole('button', { name: '添加文件', exact: true }).click();
  await workbench.getByRole('button', { name: `移除上下文 ${files[1].name}`, exact: true }).click();
  const list = workbench.locator('.workbench-context-files');
  await expect(list.locator('b')).toHaveText([files[0].name, files[2].name]);
  await expect(list.locator('footer')).toContainText(`2 个文件 · ${files[0].content.length + files[2].content.length} 字符`);
  const index = await start(page);
  const prompt = await page.evaluate((index: number): string => (window as any).__aiLifecycle.streams[index].request.prompt, index);
  expect(prompt).toContain(files[0].content); expect(prompt).toContain(files[2].content);
  expect(prompt).not.toContain(files[1].content);
  expect(await page.evaluate(() => (window as any).__aiLifecycle.context)).toEqual(files);
  await finish(page, index); await expect(workbench.locator('.workbench-ai-status')).toHaveClass(/success/);
  await unchangedDocument(page);
});

for (const withReasoning of [true, false]) {
  test(`AI streamed content and optional reasoning remain separate (${withReasoning}) until validation completes`, async ({ page }) => {
    const workbench = await setup(page);
    const index = await start(page), reasoning = 'SYNTHETIC provider explanation 中文';
    if (withReasoning) await event(page, index, 'reasoning_delta', reasoning);
    const toggle = workbench.locator('.workbench-ai-reasoning-toggle');
    await expect(toggle).toContainText(withReasoning ? `已接收 ${reasoning.length} 个字符` : '等待模型返回推理内容');
    if (withReasoning) await expect(workbench.locator('.workbench-ai-reasoning-content pre')).toHaveText(reasoning);
    await toggle.click(); await expect(workbench.locator('.workbench-ai-reasoning-content')).toHaveCount(0);
    await toggle.click(); await expect(workbench.locator('.workbench-ai-reasoning-content')).toBeVisible();
    const first = generated.slice(0, 20);
    await event(page, index, 'delta', first);
    await expect(workbench.locator('.workbench-ai-status')).toContainText(`已接收 ${first.length} 个字符`);
    expect(await draftSource(page)).toBe(initial); await aiTab(page);
    await finish(page, index, generated.slice(20));
    await expect(workbench.locator('.workbench-ai-status')).toHaveClass(/success/);
    if (!withReasoning) await expect(toggle).toContainText('模型未返回推理内容');
    expect(await draftSource(page)).toBe(generated); await showCanvas(page);
    await expect(workbench.locator('.mermaid-canvas-node')).toHaveCount(3);
    await unchangedDocument(page);
  });
}

test('AI stop preserves the valid draft, ignores late events and allows an independent retry', async ({ page }) => {
  const workbench = await setup(page);
  const first = await start(page);
  await event(page, first, 'delta', generated.slice(0, 20));
  await workbench.getByRole('button', { name: '停止生成', exact: true }).click();
  await expect(workbench.locator('.workbench-ai-status')).toContainText('当前草稿保持不变');
  await finish(page, first, generated.slice(20));
  expect(await draftSource(page)).toBe(initial); await aiTab(page);
  const second = await start(page, 'SYNTHETIC retry');
  await event(page, first, 'reasoning_delta', 'SYNTHETIC STALE REASONING');
  await finish(page, second);
  await expect(workbench.locator('.workbench-ai-status')).toHaveClass(/success/);
  await expect(workbench.locator('.workbench-ai-reasoning')).not.toContainText('STALE');
  expect(await draftSource(page)).toBe(generated);
  const ids = await page.evaluate(() => (window as any).__aiLifecycle.streams.map((s: any) => s.request.requestId));
  expect(ids[0]).not.toBe(ids[1]);
  expect(await page.evaluate(() => (window as any).__aiLifecycle.cancellations)).toContain(ids[0]);
  await unchangedDocument(page);
});

for (const failure of ['transport', 'stream-error', 'invalid-source', 'empty-source'] as const) {
  test(`AI ${failure} leaves the original draft intact and recovers on retry`, async ({ page }) => {
    const workbench = await setup(page);
    const index = await start(page);
    if (failure === 'transport') await page.evaluate(index => (window as any).__aiLifecycle.streams[index].reject('SYNTHETIC provider unavailable'), index);
    else if (failure === 'stream-error') { await event(page, index, 'error', 'SYNTHETIC upstream error'); await finish(page, index); }
    else await finish(page, index, failure === 'invalid-source' ? 'flowchart LR\n A[broken' : ' \n\t ');
    await expect(workbench.locator('.workbench-ai-status')).toHaveClass(/error/);
    await expect(workbench.locator('.workbench-ai-status')).not.toHaveText('');
    expect(await draftSource(page)).toBe(initial); await aiTab(page);
    const retry = await start(page, 'SYNTHETIC retry after error'); await finish(page, retry);
    await expect(workbench.locator('.workbench-ai-status')).toHaveClass(/success/);
    expect(await draftSource(page)).toBe(generated); await unchangedDocument(page);
  });
}

test('AI close cancellation keeps the stream alive; confirmed close ignores late completion in the next session', async ({ page }) => {
  const workbench = await setup(page);
  const index = await start(page);
  await workbench.getByRole('button', { name: '关闭图表工作台', exact: true }).click();
  let confirm = page.getByRole('alertdialog', { name: '停止生成并关闭？', exact: true });
  await confirm.getByRole('button', { name: '继续编辑', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__aiLifecycle.cancellations)).toHaveLength(0);
  await event(page, index, 'delta', generated.slice(0, 20));
  await expect(workbench.locator('.workbench-ai-status')).toContainText('已接收 20 个字符');
  await workbench.getByRole('button', { name: '关闭图表工作台', exact: true }).click();
  confirm = page.getByRole('alertdialog', { name: '停止生成并关闭？', exact: true });
  await confirm.getByRole('button', { name: '停止并关闭', exact: true }).click();
  await expect(workbench).toHaveCount(0);
  await openDiagram(page); await finish(page, index, generated.slice(20));
  expect(await draftSource(page)).toBe(initial);
  await unchangedDocument(page);
});

test('manual AI draft editing recovers from syntax errors and keeps the last fast revision across preview and canvas', async ({ page }) => {
  const workbench = await setup(page);
  const source = await sourceInAi(page);
  await source.fill('flowchart LR\n A[broken');
  await expect(workbench.locator('.workbench-ai-validation')).toHaveClass(/error/);
  await source.fill('flowchart LR\n A[temporary broken');
  const last = generated.replace('SYNTHETIC generated', 'SYNTHETIC 最终中文🧭');
  await source.fill(last);
  await expect(workbench.locator('.workbench-ai-validation')).toHaveClass(/\bvalid\b/);
  await expect(source).toHaveValue(last);
  await expect(workbench.locator('.workbench-ai-editor-heading')).toContainText('3 行');
  await workbench.getByRole('button', { name: '返回预览', exact: true }).click();
  await expect(workbench.locator('.workbench-preview .mermaid-svg svg')).toContainText('SYNTHETIC 最终中文🧭');
  await showCanvas(page); await expect(workbench.locator('[data-mermaid-node-id="A"]')).toContainText('SYNTHETIC 最终中文🧭');
  expect(await draftSource(page)).toBe(last); await unchangedDocument(page);
});

test('connecting a model from AI preserves the prompt and an edited diagram draft', async ({ page }) => {
  const workbench = await setup(page, false);
  const source = await sourceInAi(page); await source.fill(generated);
  const prompt = page.getByLabel('描述你想要的图', { exact: true }); await prompt.fill('SYNTHETIC keep this prompt');
  await workbench.getByRole('button', { name: '先连接模型', exact: true }).click();
  await configure(page.getByRole('dialog', { name: '模型连接', exact: true }));
  await expect(prompt).toHaveValue('SYNTHETIC keep this prompt');
  await expect(source).toHaveValue(generated);
  await expect(workbench.getByRole('button', { name: '先连接模型', exact: true })).toHaveCount(0);
  await expect(workbench.getByRole('button', { name: '生成图表草稿', exact: true })).toBeEnabled();
  await unchangedDocument(page);
});

test('model switching is synchronized across entry points, and a failed switch keeps the active model and draft', async ({ page }) => {
  const workbench = await setup(page, true, true);
  const switcher = workbench.getByRole('combobox', { name: '切换模型', exact: true });
  const profiles = await page.evaluate(() => (window as any).__aiLifecycle.profiles.profiles.map((p: any) => ({ id: p.id, model: p.model })));
  await switcher.selectOption(profiles[1].id);
  await expect(switcher).toHaveValue(profiles[1].id);
  const selectedValues = await page.locator('select[aria-label="切换模型"]').evaluateAll(nodes => nodes.map(n => (n as HTMLSelectElement).value));
  expect(selectedValues.length).toBeGreaterThanOrEqual(2);
  expect(selectedValues.every(id => id === profiles[1].id)).toBe(true);
  await page.evaluate(() => { (window as any).__aiLifecycle.switchError = 'SYNTHETIC model switch failure'; });
  await switcher.selectOption(profiles[0].id);
  await expect(page.locator('.toast.error')).toContainText('SYNTHETIC model switch failure');
  await expect(switcher).toHaveValue(profiles[1].id);
  const index = await start(page);
  expect(await page.evaluate(index => (window as any).__aiLifecycle.streams[index].request.model, index)).toBe(profiles[1].model);
  await finish(page, index); await expect(workbench.locator('.workbench-ai-status')).toHaveClass(/success/);
  expect(await draftSource(page)).toBe(generated); await unchangedDocument(page);
});
