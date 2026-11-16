import { expect, test } from '@playwright/test';
import { draftSource, editorSource, launchDocument, openDiagram, savedSource, showCanvas } from './helpers';

const sequence = 'sequenceDiagram\n  participant A as Synthetic A\n  participant B as Synthetic B\n  A->>B: Synthetic first\n  loop Synthetic loop\n    A->>B: Synthetic second\n    %% SYNTHETIC preserved\n    B-->>A: Synthetic third\n  end\n  B-->>A: Synthetic last';
const markdown = (s: string) => `# SYNTHETIC queued polish\n\n\`\`\`mermaid\n${s}\n\`\`\`\n\n${'Synthetic body paragraph.\n\n'.repeat(80)}`;

for (const [name, from, to] of [['single', 0, 5], ['multi reverse', 16, 0], ['line boundary', 0, 6]] as const) {
  test(`indent toolbar preserves ${name} selection, outdent and history`, async ({ page }) => {
    const source = 'alpha\nbeta\ngamma\n';
    await launchDocument(page, source, 'synthetic-indent.md');
    await page.locator('.cm-content').evaluate((el, range) => {
      const view = (el as any).cmTile.root.view;
      view.dispatch({ selection: { anchor: range.from, head: range.to } }); view.focus();
    }, { from, to });
    const selection = () => page.locator('.cm-content').evaluate(el => {
      const view = (el as any).cmTile.root.view;
      return { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head };
    });
    await page.getByRole('button', { name: '增加缩进', exact: true }).click();
    const expected = name === 'multi reverse' ? '  alpha\n  beta\n  gamma\n' : '  alpha\nbeta\ngamma\n';
    expect(await editorSource(page)).toBe(expected);
    await expect(page.locator('.cm-content')).toBeFocused();
    expect(await selection()).toEqual(name === 'multi reverse' ? { anchor: 22, head: 2 } : { anchor: 2, head: to + 2 });
    await page.getByRole('button', { name: '减少缩进', exact: true }).click();
    expect(await editorSource(page)).toBe(source);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(await editorSource(page)).toBe(expected);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect(await editorSource(page)).toBe(source);
    await page.getByRole('button', { name: '减少缩进', exact: true }).click();
    expect(await editorSource(page)).toBe(source);
  });
}

for (const slot of [1, 2, 3]) {
  test(`sequence drag inserts at slot ${slot}, preserves directives and undo`, async ({ page }) => {
    await launchDocument(page, markdown(sequence)); await openDiagram(page);
    await page.locator('.canvas-fit-button').click();
    const labels = page.locator('.canvas-edge-label');
    const a = (await labels.nth(slot - 1).boundingBox())!;
    const b = (await labels.nth(slot).boundingBox())!;
    const y = (a.y + a.height / 2 + b.y + b.height / 2) / 2;
    const line = (id: string) => page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"] .canvas-sequence-lifeline-connector`);
    const start = (await line('A').boundingBox())!, end = (await line('B').boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, y); await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, y, { steps: 6 }); await page.mouse.up();
    const input = page.locator('.canvas-edge-label input'); await expect(input).toBeFocused();
    await input.fill('Synthetic inserted'); await input.press('Enter');
    const target = ['    A->>B: Synthetic second', '    B-->>A: Synthetic third', '  B-->>A: Synthetic last'][slot - 1];
    const expected = sequence.replace(target, `${target.match(/^\s*/)![0]}A->>B: Synthetic inserted\n${target}`);
    expect(await draftSource(page)).toBe(expected);
    await showCanvas(page);
    await page.locator('.history-tools button').nth(0).click(); // undo rename
    await page.locator('.history-tools button').nth(0).click(); // undo insertion
    expect(await draftSource(page)).toBe(sequence);
    await showCanvas(page);
    await page.locator('.history-tools button').nth(1).click(); await page.locator('.history-tools button').nth(1).click();
    expect(await draftSource(page)).toBe(expected);
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.preview-pane .mermaid-svg svg')).toBeVisible();
    expect(await savedSource(page)).toBe(markdown(expected));
    await page.getByRole('button', { name: '撤销', exact: true }).click(); expect(await savedSource(page)).toBe(markdown(sequence));
  });
}

for (const fullscreen of [false, true]) {
  test(`preview ${fullscreen ? 'fullscreen' : 'inline'} wheel, pan, controls and body scroll`, async ({ page }) => {
    await launchDocument(page, markdown('flowchart LR\n A[Synthetic first] --> B[Synthetic middle] --> C[Synthetic last]'));
    await expect(page.locator('.mermaid-svg > svg')).toBeVisible();
    if (fullscreen) { await page.getByRole('button', { name: '全屏查看图表', exact: true }).click(); }
    const stage = page.locator(fullscreen ? '.mermaid-fullscreen-stage' : '.mermaid-canvas');
    const svg = stage.locator('svg').first(); await expect(svg).toBeVisible();
    const before = (await svg.boundingBox())!;
    await stage.hover(); await page.mouse.wheel(0, -180);
    await expect.poll(async () => (await svg.boundingBox())!.width).toBeGreaterThan(before.width + 5);
    const enlarged = (await svg.boundingBox())!;
    const box = (await stage.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + Math.min(box.height / 2, 160);
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 100, y + 60, { steps: 5 }); await page.mouse.up();
    await expect.poll(async () => (await svg.boundingBox())!.x).toBeGreaterThan(enlarged.x + 90);
    expect((await svg.boundingBox())!.y).toBeGreaterThan(enlarged.y + 50);
    await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
    await page.getByRole('button', { name: fullscreen ? /^重置全屏图表，当前/ : /^重置图表缩放，当前/ }).click();
    if (fullscreen) await page.keyboard.press('Escape');
    const pane = page.locator('.preview-scroll');
    const body = page.locator('.preview-pane p').filter({ hasText: 'Synthetic body paragraph.' }).first();
    await body.scrollIntoViewIfNeeded(); const scroll = await pane.evaluate(el => el.scrollTop);
    await body.hover(); await page.mouse.wheel(0, 250);
    await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBeGreaterThan(scroll);
  });
}
