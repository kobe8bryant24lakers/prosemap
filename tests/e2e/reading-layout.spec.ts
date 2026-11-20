import { expect, test, type Locator } from '@playwright/test';
import { launchDocument, openDiagram } from './helpers';

const source = ['# Synthetic reading layout', '', '| Item | Count |', '| --- | --- |', '| Drawing | 1 |',
  '', '```mermaid', 'flowchart TD', ' Start --> Review', ' Review --> Pack', ' Pack --> Travel',
  ' Travel --> Check', ' Check --> Finish', '```', ''].join('\n');

test('preview uses the available width and the writing assistant is visible in editor and focus mode', async ({ page }) => {
  await launchDocument(page, source);
  const ai = page.getByRole('button', { name: 'AI 文字助手', exact: true });
  for (const viewport of [{ width: 1500, height: 1000 }, { width: 900, height: 600 }, { width: 375, height: 740 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: '纯预览', exact: true }).click();
    const pane = (await page.locator('.preview-scroll').boundingBox())!;
    const paper = (await page.locator('.markdown-body').boundingBox())!;
    const table = (await page.locator('.markdown-body table').boundingBox())!;
    expect(paper.width).toBeGreaterThan(pane.width - 24);
    expect(table.width).toBeGreaterThan(paper.width * .88);
    await page.getByRole('button', { name: '纯编辑', exact: true }).click();
    await expect(ai).toContainText('AI 助手');
    await expect(ai).toBeInViewport({ ratio: .99 });
    await ai.click();
    await page.getByRole('button', { name: '文档问答', exact: true }).click();
    await expect(page.locator('#document-question')).toBeInViewport();
    await page.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
    await expect(ai).toBeFocused();
    await expect(page.getByRole('button', { name: '纯编辑', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '专注写作', exact: true }).click();
    await ai.click();
    await expect(page.locator('#document-question')).toBeInViewport();
    await page.locator('#document-question').press('Escape');
    await expect(page.locator('#document-question')).toBeHidden();
    await page.getByRole('button', { name: '退出专注', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  }
});

async function assertFillsPane(preview: Locator) {
  const stage = preview.locator('.mermaid-canvas');
  await expect(stage).toBeVisible();
  const panel = (await preview.boundingBox())!;
  const canvas = (await stage.boundingBox())!;
  expect(Math.abs(panel.y + panel.height - canvas.y - canvas.height)).toBeLessThan(3);
  expect(canvas.height).toBeGreaterThan(panel.height - 92);
  const frame = (await stage.locator('.mermaid-inline-frame').boundingBox())!;
  expect(frame.height).toBeLessThanOrEqual(canvas.height);
  expect(Math.abs(frame.y + frame.height / 2 - canvas.y - canvas.height / 2)).toBeLessThan(3);
}

test('diagram AI fills its desktop pane and gives instructions or preview the full height on narrow screens', async ({ page }) => {
  await launchDocument(page, source);
  await openDiagram(page);
  const workbench = page.locator('.mermaid-workbench');
  await workbench.locator('.workbench-tabs button').nth(2).click();
  const preview = workbench.locator('.workbench-main > .workbench-preview');
  await workbench.getByLabel('描述你想要的图').fill('Synthetic instruction draft');
  for (const viewport of [{ width: 1500, height: 1000 }, { width: 900, height: 600 }, { width: 390, height: 740 }, { width: 740, height: 390 }]) {
    await page.setViewportSize(viewport);
    if (viewport.width <= 760) {
      await workbench.locator('.workbench-compact-panes').getByRole('button', { name: '草稿预览' }).click();
      const main = (await workbench.locator('.workbench-main').boundingBox())!;
      expect((await preview.boundingBox())!.height).toBeGreaterThan(main.height - 2);
    }
    await assertFillsPane(preview);
    const svg = preview.locator('.mermaid-svg > svg');
    await preview.getByRole('button', { name: '原始大小' }).click();
    const actual = await svg.evaluate(el => ({ width: el.getBoundingClientRect().width, expected: (el as SVGSVGElement).viewBox.baseVal.width }));
    expect(Math.abs(actual.width - actual.expected)).toBeLessThan(1);
    await preview.getByRole('button', { name: /重置图表缩放/ }).click();
    await preview.getByRole('button', { name: '手动编辑' }).click();
    const field = preview.locator('textarea');
    await expect(field).toBeInViewport();
    const box = (await field.boundingBox())!;
    const heading = (await preview.locator('.workbench-ai-editor-heading').boundingBox())!;
    const validation = (await preview.locator('.workbench-ai-validation').boundingBox())!;
    expect(Math.abs(box.y - heading.y - heading.height)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height - validation.y)).toBeLessThan(2);
    expect(box.height).toBeGreaterThan(40);
    await preview.getByRole('button', { name: '返回预览' }).click();
    await expect(workbench.locator('.workbench-footer .confirm-button')).toBeInViewport({ ratio: .99 });
    if (viewport.width <= 760) {
      await workbench.getByRole('button', { name: 'AI 指令', exact: true }).click();
      await expect(workbench.getByLabel('描述你想要的图')).toHaveValue('Synthetic instruction draft');
    }
  }
});
