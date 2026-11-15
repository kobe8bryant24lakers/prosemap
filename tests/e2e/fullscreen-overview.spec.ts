import { expect, test, type Page } from '@playwright/test';
import { fixture, launchDocument, savedSource } from './helpers';

const diagrams: { template: string; path: string }[] = JSON.parse(fixture('manifest.json')).files
  .filter((entry: { category: string }) => entry.category === 'editable-diagram');

async function geometry(page: Page) {
  return page.locator('.mermaid-fullscreen-stage').evaluate(stage => {
    const svg = stage.querySelector<SVGSVGElement>('.mermaid-fullscreen-svg > svg')!;
    const inner = svg.parentElement!.parentElement!.getBoundingClientRect();
    const clip = stage.getBoundingClientRect();
    const bounds = svg.getBBox(), matrix = svg.getScreenCTM()!;
    const corners = [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y],
      [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height]]
      .map(([x, y]) => ({ x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f }));
    const fonts = [...svg.querySelectorAll('text,tspan,foreignObject *')].filter(e =>
      [...e.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()))
      .flatMap(e => {
        const g = e instanceof SVGGraphicsElement ? e : e.closest('foreignObject')!;
        const box = (g as SVGGraphicsElement).getBBox(), rect = g.getBoundingClientRect();
        return box.height && rect.height ? [parseFloat(getComputedStyle(e).fontSize) * rect.height / box.height] : [];
      });
    return { zoom: parseFloat(svg.parentElement!.style.width) / 100, smallest: Math.min(...fonts),
      corners, inner: { left: inner.left, top: inner.top, right: inner.right, bottom: inner.bottom },
      // The stage clips at its outer edge; its padding is visible too. Some
      // Mermaid glyphs extend slightly beyond the SVG's declared viewBox.
      inside: corners.every(p => p.x >= clip.left - 1 && p.y >= clip.top - 1 && p.x <= clip.right + 1 && p.y <= clip.bottom + 1),
      left: svg.parentElement!.getBoundingClientRect().left, top: svg.parentElement!.getBoundingClientRect().top };
  });
}

async function fit(page: Page) {
  await page.getByRole('button', { name: '一屏总览', exact: true }).click();
  await expect.poll(async () => (await geometry(page)).zoom).toBe(1);
  const fitted = await geometry(page);
  expect(fitted.inside, JSON.stringify(fitted)).toBe(true);
  await expect(page.locator('.mermaid-fullscreen-header small')).toContainText('总览中');
}

async function expectReadable(page: Page) {
  // Native wheel events schedule a React render; dispatchEvent only waits for
  // event dispatch, so observe the rendered font size after that update lands.
  await expect.poll(async () => (await geometry(page)).smallest).toBeGreaterThanOrEqual(11.99);
  await expect(page.locator('.mermaid-fullscreen-header small')).not.toContainText('总览中');
}

async function resize(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function pan(page: Page) {
  const box = (await page.locator('.mermaid-fullscreen-stage').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 35, { steps: 5 });
  await page.mouse.up();
}

for (const diagram of diagrams) {
  test(`${diagram.template}: overview fits the whole graph and returns to readable zoom`, async ({ page }) => {
    const original = fixture(diagram.path);
    await launchDocument(page, original, `SYNTHETIC_overview_${diagram.template}.md`);
    await page.getByRole('button', { name: '全屏查看图表', exact: true }).click();
    await expect(page.locator('.mermaid-fullscreen-svg > svg')).toBeVisible();
    await page.getByRole('button', { name: '放大全屏图表', exact: true }).click();
    await pan(page);
    await fit(page);
    const overview = await geometry(page);
    await pan(page);
    const moved = await geometry(page);
    expect(Math.abs(moved.left - overview.left)).toBeGreaterThan(40);
    await fit(page);
    expect(Math.abs((await geometry(page)).left - overview.left)).toBeLessThan(1);
    for (const size of [[900, 600], [1440, 1000]]) {
      await resize(page, size[0], size[1]);
      expect((await geometry(page)).zoom).toBe(1);
      expect((await geometry(page)).inside).toBe(true);
    }
    if ((await geometry(page)).smallest < 11.99) {
      for (const deltaMode of [0, 1, 2]) {
        await page.locator('.mermaid-fullscreen-stage').dispatchEvent('wheel', { deltaY: 1000, deltaMode });
        expect((await geometry(page)).zoom).toBe(1);
        await expect(page.locator('.mermaid-fullscreen-header small')).toContainText('总览中');
      }
    }
    await page.getByRole('button', { name: '放大全屏图表', exact: true }).click();
    await expectReadable(page);
    await fit(page);
    await page.locator('.mermaid-fullscreen-stage').dispatchEvent('wheel', { deltaY: -100, clientX: 500, clientY: 300 });
    await expectReadable(page);
    await fit(page);
    await page.getByRole('button', { name: /^重置全屏图表，当前/ }).click();
    await expectReadable(page);
    await fit(page);
    await page.keyboard.press('Escape');
    expect(await savedSource(page)).toBe(original);
    await page.getByRole('button', { name: '全屏查看图表', exact: true }).click();
    await expect(page.locator('.mermaid-fullscreen-svg > svg')).toBeVisible();
    await expectReadable(page);
  });
}

for (const english of [false, true]) {
  test(`${english ? 'en' : 'zh'}: overview is keyboard reachable and fits a narrow toolbar`, async ({ page }) => {
    await launchDocument(page, fixture(diagrams.find(d => d.template === 'gantt')!.path));
    if (english) await page.getByRole('combobox', { name: '界面语言' }).selectOption('en');
    await page.getByRole('button', { name: english ? 'View diagram fullscreen' : '全屏查看图表', exact: true }).click();
    const overview = page.getByRole('button', { name: english ? 'Overview' : '一屏总览', exact: true });
    await expect(overview).toBeEnabled();
    await page.getByRole('button', { name: english ? 'Close fullscreen diagram' : '关闭全屏图表', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(overview).toBeFocused();
    await page.keyboard.press('Enter');
    await resize(page, 360, 640);
    expect((await geometry(page)).inside).toBe(true);
    expect((await geometry(page)).zoom).toBe(1);
    const controls = await page.locator('.mermaid-fullscreen-actions button').evaluateAll(buttons => buttons.map(b => {
      const r = b.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, viewportWidth: innerWidth };
    }));
    for (const r of controls) expect(r.left >= 0 && r.right <= r.viewportWidth && r.top >= 0 && r.bottom <= 640).toBe(true);
    await expect(overview).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: english ? 'View diagram fullscreen' : '全屏查看图表', exact: true })).toBeFocused();
  });
}
