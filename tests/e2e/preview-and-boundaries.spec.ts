import { test, expect } from '@playwright/test';
import { draftSource, fixture, launchDocument, mod, savedSource } from './helpers';

test('code copy reports clipboard rejection and recovers with exact displayed text', async ({ page }) => {
  const source = '# Synthetic clipboard test\n\n```synthetic-unknown\nplain <marker> & text\n    preserved indentation\n```\n';
  await launchDocument(page, source);
  await page.evaluate(() => {
    const w = window as any;
    w.rejectCodeClipboard = true;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => {
      if (w.rejectCodeClipboard) throw new Error('Synthetic clipboard denial');
      w.copiedCodeText = text;
    } } });
  });
  const copy = page.locator('.preview-code-block button');
  await copy.click();
  await expect(copy).toHaveText('复制失败');
  await page.evaluate(() => { (window as any).rejectCodeClipboard = false; });
  await copy.click();
  await expect(copy).toHaveText('已复制');
  expect(await page.evaluate(() => (window as any).copiedCodeText)).toBe('plain <marker> & text\n    preserved indentation');
  expect(await savedSource(page)).toBe(source);
});

test('full Markdown fixture: real rendering, unique anchors, footnotes, sanitized HTML and image errors', async ({ page }, testInfo) => {
  await page.route('https://raw.githubusercontent.com/**', route => route.abort());
  const original = fixture('full-coverage.md');
  await launchDocument(page, original);
  const preview = page.locator('.preview-pane');
  await expect(preview.locator('.mermaid-svg svg')).toHaveCount(11);
  await expect(preview.locator('.mermaid-error')).toHaveCount(0);
  const ids = await preview.locator('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]').evaluateAll(nodes => nodes.map(n => n.id));
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain('重复标题');
  expect(ids).toContain('重复标题-1');
  await expect(preview.locator('blockquote blockquote')).toBeVisible();
  await expect(preview.locator('table').first()).toBeVisible();
  await expect(preview.locator('[data-footnotes]')).toHaveCount(1);
  await expect(preview.locator('input[type=checkbox]').first()).toBeDisabled();
  await expect(preview.locator('script,[onclick],[style*="position: fixed"]')).toHaveCount(0);
  await expect(preview.getByText('行内公式 $E = mc^2$', { exact: false })).toBeVisible();
  await preview.getByText('可展开说明', { exact: true }).click();
  await expect(preview.getByText('HTML 粗体', { exact: true })).toBeVisible();
  await expect(preview.getByRole('img', { name: '本地 PNG：中文 空格', exact: true })).toBeVisible();
  await expect(preview.getByText('远程 PNG：联网观察项 — 桌面应用不加载远程图片，请将图片保存到文档附近并使用相对路径', { exact: true })).toBeVisible();
  await expect(preview.locator('img[src^="https://"]')).toHaveCount(0);
  await expect(preview.getByText('故意缺失本地图片 — 图片加载失败，请检查路径和文件是否存在', { exact: true })).toBeVisible();
  await preview.getByRole('link', { name: '缺失锚点', exact: true }).click();
  await expect(preview.getByText('未找到对应的文档标题', { exact: true })).toBeVisible();
  await preview.getByRole('link', { name: '重复标题二', exact: true }).click();
  await expect(preview.getByText('未找到对应的文档标题', { exact: true })).toHaveCount(0);
  await expect.poll(async () => {
    const heading = await preview.locator('[id="重复标题-1"]').boundingBox();
    const viewport = await page.locator('.preview-scroll').boundingBox();
    return !!heading && !!viewport && heading.y >= viewport.y && heading.y < viewport.y + 80;
  }).toBe(true);
  expect(await savedSource(page)).toBe(original);
  await testInfo.attach('heading-ids', { body: JSON.stringify(ids), contentType: 'application/json' });
});

test('invalid Mermaid: failure leaves following prose and correcting source recovers', async ({ page }) => {
  const original = fixture('invalid-mermaid.md');
  await launchDocument(page, original);
  await expect(page.locator('.preview-pane .mermaid-error')).toHaveCount(4);
  await expect(page.getByText('END-OF-INVALID-FIXTURE', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: '在可视化画布中编辑图表', exact: true }).first().click();
  await draftSource(page);
  const source = page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true });
  await source.fill('flowchart LR\n  A[恢复] --> B[正常]');
  await expect(page.locator('.workbench-preview .mermaid-svg svg')).toHaveCount(1);
  await page.getByRole('button', { name: '应用到文档', exact: true }).click();
  await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
  await expect(page.locator('.preview-pane .mermaid-error')).toHaveCount(3);
  expect(await savedSource(page)).toBe(original.replace('flowchart TD\n  A[未闭合节点', 'flowchart LR\n  A[恢复] --> B[正常]'));
});

test('empty draft cannot replace a document diagram and can recover', async ({ page }) => {
  const original = fixture('diagrams/01-basic-flowchart.md');
  await launchDocument(page, original);
  await page.getByRole('button', { name: '在可视化画布中编辑图表', exact: true }).click();
  const before = await draftSource(page);
  await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill('');
  await page.getByRole('button', { name: '应用到文档', exact: true }).click();
  await expect(page.locator('.mermaid-workbench')).toBeVisible();
  await expect(page.getByText('图表源码不能为空', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(before);
  await page.getByRole('button', { name: '应用到文档', exact: true }).click();
  await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
  expect(await savedSource(page)).toBe(original);
});

test('unsupported visual syntax stays read-only and source/apply is lossless', async ({ page }) => {
  const original = fixture('readonly-mermaid.md');
  await launchDocument(page, original);
  await expect(page.locator('.preview-pane .mermaid-svg svg')).toHaveCount(3);
  for (let index = 0; index < 3; index++) {
    await page.getByRole('button', { name: '在可视化画布中编辑图表', exact: true }).nth(index).click();
    await expect(page.getByText('当前图表仅支持只读预览', { exact: true })).toBeVisible();
    await expect(page.locator('.mermaid-canvas-node')).toHaveCount(0);
    const source = await draftSource(page);
    expect(original).toContain(source);
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
    expect(await savedSource(page)).toBe(original);
  }
});

test('1000-node graph hits a recoverable edge limit without losing document content', async ({ page }) => {
  const original = fixture('oversized-diagram-1000.md');
  await launchDocument(page, original);
  await expect(page.locator('.preview-pane .mermaid-error')).toBeVisible();
  await expect(page.locator('.preview-pane .mermaid-error')).toContainText(/edge|max|边/i);
  expect(await savedSource(page)).toBe(original);
  await page.getByRole('button', { name: '纯编辑', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText('# 错误后编辑仍可用');
  expect(await savedSource(page)).toBe('# 错误后编辑仍可用');
});

test('diagram zoom/reset/fullscreen/keyboard exit and clipboard rejection feedback', async ({ page }) => {
  await launchDocument(page, fixture('diagrams/01-basic-flowchart.md'));
  await expect(page.locator('.mermaid-svg svg')).toHaveCount(1);
  await page.getByRole('button', { name: '放大图表', exact: true }).click();
  await expect(page.getByRole('button', { name: '重置图表缩放，当前 115%', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重置图表缩放，当前 115%', exact: true }).click();
  await page.getByRole('button', { name: '全屏查看图表', exact: true }).click();
  await expect(page.locator('.mermaid-fullscreen-dialog')).toBeVisible();
  await page.getByRole('button', { name: '放大全屏图表', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.mermaid-fullscreen-dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '全屏查看图表', exact: true })).toBeFocused();
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }); });
  await page.getByRole('button', { name: '复制 Mermaid 源码', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '复制失败' })).toBeVisible();
});
