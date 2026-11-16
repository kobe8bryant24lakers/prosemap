import { expect, test, type Locator, type Page } from '@playwright/test';
import { draftSource, editorSource, launchDocument, mod, openDiagram, savedSource } from './helpers';

// Synthetic model responses and native IPC only. Mermaid parsing/rendering and
// the complete generate/apply/save path run unchanged; no real AI or keychain.
const originalSource = 'flowchart LR\n  A["SYNTHETIC original"] --> B["SYNTHETIC keep"]';
const originalDocument = `# SYNTHETIC AI line breaks\n\n\`\`\`mermaid\n${originalSource}\n\`\`\`\n\nSYNTHETIC_END\n`;
const filename = 'synthetic-ai-line-breaks.md';
const firstLine = 'SYNTHETIC_LINE_ONE';
const secondLine = 'SYNTHETIC_LINE_TWO';
const diagrams = [
  {
    name: 'flowchart',
    source: `flowchart LR\n  A["${firstLine}<br>${secondLine}"] --> B["SYNTHETIC_THREE<BR />SYNTHETIC_FOUR"]`,
    text: [firstLine, secondLine],
    hasLineBreak: true,
  },
  {
    name: 'sequence',
    source: `sequenceDiagram\n  participant A as SYNTHETIC Alice\n  participant B as SYNTHETIC Bob\n  A->>B: ${firstLine}<br/>${secondLine}`,
    text: [firstLine, secondLine],
    hasLineBreak: true,
  },
  {
    name: 'class interface annotation',
    source: 'classDiagram\n  class SYNTHETIC_Service {\n    <<interface>>\n    +execute()\n  }',
    text: ['SYNTHETIC_Service', 'interface', 'execute()'],
    hasLineBreak: false,
  },
  {
    name: 'state choice declaration',
    source: 'stateDiagram-v2\n  state SYNTHETIC_Decision <<choice>>\n  [*] --> SYNTHETIC_Decision\n  SYNTHETIC_Decision --> SYNTHETIC_Ready: yes\n  SYNTHETIC_Decision --> SYNTHETIC_Failed: no',
    text: ['SYNTHETIC_Ready', 'SYNTHETIC_Failed'],
    hasLineBreak: false,
  },
];

async function setup(page: Page, response: string) {
  await launchDocument(page, originalDocument, filename, 'ready', 'memory');
  await page.evaluate(response => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__mermaidLineBreaks = { response, requests: [] };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command === 'stream_ai') {
        const state = w.__mermaidLineBreaks;
        state.requests.push(args.request);
        // Splitting inside the result exercises the real streaming assembly.
        const split = Math.floor(state.response.length / 2);
        args.onEvent.onmessage({ type: 'delta', text: state.response.slice(0, split) });
        args.onEvent.onmessage({ type: 'delta', text: state.response.slice(split) });
        args.onEvent.onmessage({ type: 'done' });
        return;
      }
      return invoke(command, args);
    };
  }, response);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '模型连接', exact: true });
  await dialog.getByLabel('配置名称', { exact: true }).fill('SYNTHETIC line-break model');
  await dialog.getByLabel('API 地址', { exact: true }).fill('http://127.0.0.1:1/v1');
  await dialog.getByLabel('模型名称', { exact: true }).fill('synthetic-line-break-model');
  await dialog.getByLabel('API 密钥', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
  await dialog.getByRole('button', { name: '安全保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function startWorkbench(page: Page) {
  await openDiagram(page);
  await page.locator('.workbench-tabs').getByRole('button', { name: 'AI 辅助', exact: true }).click();
  await page.getByLabel('描述你想要的图', { exact: true }).fill('SYNTHETIC 生成包含多行标签的图表');
  await page.getByRole('button', { name: '生成图表草稿', exact: true }).click();
}

async function startAssistant(page: Page) {
  await page.locator('.cm-content').focus();
  await page.keyboard.press(`${mod}+Home`);
  for (let line = 0; line < 3; line++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press(`${mod}+Shift+m`);
  const panel = page.locator('.assistant-panel');
  await expect(panel.locator('.compose-context')).toContainText('将修改光标所在的 Mermaid 图');
  await panel.getByLabel('告诉 AI 你的要求', { exact: true }).fill('SYNTHETIC 生成包含多行标签的图表');
  await panel.getByRole('button', { name: '生成建议', exact: true }).click();
  await expect(page.locator('.diff-modal')).toBeVisible();
}

async function expectDocumentUnchanged(page: Page) {
  expect(await editorSource(page)).toBe(originalDocument);
  expect(await page.evaluate(name => (window as any).__acceptance.disk[`/acceptance/${name}`], filename)).toBe(originalDocument);
  expect(await page.evaluate(() => (window as any).__acceptance.saved)).toHaveLength(0);
}

async function expectRenderedLineBreak(svg: Locator) {
  await expect(svg).toBeVisible();
  await expect(svg).toContainText(firstLine);
  await expect(svg).toContainText(secondLine);
  // A successful parse alone is insufficient: inspect actual rendered text
  // positions in both HTML flowchart labels and SVG sequence message tspans.
  await expect.poll(() => svg.evaluate((root, labels) => {
    const bounds = labels.map(label => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const index = node.textContent?.indexOf(label) ?? -1;
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + label.length);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return { top: rect.top, height: rect.height };
      }
      return null;
    });
    return bounds[0] !== null && bounds[1] !== null
      && bounds[1].top > bounds[0].top + bounds[0].height / 2;
  }, [firstLine, secondLine])).toBe(true);
}

async function expectRenderedDiagram(svg: Locator, diagram: typeof diagrams[number]) {
  await expect(svg).toBeVisible();
  for (const text of diagram.text) await expect(svg).toContainText(text);
  if (diagram.hasLineBreak) await expectRenderedLineBreak(svg);
}

for (const entry of ['workbench', 'assistant'] as const) {
  for (const diagram of diagrams) {
    test(`${entry}: generated ${diagram.name} keeps supported Mermaid syntax, renders and saves exact source`, async ({ page }) => {
      const response = entry === 'workbench' ? `\`\`\`mermaid\n${diagram.source}\n\`\`\`` : diagram.source;
      await setup(page, response);
      if (entry === 'workbench') {
        await startWorkbench(page);
        await expect(page.locator('.workbench-ai-status')).toHaveClass(/success/);
        await expectRenderedDiagram(page.locator('.workbench-preview .mermaid-svg svg'), diagram);
        expect(await draftSource(page)).toBe(diagram.source);
        await expectDocumentUnchanged(page);
        await page.getByRole('button', { name: '应用到文档', exact: true }).click();
        await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
      } else {
        await startAssistant(page);
        await expect(page.getByRole('button', { name: '接受并替换', exact: true })).toBeEnabled();
        await expect(page.locator('.diff-error')).toHaveCount(0);
        await expectDocumentUnchanged(page);
        await page.getByRole('button', { name: '接受并替换', exact: true }).click();
        await expect(page.locator('.diff-modal')).toHaveCount(0);
      }
      await expectRenderedDiagram(page.locator('.preview-pane .mermaid-svg svg'), diagram);
      expect(await savedSource(page)).toBe(originalDocument.replace(originalSource, diagram.source));
      expect(await page.evaluate(() => (window as any).__mermaidLineBreaks.requests.length)).toBe(1);
    });
  }

  for (const unsafe of [
    { name: 'br event attribute', source: `flowchart LR\n  A["${firstLine}<br onmouseover=alert(123456)>${secondLine}"]` },
    { name: 'script disguised as a class annotation', source: 'classDiagram\n  class SYNTHETIC_Service {\n    <<script>>\n  }' },
  ]) {
    test(`${entry}: a generated ${unsafe.name} is rejected and leaves the complete original unchanged`, async ({ page }) => {
      const dialogs: string[] = [];
      page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
      await setup(page, unsafe.source);
      if (entry === 'workbench') {
        await startWorkbench(page);
        await expect(page.locator('.workbench-ai-status')).toHaveClass(/error/);
        await expect(page.locator('.workbench-ai-status')).toContainText('HTML');
        expect(await draftSource(page)).toBe(originalSource);
        await expectDocumentUnchanged(page);
        await page.getByRole('button', { name: '关闭图表工作台', exact: true }).click();
        await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
      } else {
        await startAssistant(page);
        await expect(page.locator('.diff-error')).toContainText('HTML');
        await expect(page.getByRole('button', { name: '接受并替换', exact: true })).toBeDisabled();
        await expectDocumentUnchanged(page);
        await page.getByRole('button', { name: '拒绝', exact: true }).click();
      }
      expect(dialogs).toEqual([]);
      expect(await savedSource(page)).toBe(originalDocument);
    });
  }
}
