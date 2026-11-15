import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchDocument, openDiagram } from './helpers';

const syntheticDocument = '# Synthetic localized minus\n\n```mermaid\nclassDiagram\n  class SyntheticA {\n    +String syntheticField\n  }\n  class SyntheticB\n  SyntheticA --> SyntheticB : syntheticRelation\n```\n';
const zoom = (page: Page) => page.locator('.canvas-zoom-value');
const canvas = (page: Page) => page.getByRole('region', { name: 'Mermaid 可视化画布编辑器', exact: true });

// Replay the key fields observed in the installed native WebView. This is an
// explicitly synthetic browser regression, not evidence of native delivery.
type SyntheticKeyInit = Pick<KeyboardEventInit,
  'key' | 'code' | 'keyCode' | 'ctrlKey' | 'shiftKey' | 'metaKey' | 'altKey'
  | 'isComposing' | 'bubbles' | 'cancelable' | 'composed'>;
const localizedMinus: SyntheticKeyInit = {
  key: '\u2014\u2014', code: 'Minus', keyCode: 189,
  ctrlKey: true, shiftKey: true, metaKey: false, altKey: false,
  isComposing: false, bubbles: true, cancelable: true, composed: true,
};

async function replayKey(target: Locator, overrides: SyntheticKeyInit = {}) {
  return target.evaluate((element, init) => {
    const event = new KeyboardEvent('keydown', init);
    element.dispatchEvent(event);
    return {
      key: event.key, code: event.code,
      ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey, alt: event.altKey,
      composing: event.isComposing, trusted: event.isTrusted,
      defaultPrevented: event.defaultPrevented,
    };
  }, { ...localizedMinus, ...overrides });
}

async function paint(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function resetToNinety(page: Page) {
  await zoom(page).click();
  await page.getByRole('button', { name: '缩小画布', exact: true }).click();
  await expect(zoom(page)).toHaveText('90%');
  await canvas(page).focus();
}

async function launchCanvas(page: Page) {
  await launchDocument(page, syntheticDocument, 'synthetic-localized-minus.md');
  await openDiagram(page);
  await resetToNinety(page);
}

test('normal modified minus aliases still shrink the canvas', async ({ page }) => {
  await launchCanvas(page);
  for (const modifier of ['Control', 'Meta']) {
    for (const key of ['-', '_', 'NumpadSubtract']) {
      await resetToNinety(page);
      await page.keyboard.press(`${modifier}+${key}`);
      await expect(zoom(page)).toHaveText('80%');
      await expect(canvas(page)).toBeFocused();
    }
  }
});

test('the observed localized Control Shift Minus signature shrinks the canvas', async ({ page }, testInfo) => {
  await launchCanvas(page);
  const observation = await replayKey(canvas(page));
  await testInfo.attach('synthetic-localized-minus-event', {
    body: JSON.stringify(observation), contentType: 'application/json',
  });
  expect(observation.trusted).toBe(false);
  await expect(zoom(page)).toHaveText('80%');
  expect(observation.defaultPrevented).toBe(true);
  await expect(canvas(page)).toBeFocused();
});

test('localized minus compatibility excludes other layouts, modifiers and composition', async ({ page }, testInfo) => {
  await launchCanvas(page);
  const excluded: { name: string; fields: SyntheticKeyInit }[] = [
    { name: 'unrelated key on the same physical position', fields: { key: '?' } },
    { name: 'single em dash', fields: { key: '\u2014' } },
    { name: 'different physical key', fields: { code: 'Slash' } },
    { name: 'missing Shift', fields: { shiftKey: false } },
    { name: 'missing Control', fields: { ctrlKey: false } },
    { name: 'Meta instead of Control', fields: { ctrlKey: false, metaKey: true } },
    { name: 'additional Meta', fields: { metaKey: true } },
    { name: 'Alt or AltGr combination', fields: { altKey: true } },
    { name: 'active composition', fields: { isComposing: true } },
  ];
  for (const item of excluded) {
    const observation = await replayKey(canvas(page), item.fields);
    await paint(page);
    await testInfo.attach(`synthetic-excluded-${item.name}`, {
      body: JSON.stringify(observation), contentType: 'application/json',
    });
    expect(observation.trusted).toBe(false);
    expect(observation.defaultPrevented, item.name).toBe(false);
    await expect(zoom(page), item.name).toHaveText('90%');
    await expect(canvas(page)).toBeFocused();
  }
});

for (const context of ['property', 'node label', 'edge label', 'source'] as const) {
  test(`localized minus leaves ${context} text and focus intact`, async ({ page }, testInfo) => {
    await launchCanvas(page);
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
    const value = await input.inputValue();
    const observation = await replayKey(input);
    await paint(page);
    await testInfo.attach(`synthetic-localized-minus-${context}`, {
      body: JSON.stringify(observation), contentType: 'application/json',
    });
    expect(observation.trusted).toBe(false);
    expect(observation.defaultPrevented).toBe(false);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(value);
    await expect(zoom(page)).toHaveText('90%');
  });
}
