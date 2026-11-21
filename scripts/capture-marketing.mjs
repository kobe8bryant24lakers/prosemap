// Capture the real production frontend using synthetic documents and AI replies.
// Native IPC is substituted: these images are not native-desktop acceptance.
// Run after npm run build, with npm run preview -- --port 1422 running.
import { chromium, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { launchDocument } from '../tests/e2e/helpers.ts';

const browser = await chromium.launch();
const output = new URL('../outputs/marketing/', import.meta.url);
await mkdir(output, { recursive: true });
try {
  for (const locale of ['en', 'zh-CN']) {
    const en = locale === 'en';
    const content = await readFile(new URL(`../website/assets/launch-plan${en ? '' : '.zh-CN'}.md`, import.meta.url), 'utf8');
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:1422', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await launchDocument(page, content, 'synthetic-launch-plan.md');
    await expect.poll(async () => page.locator('.mermaid-svg svg g.node').first().evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(60);
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
        if (command === 'stream_ai') {
          args.onEvent.onmessage({ type: 'delta', text: window.__syntheticMarketingReply });
          args.onEvent.onmessage({ type: 'done' });
          return;
        }
        return original(command, args);
      };
    });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('模型名称', { exact: true }).fill('Synthetic demo');
    await page.getByLabel('API 密钥', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
    await page.getByRole('button', { name: '安全保存', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (en) await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    await expect(page.locator('.mermaid-svg svg').first()).toBeVisible();
    // Let the save/configuration toast disappear before documenting the workspace.
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10000 });
    const capture = async name => {
      await page.evaluate(() => document.fonts.ready);
      if (name === 'workspace' || name === 'questions') {
        await expect.poll(async () => page.locator('.mermaid-svg svg g.node').first().evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(60);
      }
      await page.screenshot({ path: new URL(`${name}-${locale}.png`, output).pathname, animations: 'disabled' });
      console.log(`${name}-${locale}.png`);
    };
    await capture('workspace');
    const diagram = await page.locator('.mermaid-svg svg').first().evaluate(element => {
      const svg = element.cloneNode(true);
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      return new XMLSerializer().serializeToString(svg);
    });
    await writeFile(new URL(`../website/assets/diagram-${locale}.svg`, import.meta.url), diagram);

    // The workbench is opened from the diagram already in this document.
    await page.getByRole('button', { name: en ? 'Edit diagram on the visual canvas' : '在可视化画布中编辑图表', exact: true }).first().click();
    await expect(page.locator('.mermaid-canvas-node').first()).toBeVisible();
    await page.locator('.mermaid-canvas-node[data-mermaid-node-id="review"]').click();
    await capture('canvas');
    await page.getByRole('button', { name: en ? 'Close diagram workspace' : '关闭图表工作台', exact: true }).click();

    await page.getByRole('button', { name: en ? 'Preview only' : '纯预览', exact: true }).click();
    await page.getByRole('button', { name: en ? 'AI writing assistant' : 'AI 文字助手', exact: true }).click();
    await page.getByRole('button', { name: en ? 'Document Q&A' : '文档问答', exact: true }).click();
    await page.evaluate(reply => { window.__syntheticMarketingReply = reply; }, en
      ? 'Before sharing this plan, complete two steps:\n\n1. **Review the changes together.** Compare the proposed wording with the original.\n2. **Publish the approved document.** Keep the Mermaid source in the Markdown file.\n\nThe first draft and the review diagram are already checked off.\n\n*Illustrative answer for this synthetic product tour.*'
      : '分享计划前，还有两件事：\n\n1. **一起审阅修改。** 对比建议措辞与原文，确认后再接受。\n2. **发布确认后的文档。** 在 Markdown 文件中保留 Mermaid 源码。\n\n第一版想法和评审流程图已经完成。\n\n*这是虚构产品演示中的示例回答。*');
    await page.locator('#document-question').fill(en ? 'What is left to do before we share this plan?' : '分享这份计划之前，还有哪些事要做？');
    await page.getByRole('button', { name: en ? 'Send question' : '发送问题', exact: true }).click();
    await expect(page.locator('.question-answer')).toBeVisible();
    await capture('questions');

    await page.getByRole('button', { name: en ? 'Edit document' : '编辑文档', exact: true }).click();
    const modified = en
      ? content.replace('We should make the document easier to understand and then share it with the team so everyone knows what to do next.', 'Clarify the plan. Share it with the team. Give everyone a clear next step.').replace('Turn a rough release note into a plan the whole team can follow.', 'Turn a rough release note into a shared plan, with decisions everyone can see.')
      : content.replace('我们应该把文档改得更容易理解一些，然后分享给团队里的其他人，让大家知道接下来要做什么。', '写清计划，分享给团队，让每个人都知道下一步。').replace('把一份粗略的发布笔记，写成团队都能读懂的行动计划。', '把粗略的发布笔记，写成目标明确、行动清晰的团队计划。');
    await page.evaluate(reply => { window.__syntheticMarketingReply = reply; }, modified);
    await page.getByRole('button', { name: en ? 'Generate suggestion' : '生成建议', exact: true }).click();
    await expect(page.getByRole('button', { name: en ? 'Accept and replace' : '接受并替换', exact: true })).toBeEnabled();
    await capture('review');
    if (errors.length) throw new Error(errors.join('\n'));
    await context.close();
  }
} finally {
  await browser.close();
}
