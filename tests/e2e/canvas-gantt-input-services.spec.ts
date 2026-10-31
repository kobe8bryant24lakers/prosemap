import { expect, test } from '@playwright/test';
import { draftSource, launchDocument, mod, openDiagram, showCanvas } from './helpers';

// Synthetic browser regression for semantic-input attributes and editing.
// macOS automatic replacement on blur still requires installed-app retesting.
const source = 'gantt\n  dateFormat YYYY-MM-DD\n  section Synthetic\n  A :a, 2026-10-01, until b\n  B :b, 2026-10-05, 1d\n  C :c, after b, 2d';
const cases = [
  {
    field: '任务 ID', original: 'b', value: 'bxyz', keys: ['x', 'y', 'z'], append: true,
    expected: source.replace('until b', 'until bxyz').replace('B :b,', 'B :bxyz,').replace('after b', 'after bxyz'),
  },
  {
    field: '开始', original: '2026-10-05', value: '2026-10-06', keys: [...'2026-10-06'], append: false,
    expected: source.replace('2026-10-05', '2026-10-06'),
  },
  {
    field: '工期 / 结束', original: '1d', value: '3h', keys: ['3', 'h'], append: false,
    expected: source.replace('1d', '3h'),
  },
];

for (const item of cases) {
  test(`Gantt ${item.field} opts out of text correction and preserves typed source through blur and history`, async ({ page }) => {
    await launchDocument(page, `# Synthetic Gantt text services\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`, 'synthetic-gantt-text-services.md');
    await openDiagram(page);
    await page.locator('.canvas-fit-button').click();
    await page.locator('.mermaid-canvas-node[data-mermaid-node-id="b"]').click();
    const input = page.getByRole('textbox', { name: item.field, exact: true });
    await expect(input).toHaveValue(item.original);
    await expect(input).toHaveAttribute('autocapitalize', 'none');
    await expect(input).toHaveAttribute('autocorrect', 'off');
    await expect(input).toHaveAttribute('spellcheck', 'false');
    await input.focus();
    await input.press(`${mod}+a`);
    if (item.append) await input.press('ArrowRight');
    else {
      await input.press('Backspace');
      await expect(input).toHaveValue('');
      await expect(input).toHaveAttribute('aria-invalid', 'true');
    }
    for (const key of item.keys) await input.press(key);
    await expect(input).toHaveValue(item.value);
    await expect(input).toHaveAttribute('aria-invalid', 'false');
    const canvas = page.getByRole('region', { name: 'Mermaid 可视化画布编辑器', exact: true });
    await canvas.focus();
    await expect(canvas).toBeFocused();
    await expect(input).toHaveValue(item.value);
    expect(await draftSource(page)).toBe(item.expected);
    await showCanvas(page);
    await page.locator('.history-tools button').first().click();
    await expect(input).toHaveValue(item.original);
    expect(await draftSource(page)).toBe(source);
    await showCanvas(page);
    await expect(page.locator('.history-tools button').first()).toBeDisabled();
    await page.locator('.history-tools button').nth(1).click();
    await expect(input).toHaveValue(item.value);
    expect(await draftSource(page)).toBe(item.expected);
  });
}
