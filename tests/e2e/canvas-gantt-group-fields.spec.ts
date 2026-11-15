import { expect, test } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, savedSource, showCanvas } from './helpers';

const source = `gantt
  title SYNTHETIC group changes
  dateFormat YYYY-MM-DD
  section Synthetic Alpha
  Alpha one :done, a1, 2026-01-01, 1d
  Alpha two :a2, after a1, 1d
  section Synthetic Beta
  Beta one :b1, 2026-01-01, 2d
  Beta two :b2, after b1, 1d`;

for (const action of ['add', 'move']) {
  test(`Gantt ${action}: an earlier section remains contiguous and the full source/history is preserved`, async ({ page }) => {
    const document = `# SYNTHETIC Gantt group changes\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`;
    await launchDocument(page, document);
    await openDiagram(page);
    await page.locator('.canvas-fit-button').click();
    const targetId = action === 'add' ? 'a1' : 'b2';
    await page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${targetId}"]`).click();
    if (action === 'add') {
      await page.getByTitle('添加普通任务', { exact: true }).click();
      await page.locator('.mermaid-canvas-node input').fill('SYNTHETIC Added');
      await page.locator('.mermaid-canvas-node input').press('Enter');
    } else {
      await page.getByRole('textbox', { name: '分组', exact: true }).fill('Synthetic Alpha');
      await page.getByRole('region', { name: 'Mermaid 可视化画布编辑器', exact: true }).focus();
    }
    const changed = await draftSource(page);
    const subjectId = action === 'add' ? 'Task5' : 'b2';
    const taskLine = action === 'add' ? '  SYNTHETIC Added :Task5, 2026-01-01, 1d' : '  Beta two :b2, after b1, 1d';
    const expected = (action === 'add' ? source : source.replace('\n' + taskLine, ''))
      .replace('  section Synthetic Beta', `${taskLine}\n  section Synthetic Beta`);
    expect(changed).toBe(expected);
    const preview = page.locator('.workbench-preview .mermaid-svg svg');
    await expect(preview.locator(`rect[id$="-${subjectId}"]`)).toBeVisible();
    const y = async (id: string) => Number(await preview.locator(`rect[id$="-${id}"]`).getAttribute('y'));
    expect(await y(subjectId)).toBeGreaterThan(await y('a2'));
    expect(await y(subjectId)).toBeLessThan(await y('b1'));
    await showCanvas(page);
    await page.locator('.history-tools button').first().click();
    // Naming the newly added task is a separate accepted label transaction.
    if (action === 'add') await page.locator('.history-tools button').first().click();
    expect(await draftSource(page)).toBe(source);
    await showCanvas(page);
    await page.locator('.history-tools button').nth(1).click();
    if (action === 'add') await page.locator('.history-tools button').nth(1).click();
    expect(await draftSource(page)).toBe(expected);
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    expect(await savedSource(page)).toBe(document.replace(source, expected));
  });
}
