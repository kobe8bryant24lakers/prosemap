import { test, expect, type Page } from '@playwright/test';
import { fixture, launchDocument, savedSource, mod } from './helpers';

const source = fixture('synthetic-mixed-scroll.md');
const editor = '.cm-scroller';
const preview = '.preview-scroll';
async function settled(page: Page) {
  // Observe a quiet interval after browser scroll events / CodeMirror measurement.
  await page.waitForTimeout(300);
}
async function revealEditor(page: Page, section: string) {
  await page.getByRole('button', { name: '查找与替换', exact: true }).click();
  await page.getByRole('textbox', { name: '查找', exact: true }).fill(section);
  await page.getByRole('button', { name: '下一个', exact: true }).click();
  await page.getByRole('button', { name: '关闭查找', exact: true }).click();
  await settled(page);
  await page.locator('.cm-line').filter({ hasText: `## ${section}` }).evaluate(el => {
    const scroll = el.closest('.cm-scroller')!;
    scroll.scrollTop += el.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
  });
  await settled(page);
}
async function headingOffset(page: Page, section: string) {
  return page.getByRole('heading', { name: section, exact: true }).evaluate(el =>
    el.getBoundingClientRect().top - el.closest('.preview-scroll')!.getBoundingClientRect().top);
}

test('mixed document keeps the same section in editor and preview', async ({ page }, info) => {
  await launchDocument(page, source, 'SYNTHETIC_scroll.md');
  await expect(page.locator('.mermaid-svg svg')).toBeVisible();
  const observations = [];
  for (const section of ['SYNTHETIC_SECTION_04', 'SYNTHETIC_SECTION_08', 'SYNTHETIC_SECTION_13']) {
    await revealEditor(page, section);
    observations.push({ section, previewOffset: await headingOffset(page, section) });
  }
  await info.attach('section-alignment', { body: JSON.stringify(observations), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('alignment.png') });
  for (const row of observations) expect(Math.abs(row.previewOffset)).toBeLessThan(40);
  expect(await savedSource(page)).toBe(source);
});

test('reverse scrolling preserves selection and settles without a feedback loop', async ({ page }, info) => {
  await launchDocument(page, source, 'SYNTHETIC_scroll.md');
  await expect(page.locator('.mermaid-svg svg')).toBeVisible();
  await revealEditor(page, 'SYNTHETIC_SECTION_04');
  const observations = [];
  for (const section of ['SYNTHETIC_SECTION_13', 'SYNTHETIC_SECTION_08', 'SYNTHETIC_SECTION_04']) {
    await page.getByRole('heading', { name: section, exact: true }).evaluate(el => {
      const scroll = el.closest('.preview-scroll')!;
      scroll.scrollTop += el.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    });
    await settled(page);
    const offset = await page.locator('.cm-line').filter({ hasText: `## ${section}` }).evaluate(el =>
      el.getBoundingClientRect().top - el.closest('.cm-scroller')!.getBoundingClientRect().top);
    observations.push({ section, editorOffset: offset });
    expect(Math.abs(offset)).toBeLessThan(40);
  }
  const samples = await page.evaluate(async () => {
    const samples: number[][] = [];
    for (let i = 0; i < 30; i++) {
      await new Promise(requestAnimationFrame);
      samples.push(['.cm-scroller', '.preview-scroll'].map(selector => document.querySelector(selector)!.scrollTop));
    }
    return samples;
  });
  await info.attach('reverse-and-settled', { body: JSON.stringify({ observations, samples }), contentType: 'application/json' });
  for (const index of [0, 1]) expect(Math.max(...samples.map(v => v[index])) - Math.min(...samples.map(v => v[index]))).toBeLessThanOrEqual(1);
  await page.locator('.cm-content').focus();
  await page.keyboard.insertText('SYNTHETIC_REPLACED_SELECTION');
  expect(await savedSource(page)).toBe(source.replace('SYNTHETIC_SECTION_04', 'SYNTHETIC_REPLACED_SELECTION'));
  await page.keyboard.press(`${mod}+z`);
  expect(await savedSource(page)).toBe(source);
  for (const selector of [editor, preview]) {
    for (const edge of ['bottom', 'top']) {
      await page.locator(selector).evaluate((el, edge) => { el.scrollTop = edge === 'top' ? 0 : el.scrollHeight; }, edge);
      await settled(page);
      const distances = await page.locator(`${editor}, ${preview}`).evaluateAll((els, edge) => els.map(el => edge === 'top' ? el.scrollTop : el.scrollHeight - el.clientHeight - el.scrollTop), edge);
      for (const distance of distances) expect(distance).toBeLessThanOrEqual(2);
    }
  }
});

test('late tall image layout keeps the current source section aligned', async ({ page }, info) => {
  await launchDocument(page, source, 'SYNTHETIC_scroll.md');
  await expect(page.locator('.mermaid-svg svg')).toBeVisible();
  await page.evaluate(() => {
    const w = window as any;
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any) => {
      if (command === 'read_local_image' && args.source === 'SYNTHETIC_late.svg') {
        await new Promise<void>(resolve => { w.__releaseSyntheticImage = resolve; });
        return { mime: 'image/svg+xml', bytes: [...new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="1600"><rect width="480" height="1600" fill="#b8dbc9"/><text x="20" y="40">SYNTHETIC_LATE_IMAGE</text></svg>')] };
      }
      return original(command, args);
    };
  });
  const modified = source.replace('assets/fixture-diagram.svg', 'SYNTHETIC_late.svg');
  await page.locator('.cm-content').fill(modified);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseSyntheticImage)).toBe('function');
  await revealEditor(page, 'SYNTHETIC_SECTION_13');
  const before = await headingOffset(page, 'SYNTHETIC_SECTION_13');
  await page.evaluate(() => (window as any).__releaseSyntheticImage());
  await expect.poll(() => page.locator('img[alt="SYNTHETIC_IMAGE"]').first().evaluate(el => (el as HTMLImageElement).naturalHeight)).toBe(1600);
  await settled(page);
  const after = await headingOffset(page, 'SYNTHETIC_SECTION_13');
  await info.attach('late-image', { body: JSON.stringify({ before, after }), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('late-image.png') });
  expect(Math.abs(after - before)).toBeLessThan(40);
  expect(await savedSource(page)).toBe(modified);
});

test('returning from preview keeps its latest reading section', async ({ page }, info) => {
  await launchDocument(page, source, 'SYNTHETIC_scroll.md');
  await expect(page.locator('.mermaid-svg svg')).toBeVisible();
  await revealEditor(page, 'SYNTHETIC_SECTION_04');
  await page.getByRole('button', { name: '纯预览', exact: true }).click();
  const heading = page.getByRole('heading', { name: 'SYNTHETIC_SECTION_13', exact: true });
  await heading.evaluate(el => {
    const scroll = el.closest('.preview-scroll')!;
    scroll.scrollTop += el.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
  });
  await settled(page);
  const before = await headingOffset(page, 'SYNTHETIC_SECTION_13');
  await page.getByRole('button', { name: '左编辑右预览', exact: true }).click();
  await settled(page);
  const after = await headingOffset(page, 'SYNTHETIC_SECTION_13');
  await info.attach('view-transition', { body: JSON.stringify({ before, after }), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('view-transition.png') });
  expect(Math.abs(after - before)).toBeLessThan(40);
  expect(await page.locator(editor).evaluate(el => el.scrollTop)).toBeGreaterThan(500);
  expect(await page.locator(preview).evaluate(el => el.scrollTop)).toBeGreaterThan(500);
  expect(await savedSource(page)).toBe(source);
});

test('preview reading inside a tall code block survives returning to split', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await launchDocument(page, source, 'SYNTHETIC_scroll.md');
  await expect(page.locator('.mermaid-svg svg')).toBeVisible();
  await page.locator(editor).evaluate(el => { el.scrollTop = 1800; });
  await settled(page);
  await page.getByRole('button', { name: '纯预览', exact: true }).click();
  await settled(page);
  await page.locator(preview).hover();
  await page.mouse.wheel(0, 900);
  await settled(page);
  const readingBlock = () => page.locator(preview).evaluate(el => {
    const top = el.getBoundingClientRect().top;
    const blocks = [...el.querySelectorAll<HTMLElement>('[data-source-line]')]
      .map(node => ({ line: node.dataset.sourceLine, offset: node.getBoundingClientRect().top - top }));
    return blocks.filter(block => block.offset <= 1).at(-1)!;
  });
  const before = await readingBlock();
  await page.getByRole('button', { name: '左编辑右预览', exact: true }).click();
  await settled(page);
  const after = await readingBlock();
  await info.attach('code-block-reading-transition', { body: JSON.stringify({ before, after }), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('code-block-reading-transition.png') });
  expect(after.line).toBe(before.line);
  expect(Math.abs(after.offset - before.offset)).toBeLessThan(5);
  expect(await savedSource(page)).toBe(source);
});
