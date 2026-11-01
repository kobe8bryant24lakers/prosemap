import { expect, test } from '@playwright/test';
import fixtures from '../fixtures/canvas-navigation-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram, savedSource } from './helpers';

function invalidSource(kind: string, source: string) {
  if (kind === 'flowchart') return source.replace('"]', '"');
  if (kind === 'sequence') return source.replace('User->>App: Synthetic_EdgeBase', 'User->>App');
  if (kind === 'state') return source.replace('"Synthetic_NodeBase"', '"Synthetic_NodeBase');
  if (kind === 'class' || kind === 'er') return source.replace('}', '');
  // Mermaid accepts a single closing parenthesis here; remove required child
  // indentation instead, creating a second root that the parser must reject.
  if (kind === 'mindmap') return source.replace('    Mind5', '  Mind5');
  if (kind === 'gantt') return source.replace('Synthetic_NodeBase :', 'Synthetic_NodeBase ');
  throw new Error(`Missing synthetic invalid case: ${kind}`);
}

for (const item of fixtures.templates) {
  test(`${item.template}: syntax error preserves the complete draft and document, then corrected source applies`, async ({ page }, testInfo) => {
    const original = `# SYNTHETIC source errors\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n\nSYNTHETIC_END\n`;
    await launchDocument(page, original);
    const beforeText = await page.locator('.cm-content').innerText();
    await openDiagram(page);
    await draftSource(page);
    const input = page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true });
    const broken = invalidSource(item.kind, item.source);
    expect(broken).not.toBe(item.source);
    await input.fill(broken);
    const preview = page.locator('.workbench-preview');
    await expect(preview.locator('.mermaid-error')).toBeVisible();
    await expect(preview.locator('.mermaid-svg svg')).toHaveCount(0);
    const renderError = await preview.locator('.mermaid-error').innerText();
    expect(renderError.trim()).not.toBe('');
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.workbench-footer .error')).toBeVisible();
    await expect(input).toHaveValue(broken);
    expect(await page.locator('.cm-content').innerText()).toBe(beforeText);

    const corrected = item.source.replace('Synthetic_NodeBase', '合成修复成功');
    await input.fill(corrected);
    await expect(preview.locator('.mermaid-error')).toHaveCount(0);
    await expect(preview.locator('.mermaid-svg svg')).toContainText('合成修复成功');
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
    expect(await savedSource(page)).toBe(original.replace(item.source, corrected));
    await testInfo.attach('synthetic-error-recovery', {
      body: JSON.stringify({ broken, corrected, renderError }), contentType: 'application/json',
    });
  });
}
