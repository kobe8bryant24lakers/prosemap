import { expect, test, type Page } from '@playwright/test';
import { draftSource, launchDocument, mod, openDiagram, savedSource, showCanvas } from './helpers';

// Synthetic browser fixtures; native input and disk evidence is recorded separately.
const stateSource = 'stateDiagram-v2\n  state "SyntheticAlpha" as A\n  state "SyntheticBeta" as B\n  A --> B: SyntheticTransition';
const sequenceSource = 'sequenceDiagram\n  participant A as SyntheticSender\n  participant B as SyntheticReceiver\n  A->>B: SyntheticMessage';
const ganttSource = 'gantt\n  dateFormat YYYY-MM-DD\n  SyntheticTask :a, 2026-10-01, 2d';
const apply = (page: Page) => page.getByRole('button', { name: '应用到文档', exact: true });
const undo = (page: Page) => page.locator('.history-tools button').first();
const redo = (page: Page) => page.locator('.history-tools button').nth(1);
const target = (page: Page, kind: string, id: string) => page.locator(kind === 'node'
  ? `.mermaid-canvas-node[data-mermaid-node-id="${id}"]`
  : `.canvas-edge-label[data-mermaid-edge-id="${id}"]`);
const documentFor = (source: string) => `# Synthetic rejected label\n\nSynthetic surrounding prose.\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`;

async function open(page: Page, source = stateSource) {
  await launchDocument(page, documentFor(source), 'synthetic-invalid-label.md');
  await openDiagram(page);
  await page.locator('.canvas-fit-button').click();
}

for (const item of [
  { name: 'state name', source: stateSource, kind: 'node', id: 'A', original: 'SyntheticAlpha', illegal: '#' },
  { name: 'sequence participant', source: sequenceSource, kind: 'node', id: 'A', original: 'SyntheticSender', illegal: ';' },
  { name: 'sequence message', source: sequenceSource, kind: 'edge', id: 'edge-1', original: 'SyntheticMessage', illegal: ';' },
  { name: 'Gantt name', source: ganttSource, kind: 'node', id: 'a', original: 'SyntheticTask', illegal: ':' },
]) {
  test(`${item.name}: rejected first edit stays repairable and recovery owns one history entry`, async ({ page }) => {
    await open(page, item.source);
    const label = target(page, item.kind, item.id);
    await label.dblclick();
    const input = label.locator('input');
    const invalid = `${item.original}${item.illegal}Injected`;
    await input.fill(invalid);
    await expect(input).toHaveValue(invalid, { timeout: 1500 });
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(apply(page)).toBeDisabled();
    await expect(undo(page)).toBeDisabled();
    expect(await page.evaluate(() => (window as any).__acceptance.disk['/acceptance/synthetic-invalid-label.md'])).toBe(documentFor(item.source));

    // Enter and ordinary focus changes must not silently discard rejected text.
    await input.press('Enter');
    await expect(input).toBeFocused();
    await page.locator('.canvas-fit-button').focus();
    await expect(input).toHaveValue(invalid);
    await expect(apply(page)).toBeDisabled();
    await input.focus();
    await input.press(`${mod}+a`);
    await input.press('ArrowRight');
    await input.press('Backspace');
    await expect(input).toHaveValue(invalid.slice(0, -1));
    await expect(undo(page)).toBeDisabled();

    const recovered = `${item.original}Recovered`;
    await input.fill(recovered);
    await expect(input).toHaveAttribute('aria-invalid', 'false');
    await input.press('Enter');
    await expect(apply(page)).toBeEnabled();
    await expect(undo(page)).toBeEnabled();
    await undo(page).click();
    await expect(undo(page)).toBeDisabled();
    expect(await draftSource(page)).toBe(item.source);
    await showCanvas(page);
    await redo(page).click();
    const expectedSource = item.source.replace(item.original, recovered);
    expect(await draftSource(page)).toBe(expectedSource);
    await apply(page).click();
    expect(await savedSource(page)).toBe(documentFor(expectedSource));
  });
}

test('repairing a rejected draft back to the accepted label clears the error without history', async ({ page }) => {
  await open(page);
  const label = target(page, 'node', 'A');
  await label.dblclick();
  const input = label.locator('input');
  await input.fill('SyntheticAlpha#');
  await input.fill('SyntheticAlpha');
  await expect(apply(page)).toBeEnabled({ timeout: 1500 });
  await expect(undo(page)).toBeDisabled();
  await input.press('Enter');
  expect(await draftSource(page)).toBe(stateSource);
});

for (const acceptedFirst of [false, true]) {
  test(`Escape after a rejected label restores the previous redo branch (accepted first: ${acceptedFirst})`, async ({ page }) => {
    await open(page);
    const label = target(page, 'node', 'A');
    await label.dblclick();
    await label.locator('input').fill('SyntheticPrevious');
    await label.locator('input').press('Enter');
    await undo(page).click();
    await expect(redo(page)).toBeEnabled();
    await label.dblclick();
    const input = label.locator('input');
    if (acceptedFirst) await input.fill('SyntheticAbandoned');
    await input.fill('SyntheticAbandoned#');
    await input.press('Escape');
    await expect(apply(page)).toBeEnabled({ timeout: 1500 });
    await expect(label.locator('input')).toHaveCount(0);
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeEnabled();
    expect(await draftSource(page)).toBe(stateSource);
    await showCanvas(page);
    await redo(page).click();
    expect(await draftSource(page)).toBe(stateSource.replace('SyntheticAlpha', 'SyntheticPrevious'));
  });
}

test('source replacement closes an invalid label draft and resets its abandoned history', async ({ page }) => {
  await open(page);
  const label = target(page, 'node', 'A');
  await label.dblclick();
  await label.locator('input').fill('SyntheticAbandoned');
  await label.locator('input').fill('SyntheticAbandoned#');
  await draftSource(page);
  const external = stateSource.replace('SyntheticAlpha', 'SyntheticExternal');
  await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(external);
  await showCanvas(page);
  await expect(label.locator('input')).toHaveCount(0);
  await expect(label).toContainText('SyntheticExternal');
  await expect(undo(page)).toBeDisabled();
  await expect(apply(page)).toBeEnabled();
  expect(await draftSource(page)).toBe(external);
});
