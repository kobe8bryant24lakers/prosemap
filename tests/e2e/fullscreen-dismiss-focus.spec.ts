import { expect, test } from '@playwright/test';
import { launchDocument, savedSource } from './helpers';

const syntheticDocument = '# Synthetic fullscreen focus\n\n```mermaid\nflowchart LR\n  FirstA --> FirstB\n```\n\n```mermaid\nflowchart LR\n  SecondA --> SecondB\n```\n';

for (const method of ['backdrop', 'Escape', 'close button'] as const) {
  test(`fullscreen ${method} dismissal restores the exact opener without background click-through`, async ({ page }, testInfo) => {
    await launchDocument(page, syntheticDocument, 'synthetic-fullscreen-focus.md');
    const opener = page.getByRole('button', { name: '全屏查看图表', exact: true }).nth(1);
    await expect(opener).toBeEnabled();
    const backgroundFiles = page.getByRole('button', { name: '本地文件', exact: true });
    const backdropPoint = await backgroundFiles.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const point = { x: Math.min(14, rect.right - 1), y: rect.top + rect.height / 2 };
      return { ...point, hitsButton: element.contains(document.elementFromPoint(point.x, point.y)) };
    });
    // This actual app control lies beneath the fullscreen's 16px side margin.
    // A click leaking through dismissal would open the file explorer.
    expect(backdropPoint.hitsButton).toBe(true);
    await backgroundFiles.evaluate(element => {
      element.setAttribute('data-synthetic-click-count', '0');
      element.addEventListener('click', () => element.setAttribute('data-synthetic-click-count', String(Number(element.getAttribute('data-synthetic-click-count')) + 1)));
    });

    await opener.click();
    const dialog = page.locator('.mermaid-fullscreen-dialog');
    await expect(dialog.locator('.mermaid-fullscreen-svg svg')).toBeVisible();
    await expect(page.getByRole('button', { name: '关闭全屏图表', exact: true })).toBeFocused();
    await page.locator('.mermaid-fullscreen-stage').click();
    await expect(dialog).toBeVisible();

    if (method === 'backdrop') {
      expect(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.classList.contains('mermaid-fullscreen-backdrop'), backdropPoint)).toBe(true);
      await page.mouse.click(backdropPoint.x, backdropPoint.y);
    } else if (method === 'Escape') await page.keyboard.press('Escape');
    else await page.getByRole('button', { name: '关闭全屏图表', exact: true }).click();

    await expect(dialog).toHaveCount(0);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const after = {
      openerFocused: await opener.evaluate(element => document.activeElement === element),
      activeElement: await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') })),
      backgroundClicks: await backgroundFiles.getAttribute('data-synthetic-click-count'),
      backgroundInert: await page.locator('.app-shell').evaluate(element => Boolean(element.closest('[inert]'))),
    };
    await testInfo.attach('synthetic-dismissal-focus', { body: JSON.stringify({ method, after }, null, 2), contentType: 'application/json' });
    expect(after.backgroundClicks).toBe('0');
    expect(after.backgroundInert).toBe(false);
    await expect(page.locator('.file-explorer')).toHaveCount(0);
    expect.soft(after.openerFocused).toBe(true);

    // No intervening click/focus: Enter must reopen the second diagram.
    await page.keyboard.press('Enter');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const reopened = await dialog.count() === 1;
    await testInfo.attach('synthetic-keyboard-reopen', { body: JSON.stringify({ method, reopened }), contentType: 'application/json' });
    expect.soft(reopened).toBe(true);
    if (reopened) {
      await expect(dialog.locator('.mermaid-fullscreen-svg svg')).toContainText('SecondA');
      await page.keyboard.press('Escape');
    }
    expect(await savedSource(page)).toBe(syntheticDocument);
  });
}
