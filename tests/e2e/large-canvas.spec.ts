import { expect, test } from '@playwright/test';
import { draftSource, fixture, launchDocument, openDiagram, savedSource, showCanvas } from './helpers';

test('300-node canvas: create, rename, drag, undo/redo, remove and exact document round-trip', async ({ page }, testInfo) => {
  const original = fixture('large-diagram-300.md');
  await launchDocument(page, original);
  await openDiagram(page);
  const nodes = page.locator('.mermaid-canvas-node');
  await expect(nodes).toHaveCount(300);
  await page.locator('.canvas-fit-button').click();
  await page.getByRole('button', { name: /^当前缩放.*点击重置$/ }).click();
  await page.getByRole('button', { name: '节点', exact: true }).click();
  await expect(nodes).toHaveCount(301);
  const input = page.locator('.mermaid-canvas-node input');
  await input.fill('大图新增_中文🧭');
  await input.press('Enter');
  const target = nodes.filter({ hasText: '大图新增_中文🧭' });
  await target.scrollIntoViewIfNeeded();
  const before = (await target.boundingBox())!;
  const stage = page.locator('.canvas-editor-stage');
  const origin = (await stage.boundingBox())!;
  // rAF intervals describe this headless test run, not a native-app FPS claim.
  await page.evaluate(() => {
    const w = window as any;
    w.__frameProbe = { active: true, gaps: [] as number[], last: 0 };
    const tick = (now: number) => {
      const state = w.__frameProbe;
      if (!state.active) return;
      if (state.last) state.gaps.push(now - state.last);
      state.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 40; step++) {
    await page.mouse.move(before.x + before.width / 2 + 120 * step / 40, before.y + before.height / 2 - 70 * step / 40);
  }
  await page.mouse.up();
  const metrics = await page.evaluate(() => {
    const state = (window as any).__frameProbe;
    state.active = false;
    const sorted = [...state.gaps].sort((a: number, b: number) => a - b);
    return { samples: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1), gapsOver50ms: sorted.filter((n: number) => n > 50).length };
  });
  await testInfo.attach('headless-drag-frame-intervals', { body: JSON.stringify(metrics), contentType: 'application/json' });
  const moved = (await target.boundingBox())!, movedStage = (await stage.boundingBox())!;
  expect(Math.abs((moved.x - movedStage.x) - (before.x - origin.x))).toBeGreaterThan(80);
  expect(Math.abs((moved.y - movedStage.y) - (before.y - origin.y))).toBeGreaterThan(40);
  await page.screenshot({ path: testInfo.outputPath('300-node-after-drag.png') });
  await page.locator('.history-tools button').nth(0).click();
  const restored = (await target.boundingBox())!, restoredStage = (await stage.boundingBox())!;
  expect(restored.x - restoredStage.x).toBeCloseTo(before.x - origin.x, 0);
  expect(restored.y - restoredStage.y).toBeCloseTo(before.y - origin.y, 0);
  await page.locator('.history-tools button').nth(1).click();
  const redone = (await target.boundingBox())!, redoneStage = (await stage.boundingBox())!;
  expect(redone.x - redoneStage.x).toBeCloseTo(moved.x - movedStage.x, 0);
  expect(redone.y - redoneStage.y).toBeCloseTo(moved.y - movedStage.y, 0);
  await target.click();
  await page.locator('.canvas-context-bar').getByRole('button', { name: '删除', exact: true }).click();
  await expect(nodes).toHaveCount(300);
  await page.getByRole('button', { name: '应用到文档', exact: true }).click();
  await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
  expect(await savedSource(page)).toBe(original);
});

test('inline node labels containing edge syntax preserve original spelling through rename and history', async ({ page }) => {
  const original = '# 行内源码\n\n```mermaid\ngraph LR\n  %% 原注释\n  A[入口]  -->|路线| B([处理])\n```\n尾部不变\n';
  await launchDocument(page, original);
  await openDiagram(page);
  const target = page.locator('.mermaid-canvas-node[data-mermaid-node-id="A"]');
  await target.dblclick();
  await target.locator('input').fill('分支 --> 下一步');
  await target.locator('input').press('Enter');
  const source = await draftSource(page);
  expect(source).toBe('graph LR\n  %% 原注释\n  A["分支 --> 下一步"]  -->|路线| B([处理])');
  await showCanvas(page);
  await page.locator('.history-tools button').nth(0).click();
  expect(await draftSource(page)).toBe('graph LR\n  %% 原注释\n  A[入口]  -->|路线| B([处理])');
  await showCanvas(page);
  await page.locator('.history-tools button').nth(1).click();
  await page.getByRole('button', { name: '应用到文档', exact: true }).click();
  await expect(page.locator('.preview-pane .mermaid-svg svg')).toHaveCount(1);
  expect(await savedSource(page)).toBe(original.replace('A[入口]', 'A["分支 --> 下一步"]'));
});
