import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchDocument, openDiagram } from './helpers';

// Synthetic document; this browser regression uses the shared IPC fixture,
// not the installed native app.
const syntheticDocument = '# Synthetic zoom isolation\n\n```mermaid\nclassDiagram\n  class SyntheticA {\n    +String syntheticField\n  }\n  class SyntheticB\n  SyntheticA --> SyntheticB : syntheticRelation\n```\n';
const zoom = (page: Page) => page.locator('.canvas-zoom-value');
const contexts = ['property', 'node label', 'edge label', 'source'] as const;
type InputContext = typeof contexts[number];
type KeyObservation = { key: string; code: string; metaKey: boolean; ctrlKey: boolean; defaultPrevented: boolean; trusted: boolean };
type KeyWindow = Window & { __syntheticZoomKey?: KeyboardEvent };
const shortcuts = [
  { key: '+', expectedCanvasZoom: '100%' },
  { key: '=', expectedCanvasZoom: '100%' },
  { key: 'NumpadAdd', expectedCanvasZoom: '100%' },
  { key: '-', expectedCanvasZoom: '80%' },
  { key: '_', expectedCanvasZoom: '80%' },
  { key: 'NumpadSubtract', expectedCanvasZoom: '80%' },
  { key: '0', expectedCanvasZoom: '100%' },
  { key: 'Numpad0', expectedCanvasZoom: '100%' },
];

async function launchCanvas(page: Page) {
  await launchDocument(page, syntheticDocument, 'synthetic-zoom-isolation.md');
  await openDiagram(page);
  await page.evaluate(() => {
    // Observe real Playwright keyboard delivery without changing propagation.
    window.addEventListener('keydown', event => {
      if (!['Meta', 'Control', 'Shift', 'Alt'].includes(event.key)) (window as KeyWindow).__syntheticZoomKey = event;
    }, true);
  });
}

async function keyObservation(page: Page): Promise<KeyObservation> {
  return page.evaluate(() => {
    const event = (window as KeyWindow).__syntheticZoomKey!;
    return { key: event.key, code: event.code, metaKey: event.metaKey, ctrlKey: event.ctrlKey, defaultPrevented: event.defaultPrevented, trusted: event.isTrusted };
  });
}

const pageScale = (page: Page) => page.evaluate(() => ({
  scale: window.visualViewport?.scale ?? 1,
  devicePixelRatio: window.devicePixelRatio,
  innerWidth: window.innerWidth,
}));

async function paint(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function resetToNinetyPercent(page: Page) {
  await page.locator('.workbench-tabs').getByRole('button', { name: '画布', exact: true }).click();
  await zoom(page).click();
  await expect(zoom(page)).toHaveText('100%');
  await page.getByRole('button', { name: '缩小画布', exact: true }).click();
  await expect(zoom(page)).toHaveText('90%');
}

async function focusInput(page: Page, context: InputContext): Promise<Locator> {
  const node = page.locator('.mermaid-canvas-node[data-mermaid-node-id="SyntheticA"]');
  let input: Locator;
  if (context === 'property') {
    await node.click();
    input = page.getByRole('textbox', { name: '类成员 1', exact: true });
  } else if (context === 'node label') {
    await node.dblclick();
    input = node.locator('input');
  } else if (context === 'edge label') {
    const edge = page.locator('.canvas-edge-label[data-mermaid-edge-id="edge-1"]');
    await edge.dblclick();
    input = edge.locator('input');
  } else {
    await page.locator('.workbench-tabs').getByRole('button', { name: '源码', exact: true }).click();
    input = page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true });
  }
  await input.focus();
  await expect(input).toBeFocused();
  return input;
}

for (const modifier of ['Meta', 'Control']) {
  for (const context of contexts) {
    test(`${modifier} zoom shortcuts and aliases stay isolated in ${context} input`, async ({ page }, testInfo) => {
      await launchCanvas(page);
      for (const shortcut of shortcuts) {
        await resetToNinetyPercent(page);
        // Positive control: verify this browser receives the intended shortcut
        // and the canvas reacts before checking text-input isolation.
        const initialPageScale = await pageScale(page);
        await page.getByRole('region', { name: 'Mermaid 可视化画布编辑器', exact: true }).focus();
        await page.keyboard.press(`${modifier}+${shortcut.key}`);
        await expect(zoom(page)).toHaveText(shortcut.expectedCanvasZoom);
        const positiveControl = await keyObservation(page);
        expect(positiveControl.trusted).toBe(true);
        expect(positiveControl.defaultPrevented).toBe(true);
        if (shortcut.key.startsWith('Numpad')) expect(positiveControl.code).toBe(shortcut.key);
        else expect(positiveControl.key).toBe(shortcut.key);
        expect(await pageScale(page)).toEqual(initialPageScale);
        await resetToNinetyPercent(page);

        const input = await focusInput(page, context);
        const before = { zoom: await zoom(page).textContent(), value: await input.inputValue(), pageScale: await pageScale(page) };
        expect(before.zoom).toBe('90%');
        await input.press(`${modifier}+${shortcut.key}`);
        await paint(page);
        const after = {
          zoom: await zoom(page).textContent(),
          value: await input.inputValue(),
          focused: await input.evaluate(element => document.activeElement === element),
          pageScale: await pageScale(page),
          keyEvent: await keyObservation(page),
        };
        await testInfo.attach(`synthetic-zoom-input-${shortcut.key}`, {
          body: JSON.stringify({ modifier, key: shortcut.key, context, positiveControl, before, after }, null, 2),
          contentType: 'application/json',
        });
        expect(after.value).toBe(before.value);
        expect(after.focused).toBe(true);
        expect(after.zoom).toBe(before.zoom);
        expect(after.pageScale).toEqual(before.pageScale);
        if (context !== 'source') await input.press('Escape');
      }
    });
  }
}

for (const context of contexts) {
  test(`unmodified zero edits ${context} text without resetting canvas zoom`, async ({ page }, testInfo) => {
    await launchCanvas(page);
    await resetToNinetyPercent(page);
    await page.getByRole('region', { name: 'Mermaid 可视化画布编辑器', exact: true }).focus();
    await page.keyboard.press('0');
    await expect(zoom(page)).toHaveText('100%');
    expect((await keyObservation(page)).defaultPrevented).toBe(true);
    await resetToNinetyPercent(page);
    const input = await focusInput(page, context);
    const before = { zoom: await zoom(page).textContent(), value: await input.inputValue(), pageScale: await pageScale(page) };
    // Use normal selection keys so labels' initial select-all cannot make this
    // text-editing assertion accidentally replace the whole synthetic value.
    await input.press('ArrowRight');
    const selection = await input.evaluate(element => (element as HTMLInputElement | HTMLTextAreaElement).selectionStart!);
    await input.press('0');
    await paint(page);
    const after = {
      zoom: await zoom(page).textContent(), value: await input.inputValue(),
      focused: await input.evaluate(element => document.activeElement === element),
      pageScale: await pageScale(page), keyEvent: await keyObservation(page),
    };
    await testInfo.attach('synthetic-unmodified-zero', { body: JSON.stringify({ context, before, selection, after }, null, 2), contentType: 'application/json' });
    expect(after.value).toBe(`${before.value.slice(0, selection)}0${before.value.slice(selection)}`);
    expect(after.focused).toBe(true);
    expect(after.zoom).toBe(before.zoom);
    expect(after.pageScale).toEqual(before.pageScale);
    expect(after.keyEvent.defaultPrevented).toBe(false);
  });
}
