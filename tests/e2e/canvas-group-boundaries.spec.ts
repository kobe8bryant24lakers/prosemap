import { expect, test } from '@playwright/test';
import { parseMermaidVisualSource } from '../../lib/mermaid-workbench';
import fixtures from '../fixtures/canvas-group-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

for (const item of fixtures.templates) {
  test(`${item.template}: a long quoted group name agrees in canvas, source and preview`, async ({ page }) => {
    await launchDocument(page, `# SYNTHETIC group name\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    await page.locator('.canvas-groups-panel summary').click();
    const label = 'SYNTHETIC 中文长名称 "订购与履约服务边界"';
    await page.getByRole('textbox', { name: '分组名称 SyntheticMiddle', exact: true }).fill(label);
    await expect(page.locator('.canvas-group-boundary > span').filter({ hasText: label })).toHaveCount(1);
    const changed = await draftSource(page);
    const before = parseMermaidVisualSource(item.source)!;
    const after = parseMermaidVisualSource(changed)!;
    expect(after.data!.groups!.find(group => group.id === 'SyntheticMiddle')!.label).toBe(label);
    expect(after.nodes).toEqual(before.nodes);
    expect(after.edges).toEqual(before.edges);
    await expect(page.locator('.workbench-preview .mermaid-svg svg')).toContainText(label);
    await expect(page.locator('.workbench-preview .mermaid-error')).toHaveCount(0);
    await showCanvas(page);
    await page.locator('.history-tools button').first().click();
    expect(await draftSource(page)).toBe(item.source);
    await showCanvas(page);
    await page.locator('.history-tools button').nth(1).click();
    expect(await draftSource(page)).toBe(changed);
  });

  test(`${item.template}: empty group names show an error without changing source or history`, async ({ page }) => {
    await launchDocument(page, `# SYNTHETIC empty group name\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    await page.locator('.canvas-groups-panel summary').click();
    const input = page.getByRole('textbox', { name: '分组名称 SyntheticMiddle', exact: true });
    for (const value of ['', '   ']) {
      await input.fill(value);
      await expect(page.locator('.workbench-footer .error')).toContainText('名称不能为空');
      await expect(page.getByRole('button', { name: '应用到文档', exact: true })).toBeDisabled();
      await expect(input).toHaveValue('SYNTHETIC Middle');
      await expect(page.locator('.history-tools button').first()).toBeDisabled();
      expect(await draftSource(page)).toBe(item.source);
      await showCanvas(page);
    }
    await input.fill('SYNTHETIC Recovered');
    await expect(page.locator('.workbench-footer .error')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '应用到文档', exact: true })).toBeEnabled();
    const recovered = await draftSource(page);
    expect(parseMermaidVisualSource(recovered)!.data!.groups!.find(group => group.id === 'SyntheticMiddle')!.label).toBe('SYNTHETIC Recovered');
    await expect(page.locator('.workbench-preview .mermaid-svg svg')).toContainText('SYNTHETIC Recovered');
    await showCanvas(page);
    await page.locator('.history-tools button').first().click();
    expect(await draftSource(page)).toBe(item.source);
  });
}
