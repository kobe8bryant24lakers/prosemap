import { expect, test, type Page } from '@playwright/test';
import { launchDocument, savedSource } from './helpers';

const oldValid = 'flowchart LR\n%% SYNTHETIC_HOLD\nA[SYNTHETIC_OLD] --> B[End]';
const oldInvalid = 'SYNTHETIC_INVALID\n%% SYNTHETIC_HOLD';
const latestValid = 'flowchart LR\nA[SYNTHETIC_LATEST] --> B[End]';
const latestInvalid = 'SYNTHETIC_LATEST_INVALID';
const documentFor = (source: string) => `# Synthetic render delivery\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nSYNTHETIC_TAIL\n`;

// Keep real Mermaid parsing/rendering. Delay delivery of exactly one completed
// result to React, so the test controls completion order without a slow CPU.
// This is browser fault injection, not installed native acceptance evidence.
async function holdFirstRender(page: Page) {
  await page.addInitScript(() => {
    (window as any).__renderRace = { remaining: 1, events: [], ready: false };
  });
  await page.route(/\/lib\/mermaid-runtime\.ts(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    const body = await response.text();
    const signature = 'export async function renderMermaid(id, source)';
    expect(body).toContain(signature);
    await route.fulfill({ response, body: body.replace(signature, 'async function renderMermaidUncontrolled(id, source)') + `
export async function renderMermaid(id, source) {
  const state = window.__renderRace;
  const held = source.includes('SYNTHETIC_HOLD') && state.remaining-- > 0;
  state.events.push({ phase: 'started', id, source, held });
  let result, error, failed = false;
  try { result = await renderMermaidUncontrolled(id, source); }
  catch (reason) { error = reason; failed = true; }
  if (held) {
    state.events.push({ phase: 'held', id, source, failed });
    await new Promise(resolve => { state.release = resolve; state.ready = true; });
  }
  state.events.push({ phase: 'delivered', id, source, held, failed });
  if (failed) throw error;
  return result;
}
` });
  });
}

async function expectHeld(page: Page, failed: boolean) {
  await expect.poll(() => page.evaluate(() => (window as any).__renderRace.ready)).toBe(true);
  const events = await page.evaluate(() => (window as any).__renderRace.events);
  expect(events.filter((event: any) => event.phase === 'held')).toHaveLength(1);
  expect(events.find((event: any) => event.phase === 'held').failed).toBe(failed);
  expect(events.some((event: any) => event.phase === 'delivered' && event.held)).toBe(false);
  await expect(page.locator('.preview-pane .mermaid-loading')).toHaveCount(1);
}

async function assertLateDeliveryCannotChangePreview(page: Page) {
  const before = await page.locator('.preview-pane').evaluate(preview => {
    const snapshot = () => ({
      svg: preview.querySelector('.mermaid-svg')?.innerHTML ?? '',
      error: preview.querySelector('.mermaid-error')?.textContent ?? '',
      loading: preview.querySelectorAll('.mermaid-loading').length,
    });
    const state = (window as any).__renderRace;
    state.snapshots = [snapshot()];
    state.observer = new MutationObserver(() => state.snapshots.push(snapshot()));
    state.observer.observe(preview, { subtree: true, childList: true, characterData: true, attributes: true });
    return snapshot();
  });
  await page.evaluate(() => (window as any).__renderRace.release());
  await expect.poll(() => page.evaluate(() => (window as any).__renderRace.events.some((event: any) => event.phase === 'delivered' && event.held))).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const evidence = await page.evaluate(() => {
    const state = (window as any).__renderRace;
    state.observer.disconnect();
    return { events: state.events, snapshots: state.snapshots };
  });
  const deliveries = evidence.events.filter((event: any) => event.phase === 'delivered');
  expect(deliveries.at(-1).held).toBe(true);
  expect(deliveries.some((event: any) => !event.held)).toBe(true);
  for (const snapshot of evidence.snapshots) expect(snapshot).toEqual(before);
  await expect(page.locator('.preview-pane .mermaid-loading')).toHaveCount(0);
  await test.info().attach('controlled-render-delivery', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
}

for (const oldOutcome of ['success', 'error'] as const) {
  for (const latestOutcome of ['success', 'error'] as const) {
    test(`inline preview: late old ${oldOutcome} cannot replace latest ${latestOutcome}`, async ({ page }) => {
      await holdFirstRender(page);
      await launchDocument(page, documentFor(oldOutcome === 'success' ? oldValid : oldInvalid));
      await expectHeld(page, oldOutcome === 'error');
      const latest = documentFor(latestOutcome === 'success' ? latestValid : latestInvalid);
      await page.locator('.cm-content').fill(latest);
      if (latestOutcome === 'success') {
        await expect(page.locator('.preview-pane .mermaid-svg')).toContainText('SYNTHETIC_LATEST');
        await expect(page.locator('.preview-pane .mermaid-error')).toHaveCount(0);
      } else {
        await expect(page.locator('.preview-pane .mermaid-error')).toContainText('SYNTHETIC_LATEST_INVALID');
        await expect(page.locator('.preview-pane .mermaid-svg')).toHaveCount(0);
      }
      await assertLateDeliveryCannotChangePreview(page);
      await expect(page.locator('.preview-pane')).toContainText('SYNTHETIC_TAIL');
      expect(await savedSource(page)).toBe(latest);
    });
  }
}

test('inline preview: A to B to A keeps the newest render instance when first A arrives last', async ({ page }) => {
  await holdFirstRender(page);
  const original = documentFor(oldValid);
  await launchDocument(page, original);
  await expectHeld(page, false);
  await page.locator('.cm-content').fill(documentFor(latestValid));
  await expect(page.locator('.preview-pane .mermaid-svg')).toContainText('SYNTHETIC_LATEST');
  await page.locator('.cm-content').fill(original);
  await expect(page.locator('.preview-pane .mermaid-svg')).toContainText('SYNTHETIC_OLD');
  const newestId = await page.locator('.preview-pane .mermaid-svg svg').getAttribute('id');
  const heldId = await page.evaluate(() => (window as any).__renderRace.events.find((event: any) => event.phase === 'held').id);
  expect(newestId).not.toBe(heldId);
  await assertLateDeliveryCannotChangePreview(page);
  await expect(page.locator('.preview-pane .mermaid-svg svg')).toHaveAttribute('id', newestId!);
  expect(await savedSource(page)).toBe(original);
});

test('inline preview: late old render cannot reappear after removing and replacing its diagram', async ({ page }) => {
  await holdFirstRender(page);
  await launchDocument(page, documentFor(oldValid));
  await expectHeld(page, false);
  await page.locator('.cm-content').fill('# Synthetic diagram removed\n\nSYNTHETIC_TAIL\n');
  await expect(page.locator('.preview-pane .mermaid-diagram')).toHaveCount(0);
  const latest = documentFor(latestValid);
  await page.locator('.cm-content').fill(latest);
  await expect(page.locator('.preview-pane .mermaid-svg')).toContainText('SYNTHETIC_LATEST');
  await assertLateDeliveryCannotChangePreview(page);
  expect(await savedSource(page)).toBe(latest);
});
