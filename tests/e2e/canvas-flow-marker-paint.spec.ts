import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

const source = 'flowchart LR\n  A["SYNTHETIC_A"]\n  B["SYNTHETIC_B"]\n  C["SYNTHETIC_C"]\n  A -->|SYNTHETIC_EDGE| B\n  B --> C';

async function endpoints(page: Page) {
  await page.mouse.move(10, 10);
  const edge = page.locator('g.canvas-edge[data-mermaid-edge-id="edge-1"]');
  // Keep the same selected state throughout the pixel comparisons.
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


test('flowchart arrow marker returns after line undo without hiding Canvas', async ({ page }, info) => {
  await launchDocument(page, `# SYNTHETIC flow marker paint\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`);
  await openDiagram(page);
  const root = page.locator('.mermaid-canvas-editor');
  await root.locator('.canvas-edge-label[data-mermaid-edge-id="edge-1"]').click();
  const baseline = await endpoints(page);
  expect(baseline.markers[1]).toContain('canvas-arrow-');
  await root.getByRole('button', { name: '直线', exact: true }).click();
  const line = await endpoints(page);
  expect(line.markers[1]).toBeNull();
  expect(line.pixels[1].rgba.equals(baseline.pixels[1].rgba)).toBe(false);
  await root.locator('.history-tools button').nth(0).click();
  const undone = await endpoints(page);
  await comparePaint(undone, baseline, info, 'line-undo-to-arrow');
  await root.locator('.history-tools button').nth(1).click();
  await comparePaint(await endpoints(page), line, info, 'redo-line');
  await root.getByRole('button', { name: '箭头', exact: true }).click();
  const arrow = await endpoints(page);
  await comparePaint(arrow, baseline, info, 'button-line-to-arrow');
  expect(await draftSource(page)).toBe(source);
  await showCanvas(page);
  await comparePaint(await endpoints(page), baseline, info, 'arrow-redraw');
  await root.getByRole('button', { name: '直线', exact: true }).click();
  expect(await draftSource(page)).toBe(source.replace(' -->|SYNTHETIC_EDGE|', ' ---|SYNTHETIC_EDGE|'));
  await showCanvas(page);
  await root.locator('.history-tools button').nth(0).click();
  await comparePaint(await endpoints(page), baseline, info, 'line-source-roundtrip-undo');
});
