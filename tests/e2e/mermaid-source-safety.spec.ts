import { expect, test } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, savedSource } from './helpers';

const originalSource = 'flowchart LR\n  A["SyntheticAlpha"] --> B["SyntheticBeta"]';
const originalDocument = `# Synthetic source safety\n\n\`\`\`mermaid\n${originalSource}\n\`\`\`\n\nSYNTHETIC_END\n`;
const navigableAnchor = 'a[href], a[xlink\\:href], a[target], a[tabindex], a[role="link"]';
const cases = [
  {
    name: 'click URL',
    source: `${originalSource}\n  click A "https://example.invalid/synthetic-click-probe"`,
    error: '不支持可点击链接指令',
    clickPreview: true,
  },
  {
    name: 'HTML event attribute',
    source: 'flowchart LR\n  A["<svg onload=alert(123456)></svg>SyntheticAlpha"] --> B["SyntheticBeta"]',
    error: '不支持 HTML 标签',
  },
  {
    name: 'HTML script element',
    source: 'flowchart LR\n  A["<script>alert(123456)</script>SyntheticAlpha"] --> B["SyntheticBeta"]',
    error: '不支持 HTML 标签',
  },
  {
    name: 'JavaScript link directive',
    source: `${originalSource}\n  click A "javascript:alert(123456)"`,
    error: '不支持可点击链接指令',
    clickPreview: true,
  },
  {
    name: 'JavaScript HTML link',
    source: 'flowchart LR\n  A["<a href=javascript:alert(123456)>SyntheticAlpha</a>"] --> B["SyntheticBeta"]',
    error: '不支持 HTML 标签',
  },
  {
    name: 'JavaScript URL in label',
    source: 'flowchart LR\n  A["javascript:alert(123456)"] --> B["SyntheticBeta"]',
    error: '不支持 JavaScript 链接',
  },
];

for (const item of cases) {
  test(`${item.name}: preview is inert, apply rejects, and the complete draft can recover`, async ({ page }) => {
    const dialogs: string[] = [];
    const popups: string[] = [];
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    page.on('popup', async popup => { popups.push(popup.url()); await popup.close(); });
    await page.route('https://example.invalid/**', route => route.abort());
    await launchDocument(page, originalDocument, 'synthetic-source-safety.md');
    await openDiagram(page);
    await draftSource(page);
    const textarea = page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true });
    await textarea.fill(item.source);
    const preview = page.locator('.workbench-preview');
    await expect(preview.locator('.mermaid-svg svg, .mermaid-error').first()).toBeVisible();
    await expect(preview.locator(navigableAnchor)).toHaveCount(0);
    await expect(preview.locator('script, iframe, object, embed, [onload], [onerror], [onclick]')).toHaveCount(0);
    const unsafeHrefs = await preview.locator('*').evaluateAll(elements => elements.flatMap(element =>
      [...element.attributes].filter(attribute => /^(?:xlink:)?href$/i.test(attribute.name) && /^\s*javascript\s*:/i.test(attribute.value)).map(attribute => attribute.value)));
    expect(unsafeHrefs).toEqual([]);
    if (item.clickPreview) {
      const anchor = preview.locator('a').first();
      if (await anchor.count()) await anchor.click();
      else await preview.getByText('SyntheticAlpha', { exact: true }).click();
    }
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.workbench-footer')).toContainText(item.error);
    await expect(textarea).toHaveValue(item.source);
    expect(dialogs).toEqual([]);
    expect(popups).toEqual([]);
    expect(await page.evaluate(() => (window as any).__acceptance.calls.filter((call: { command: string }) => call.command === 'open_external_url'))).toEqual([]);
    await textarea.fill(originalSource);
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
    expect(await savedSource(page)).toBe(originalDocument);
  });
}

test('imported click directives remain inert in inline and fullscreen previews', async ({ page }) => {
  const source = `${originalSource}\n  click A "https://example.invalid/synthetic-imported-probe"`;
  const document = originalDocument.replace(originalSource, source);
  await page.route('https://example.invalid/**', route => route.abort());
  await launchDocument(page, document, 'synthetic-imported-link.md');
  const inline = page.locator('.preview-pane .mermaid-svg');
  await expect(inline.locator('svg')).toBeVisible();
  await expect(inline.locator(navigableAnchor)).toHaveCount(0);
  const before = await inline.getByText('SyntheticAlpha', { exact: true }).boundingBox();
  const other = await inline.getByText('SyntheticBeta', { exact: true }).boundingBox();
  expect(before).not.toBeNull();
  expect(other).not.toBeNull();
  expect(before!.x + before!.width).toBeLessThan(other!.x);
  await inline.getByText('SyntheticAlpha', { exact: true }).click();
  await page.getByRole('button', { name: '全屏查看图表', exact: true }).click();
  const fullscreen = page.locator('.mermaid-fullscreen-dialog');
  await expect(fullscreen.locator('.mermaid-fullscreen-svg svg')).toBeVisible();
  await expect(fullscreen.locator(navigableAnchor)).toHaveCount(0);
  await fullscreen.getByText('SyntheticAlpha', { exact: true }).click();
  await expect(fullscreen).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await savedSource(page)).toBe(document);
});
