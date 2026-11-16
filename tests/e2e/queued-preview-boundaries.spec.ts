import { expect, test } from '@playwright/test';
import { editorSource, launchDocument } from './helpers';

const source = '# SYNTHETIC pan boundaries\n\n```mermaid\nflowchart LR\n A[Synthetic left] --> B[Synthetic middle] --> C[Synthetic right]\n```\n';

for (const fullscreen of [false, true]) {
  test(`${fullscreen ? 'fullscreen' : 'inline'} preview reveals clipped nodes, zooms out and resets`, async ({ page }) => {
    await launchDocument(page, source);
    if (fullscreen) await page.getByRole('button', { name: '全屏查看图表', exact: true }).click();
    const stage = page.locator(fullscreen ? '.mermaid-fullscreen-stage' : '.mermaid-canvas');
    const svg = stage.locator('svg').first(); await expect(svg).toBeVisible();
    const box = (await stage.boundingBox())!;
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const button = page.getByRole('button', { name: fullscreen ? '放大全屏图表' : '放大图表', exact: true });
    for (let i = 0; i < 6; i++) await button.click();
    const right = svg.locator('g.node').last();
    const clipped = (await right.boundingBox())!;
    expect(clipped.x + clipped.width).toBeGreaterThan(box.x + box.width);
    const dx = box.x + box.width - 30 - clipped.x - clipped.width;
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + dx, start.y, { steps: 8 }); await page.mouse.up();
    const revealed = (await right.boundingBox())!;
    expect(revealed.x).toBeGreaterThan(box.x);
    expect(revealed.x + revealed.width).toBeLessThan(box.x + box.width);
    const hit = await right.evaluate(el => {
      const r = el.getBoundingClientRect(); return !!el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(hit).toBe(true);
    const width = (await svg.boundingBox())!.width;
    await page.mouse.move(start.x, start.y); await page.mouse.wheel(0, 180);
    await expect.poll(async () => (await svg.boundingBox())!.width).toBeLessThan(width - 5);
    await page.getByRole('button', { name: fullscreen ? /^重置全屏图表，当前/ : /^重置图表缩放，当前/ }).click();
    const reset = (await svg.boundingBox())!;
    expect(Math.abs(reset.x + reset.width / 2 - box.x - box.width / 2)).toBeLessThan(2);
    if (fullscreen) await page.keyboard.press('Escape');
    else {
      await stage.dblclick();
      await expect(page.locator('.mermaid-workbench')).toBeVisible();
    }
  });
}

test('outdent preserves mixed whitespace content and caret-only indentation is undoable', async ({ page }) => {
  const source = ' Synthetic one\n\tSynthetic tab\nSynthetic plain\n\n';
  await launchDocument(page, source, 'synthetic-whitespace.md');
  await page.locator('.cm-content').evaluate(el => {
    const view = (el as any).cmTile.root.view;
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }); view.focus();
  });
  await page.getByRole('button', { name: '减少缩进', exact: true }).click();
  const outdented = await editorSource(page);
  expect(outdented.split('\n').map(line => line.trimStart())).toEqual(source.split('\n').map(line => line.trimStart()));
  expect(outdented.startsWith('Synthetic one\n')).toBe(true);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await editorSource(page)).toBe(source);
  await page.locator('.cm-content').evaluate(el => {
    const view = (el as any).cmTile.root.view;
    view.dispatch({ selection: { anchor: 2 } }); view.focus();
  });
  await page.getByRole('button', { name: '增加缩进', exact: true }).focus();
  await page.keyboard.press('Enter');
  expect(await editorSource(page)).toBe('  ' + source);
  await expect(page.locator('.cm-content')).toBeFocused();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await editorSource(page)).toBe(source);
});
