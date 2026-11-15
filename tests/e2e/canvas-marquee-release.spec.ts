import { expect, test } from '@playwright/test';
import { draftSource, launchDocument, openDiagram } from './helpers';

const source = 'flowchart LR\n  A["SYNTHETIC A"] --> B["SYNTHETIC B"]\n  B --> C["SYNTHETIC C"]';
for (const lostRelease of ['unpressed move', 'window release']) {
  test(`marquee ends after ${lostRelease} and cannot change selection on later hover`, async ({ page }) => {
    await launchDocument(page, `# SYNTHETIC marquee release\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`);
    await openDiagram(page); await page.locator('.canvas-fit-button').click();
    const viewport = page.locator('.canvas-editor-viewport'), box = await viewport.boundingBox();
    if (!box) throw new Error('Missing viewport');
    await page.evaluate(() => window.addEventListener('pointerdown', e => { (window as any).__syntheticPointerId = e.pointerId; }, { once: true }));
    await page.mouse.move(box.x + 8, box.y + 8); await page.mouse.down();
    await expect(page.locator('.canvas-marquee')).toHaveCount(1);
    const pointerId = await page.evaluate<number>(() => (window as any).__syntheticPointerId);
    // Model a lost/retargeted release. No fake graph state or event handlers are installed.
    if (lostRelease === 'unpressed move') await viewport.dispatchEvent('pointermove', {
      pointerId, pointerType: 'mouse', buttons: 0, button: -1,
      clientX: box.x + box.width - 8, clientY: box.y + box.height - 8,
    });
    else await page.evaluate(pointerId => window.dispatchEvent(new PointerEvent('pointerup', {
      pointerId, pointerType: 'mouse', buttons: 0, button: 0, bubbles: true,
    })), pointerId);
    await expect(page.locator('.canvas-marquee')).toHaveCount(0);
    await expect(page.locator('.mermaid-canvas-node.selected')).toHaveCount(0);
    await page.mouse.up();
    await page.mouse.move(box.x + box.width - 20, box.y + box.height - 20);
    await expect(page.locator('.mermaid-canvas-node.selected')).toHaveCount(0);
    const node = (id: string) => page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"]`);
    await node('A').click(); await node('B').click({ modifiers: ['Shift'] });
    await expect(page.locator('.mermaid-canvas-node.selected')).toHaveCount(2);
    await expect(page.locator('.history-tools button').first()).toBeDisabled();
    expect(await draftSource(page)).toBe(source);
  });
}
