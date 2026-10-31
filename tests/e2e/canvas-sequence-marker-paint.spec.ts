import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

// Synthetic native-paint regression. DOM marker attributes can be correct while
// the displayed marker is stale, so compare the actual endpoint pixels too.
// Browser results supplement the installed macOS WebView retest.
const source = 'sequenceDiagram\n  autonumber\n  actor A as Synthetic Actor\n  participant B as Synthetic App\n  participant C as Synthetic API\n  A->>B: M1 request\n  B-->>A: M2 response\n  B->>C: M3 forward';
const types = [
  ['-->>', 'arrow'], ['->', 'none'], ['-->', 'none'], ['-)', 'async'],
  ['--)', 'async'], ['-x', 'cross'], ['--x', 'cross'],
  ['<<->>', 'both'], ['<<-->>', 'both'],
] as const;

async function endpoints(page: Page) {
  await page.mouse.move(10, 10);
  const edge = page.locator('g.canvas-edge[data-mermaid-edge-id="edge-1"]');
  // A blank viewport click does not deselect a sequence message. Keep the same
  // selected state throughout instead of comparing different stroke/filter CSS.
  await expect(edge).toHaveClass(/\bselected\b/);
  const path = edge.locator(':scope > .canvas-edge-visible');
  const box = await path.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(80);
  const clips = [box!.x, box!.x + box!.width].map(x => ({
    x: Math.floor(x - 18), y: Math.floor(box!.y - 18), width: 36, height: 36,
  }));
  const pixels = [];
  for (const clip of clips) {
    const png = await page.screenshot({ clip, animations: 'disabled', scale: 'css' });
    // Compare decoded pixels, not PNG compression or ancillary metadata. Decode
    // in a detached canvas so this does not redraw or mutate the diagram.
    const decoded = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, data: [...context.getImageData(0, 0, image.width, image.height).data] };
    }, png.toString('base64'));
    pixels.push({ png, width: decoded.width, height: decoded.height, rgba: Buffer.from(decoded.data) });
  }
  return {
    geometry: await path.getAttribute('d'), clips,
    markers: [await path.getAttribute('marker-start'), await path.getAttribute('marker-end')],
    paint: await path.evaluate(element => {
      const style = getComputedStyle(element);
      return { stroke: style.stroke, strokeWidth: style.strokeWidth, dash: style.strokeDasharray, filter: style.filter };
    }),
    pixels,
  };
}

async function comparePaint(actual: Awaited<ReturnType<typeof endpoints>>, reference: Awaited<ReturnType<typeof endpoints>>, info: TestInfo, stage: string) {
  expect(actual.geometry).toBe(reference.geometry);
  expect(actual.clips).toEqual(reference.clips);
  expect(actual.markers).toEqual(reference.markers);
  expect(actual.paint).toEqual(reference.paint);
  for (let side = 0; side < 2; side++) {
    expect([actual.pixels[side].width, actual.pixels[side].height]).toEqual([reference.pixels[side].width, reference.pixels[side].height]);
    const equal = actual.pixels[side].rgba.equals(reference.pixels[side].rgba);
    if (!equal) {
      await info.attach(`${stage}-${side}-actual`, { body: actual.pixels[side].png, contentType: 'image/png' });
      await info.attach(`${stage}-${side}-reference`, { body: reference.pixels[side].png, contentType: 'image/png' });
    }
    expect(equal, `${stage}: endpoint ${side} paint must match the same state after redraw`).toBe(true);
  }
}

for (const [token, marker] of types) {
  test(`sequence marker pixels refresh for ${token}, undo and redo without a Source switch`, async ({ page }, info) => {
    await launchDocument(page, `# SYNTHETIC sequence marker paint\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`, 'synthetic-marker-paint.md');
    await openDiagram(page);
    await page.locator('.canvas-edge-label[data-mermaid-edge-id="edge-1"]').click();
    await page.locator('.canvas-fit-button').click();
    const baseline = await endpoints(page);
    expect(baseline.markers[0]).toBeNull();
    expect(baseline.markers[1]).toContain('canvas-arrow-');
    // Filled marker pixels outside the horizontal shaft establish a non-empty
    // initial reference; two accidentally blank endpoint clips cannot pass.
    const initialEnd = baseline.pixels[1];
    let arrowPixels = 0;
    for (let y = 0; y < initialEnd.height; y++) {
      if (Math.abs(y - 18) < 3 || Math.abs(y - 18) > 7) continue;
      for (let x = 0; x < initialEnd.width; x++) {
        const offset = (y * initialEnd.width + x) * 4;
        if (initialEnd.rgba[offset] === 85 && initialEnd.rgba[offset + 1] === 118 && initialEnd.rgba[offset + 2] === 105) arrowPixels++;
      }
    }
    expect(arrowPixels, 'initial end clip contains the filled arrow away from its shaft').toBeGreaterThan(5);
    await page.locator('.canvas-context-select select').selectOption(token);
    // Observe the changed canvas before any operation that hides it.
    const changed = await endpoints(page);
    if (marker === 'both') expect(changed.markers[0]).toContain('canvas-arrow-');
    else expect(changed.markers[0]).toBeNull();
    if (marker === 'none') expect(changed.markers[1]).toBeNull();
    else expect(changed.markers[1]).toContain(`canvas-${marker === 'both' ? 'arrow' : marker}-`);
    if (marker !== 'arrow') {
      const side = marker === 'both' ? 0 : 1;
      expect(changed.pixels[side].rgba.equals(baseline.pixels[side].rgba), 'changed endpoint must differ from the initial filled arrow').toBe(false);
    }

    const expected = source.replace('A->>B: M1', `A${token}B: M1`);
    await page.locator('.history-tools button').nth(0).click();
    const undone = await endpoints(page);
    await comparePaint(undone, baseline, info, 'undo');
    await page.locator('.history-tools button').nth(1).click();
    const redone = await endpoints(page);
    await comparePaint(redone, changed, info, 'redo');
    // Capture changed/undo/redo before hiding Canvas: a Source round trip can
    // repair stale paint and must not precede those observations.
    expect(await draftSource(page)).toBe(expected);
    await showCanvas(page);
    // Hiding/revealing the same Canvas is a redraw reference, not a remount.
    const redraw = await endpoints(page);
    await comparePaint(changed, redraw, info, 'changed');
    await comparePaint(redone, redraw, info, 'redo-redraw');
  });
}
