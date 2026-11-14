import { expect, test, type Page } from '@playwright/test';
import { fixture, launchDocument, savedSource } from './helpers';

const manifest = JSON.parse(fixture('manifest.json'));
const diagrams: { template: string; path: string }[] = manifest.files.filter((entry: { category: string }) => entry.category === 'editable-diagram');

async function measurements(page: Page) {
  return page.locator('.mermaid-fullscreen-stage').evaluate(stage => {
    const svg = stage.querySelector('.mermaid-fullscreen-svg > svg')!;
    const fonts: number[] = [];
    // Measure actual rendered height against the unscaled glyph/HTML box.
    // This oracle does not read the product's computed lower bound.
    for (const element of svg.querySelectorAll('text, tspan, foreignObject *')) {
      if (![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())) continue;
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!bounds.height || !bounds.width || style.visibility !== 'visible' || style.display === 'none') continue;
      // HTML offsetHeight rounds fractional line heights. getBBox preserves
      // fractional SVG dimensions and respects CSS overrides of height attrs.
      const geometry = element instanceof SVGGraphicsElement ? element : element.closest('foreignObject')!;
      const naturalHeight = (geometry as SVGGraphicsElement).getBBox().height;
      if (naturalHeight > 0) fonts.push(parseFloat(style.fontSize) * geometry.getBoundingClientRect().height / naturalHeight);
    }
    const container = svg.parentElement!;
    const zoom = parseFloat(container.style.width) / 100;
    const rect = svg.querySelector('text, foreignObject')!.getBoundingClientRect();
    const inner = container.parentElement!.getBoundingClientRect();
    return { smallest: Math.min(...fonts), count: fonts.length, zoom,
      centerX: (rect.x + rect.width / 2 - inner.x - inner.width / 2) / zoom,
      centerY: (rect.y + rect.height / 2 - inner.y - inner.height / 2) / zoom };
  });
}

async function minimum(page: Page) {
  const down = page.getByRole('button', { name: '缩小全屏图表', exact: true });
  for (let i = 0; i < 20 && await down.isEnabled(); i++) await down.click();
  await expect(down).toBeDisabled();
  await expect.poll(async () => (await measurements(page)).smallest).toBeGreaterThanOrEqual(11.99);
}

async function resize(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  // ResizeObserver runs during rendering. Wait for its delivery before using
  // a disabled control left over from the previous viewport's lower bound.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const diagram of diagrams) {
  test(`${diagram.template}: fullscreen lower bound keeps text readable through zoom and resize`, async ({ page }) => {
    const original = fixture(diagram.path);
    await launchDocument(page, original, `SYNTHETIC_readable_${diagram.template}.md`);
    await page.getByRole('button', { name: '全屏查看图表', exact: true }).click();
    await expect(page.locator('.mermaid-fullscreen-svg > svg')).toBeVisible();
    await expect.poll(async () => (await measurements(page)).smallest).toBeGreaterThanOrEqual(11.99);
    await minimum(page);
    const before = await measurements(page);
    expect(before.count).toBeGreaterThan(0);
    for (const deltaMode of [0, 1, 2]) {
      await page.locator('.mermaid-fullscreen-stage').dispatchEvent('wheel', { deltaY: 10000, deltaMode, clientX: 400, clientY: 300 });
      expect((await measurements(page)).zoom).toBe(before.zoom);
    }
    const up = page.getByRole('button', { name: '放大全屏图表', exact: true });
    if (await up.isEnabled()) {
      await up.click();
      const enlarged = await measurements(page);
      expect(enlarged.zoom).toBeGreaterThan(before.zoom);
      expect(Math.abs(enlarged.centerX - before.centerX)).toBeLessThan(1);
      expect(Math.abs(enlarged.centerY - before.centerY)).toBeLessThan(1);
    }
    await page.getByRole('button', { name: /^重置全屏图表，当前/ }).click();
    await expect.poll(async () => (await measurements(page)).smallest).toBeGreaterThanOrEqual(11.99);
    await resize(page, 900, 600);
    await expect.poll(async () => (await measurements(page)).smallest).toBeGreaterThanOrEqual(11.99);
    await minimum(page);
    await resize(page, 1440, 1000);
    await minimum(page);
    await page.keyboard.press('Escape');
    expect(await savedSource(page)).toBe(original);
  });
}

test('styled small labels set the limit and disabled zoom controls are skipped by Tab', async ({ page }) => {
  const original = '# SYNTHETIC small labels\n\n```mermaid\nflowchart LR\n A["SYNTHETIC small"] --> B["SYNTHETIC large"]\n classDef small font-size:6px;\n class A small;\n```\n';
  await launchDocument(page, original);
  await page.getByRole('button', { name: '全屏查看图表', exact: true }).click();
  await expect(page.locator('.mermaid-fullscreen-svg > svg')).toBeVisible();
  await minimum(page);
  await page.getByRole('button', { name: '关闭全屏图表', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /^重置全屏图表，当前/ })).toBeFocused();
  await page.keyboard.press('Escape');
  expect(await savedSource(page)).toBe(original);
});
