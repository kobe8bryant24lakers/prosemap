import { test, expect, type Page } from '@playwright/test';
import { launchDocument, mod, savedSource } from './helpers';

const source = '# Synthetic panel acceptance\n\n' + Array.from({ length: 100 }, (_, i) =>
  `## Section ${i + 1}\n\nSynthetic paragraph for independent scrolling.\n\n`).join('');

async function visiblePanels(page: Page) {
  return page.locator('.workspace > .rail, .workspace > .file-explorer, .workspace > .editor-pane, .workspace > .preview-pane, .workspace > .assistant-panel').evaluateAll(elements =>
    elements.filter(element => getComputedStyle(element).display !== 'none').map(element => {
      const rect = element.getBoundingClientRect();
      return { name: element.className, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    }));
}

async function expectHeaderControlsReachable(page: Page) {
  const controls = await page.locator('.topbar button:visible, .pane-header button:visible, .file-explorer > header button:visible, .assistant-header button:visible').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    const panel = element.closest('.topbar, .editor-pane, .preview-pane, .file-explorer, .assistant-panel')!.getBoundingClientRect();
    return {
      label: element.getAttribute('aria-label') ?? element.getAttribute('title') ?? element.textContent,
      insidePanel: rect.x >= panel.x && rect.right <= panel.right + 1 && rect.y >= panel.y && rect.bottom <= panel.bottom + 1,
      receivesPointer: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
    };
  }));
  for (const control of controls) {
    expect(control.insidePanel, `${control.label} stays inside its panel`).toBe(true);
    expect(control.receivesPointer, `${control.label} is not covered`).toBe(true);
  }
  if (await page.locator('.assistant-panel').isVisible()) {
    const title = await page.locator('.assistant-title > div').boundingBox();
    const close = await page.locator('.assistant-header button').boundingBox();
    expect(title!.x + title!.width, 'AI title leaves room for the close button').toBeLessThanOrEqual(close!.x + 1);
  }
}

for (const [width, height] of [[1440, 900], [1200, 800], [900, 600]]) {
  test(`workspace ${width}×${height}: all views and sidebar combinations remain visible and scroll independently`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await launchDocument(page, source);
    await page.evaluate(() => {
      const w = window as any;
      const original = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = (command: string, args: any) => command === 'pick_markdown_folder'
        ? Promise.resolve({ root: '/acceptance', name: 'Synthetic workspace', files: Array.from({ length: 40 }, (_, i) => ({
          path: `/acceptance/synthetic-${i + 1}.md`, name: `synthetic-${i + 1}.md`, relativePath: `synthetic-${i + 1}.md`,
        })) }) : original(command, args);
    });
    await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
    await page.getByRole('button', { name: '关闭文件列表', exact: true }).click();

    for (const [files, ai] of [[false, false], [true, false], [true, true], [false, true]]) {
      if (await page.locator('.file-explorer').isVisible() !== files) await page.getByRole('button', { name: '本地文件', exact: true }).click();
      if (await page.locator('.assistant-panel').isVisible() !== ai) {
        await page.getByRole('button', { name: ai ? 'AI 文字助手' : '关闭 AI 助手', exact: true }).click();
      }
      for (const view of ['纯编辑', '纯预览', '左编辑右预览']) {
        await page.getByRole('button', { name: view, exact: true }).click();
        const panels = await visiblePanels(page);
        for (const panel of panels) {
          expect(panel.x, `${panel.name} left edge`).toBeGreaterThanOrEqual(0);
          expect(panel.right, `${panel.name} right edge`).toBeLessThanOrEqual(width + 1);
          expect(panel.bottom, `${panel.name} bottom edge`).toBeLessThanOrEqual(height + 1);
          expect(panel.height).toBeGreaterThan(100);
        }
        for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
          const a = panels[i], b = panels[j];
          const overlap = Math.min(a.right, b.right) - Math.max(a.x, b.x);
          expect(overlap, `${view}: ${a.name} overlaps ${b.name}; files=${files}, ai=${ai}`).toBeLessThanOrEqual(1);
        }
        const save = page.getByRole('button', { name: '保存', exact: true });
        const box = (await save.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        if (files) await expect(page.getByRole('button', { name: '关闭文件列表', exact: true })).toBeInViewport();
        if (ai) await expect(page.getByRole('button', { name: '关闭 AI 助手', exact: true })).toBeInViewport();
        await expectHeaderControlsReachable(page);
        await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
        await expectHeaderControlsReachable(page);
        if (files && ai && view === '左编辑右预览') await page.screenshot({ path: testInfo.outputPath('both-panels-en.png') });
        await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
      }
      if (files && ai) {
        const fileList = page.locator('.file-list');
        const editorScroll = page.locator('.cm-scroller');
        await page.locator('.cm-content').click();
        await page.keyboard.press(`${mod}+Home`);
        // CodeMirror leaves a small scroll margin around the first line.
        await expect.poll(() => editorScroll.evaluate(element => element.scrollTop)).toBeLessThan(100);
        const editorTop = await editorScroll.evaluate(element => element.scrollTop);
        await fileList.hover(); await page.mouse.wheel(0, 1200);
        await expect.poll(() => fileList.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        expect(await editorScroll.evaluate(element => element.scrollTop)).toBe(editorTop);
        const fileTop = await fileList.evaluate(element => element.scrollTop);
        await editorScroll.hover(); await page.mouse.wheel(0, 600);
        await expect.poll(() => editorScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(editorTop);
        expect(await fileList.evaluate(element => element.scrollTop)).toBe(fileTop);
        await page.locator('.assistant-scroll').hover(); await page.mouse.wheel(0, 1200);
        await expect.poll(() => page.locator('.assistant-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        expect(await fileList.evaluate(element => element.scrollTop)).toBe(fileTop);
      }
      await page.locator('.cm-content').click();
      await page.keyboard.press(`${mod}+End`);
      await page.keyboard.insertText('PANEL_EDIT');
      expect(await savedSource(page)).toBe(source + 'PANEL_EDIT');
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      expect(await savedSource(page)).toBe(source);
    }
  });
}
