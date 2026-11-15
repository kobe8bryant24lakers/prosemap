import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, savedSource, showCanvas } from './helpers';

test.use({ deviceScaleFactor: 2 });

// Synthetic shape oracle: the solid control must contain all four X arms (or
// both async arms), then the dotted variant must retain those same arm regions.
// These pixels are independent of the CSS workaround and marker path identity.
const sourceFor = (token: string) => `sequenceDiagram\n  participant A as Synthetic A\n  participant B as Synthetic B\n  participant C as Synthetic C\n  A${token}B: M1 request\n  B-->>A: M2 response\n  B->>C: M3 forward`;
const markdown = (source: string) => `# SYNTHETIC marker shape\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`;

async function pixels(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  const png = await page.screenshot({ clip, animations: 'disabled', scale: 'device' });
  const decoded = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    return { data: [...ctx.getImageData(0, 0, canvas.width, canvas.height).data], width: canvas.width, height: canvas.height };
  }, png.toString('base64'));
  return { png, ...clip, ...decoded, scale: decoded.width / clip.width };
}
const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
function ink(image: Awaited<ReturnType<typeof pixels>>, x: number, y: number, color: number[]) {
  const offset = (y * image.width + x) * 4;
  return color.every((channel, index) => Math.abs(image.data[offset + index] - channel) < 30);
}
async function capture(page: Page, line: Locator, info: TestInfo, label: string) {
  // Horizontal SVG lines have a zero-height geometry box even when painted.
  await expect(line).toHaveCount(1); await page.mouse.move(10, 10);
  await page.waitForFunction(() => !document.getAnimations().some(animation =>
    animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)));
  const geometry = await line.evaluate(element => {
    const r = element.getBoundingClientRect(), style = getComputedStyle(element);
    const id = element.getAttribute('marker-end')!.match(/#([^\s)'"]+)/)![1];
    const shape = element.ownerDocument.getElementById(id)!.querySelector('path')!;
    const markerStyle = getComputedStyle(shape);
    return { x: r.x, y: r.y, width: r.width, markerColor: markerStyle.stroke === 'none' ? markerStyle.fill : markerStyle.stroke, lineColor: style.stroke };
  });
  expect(geometry.width).toBeGreaterThan(100);
  const endpoint = await pixels(page, { x: Math.floor(geometry.x + geometry.width - 18), y: Math.floor(geometry.y - 18), width: 36, height: 36 });
  const shaft = await pixels(page, { x: Math.floor(geometry.x + 16), y: Math.floor(geometry.y - 2), width: 44, height: 5 });
  await info.attach(label, { body: endpoint.png, contentType: 'image/png' });
  await info.attach(label + '-shaft', { body: shaft.png, contentType: 'image/png' });
  await info.attach(label + '-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' });
  return { geometry, endpoint, shaft };
}
type Capture = Awaited<ReturnType<typeof capture>>;
function assertShaft(value: Capture, dashed: boolean) {
  const color = rgb(value.geometry.lineColor), columns = [];
  for (let x = 0; x < value.shaft.width; x++) columns.push(Array.from({ length: value.shaft.height }, (_, y) => y).some(y => ink(value.shaft, x, y, color)));
  const foreground = columns.filter(Boolean).length, gaps = columns.length - foreground;
  expect(foreground, 'message shaft remains visible').toBeGreaterThan(10 * value.shaft.scale);
  if (dashed) expect(gaps, 'dotted message retains visible gaps').toBeGreaterThan(5 * value.shaft.scale);
  else expect(gaps, 'solid control has a continuous shaft').toBeLessThan(3 * value.shaft.scale);
}
function assertShape(reference: Capture, actual: Capture, shape: 'cross' | 'async') {
  expect(actual.geometry).toEqual(reference.geometry);
  const color = rgb(reference.geometry.markerColor), image = reference.endpoint;
  const lineY = (reference.geometry.y - image.y) * image.scale;
  const points: [number, number][] = [];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    // The shaft and lifeline must not satisfy missing lower/upper arms. The
    // lifeline has a different color; remove the horizontal shaft band here.
    if (Math.abs(y - lineY) > 2 * image.scale && ink(image, x, y, color)) points.push([x, y]);
  }
  expect(points.length, 'solid marker has off-shaft ink').toBeGreaterThan(5);
  const centerX = (Math.min(...points.map(p => p[0])) + Math.max(...points.map(p => p[0]))) / 2;
  const regions = shape === 'cross' ? [0, 1, 2, 3] : [0, 2];
  for (const region of regions) {
    const upper = region < 2, left = region % 2 === 0;
    const inRegion = (x: number, y: number) => Math.abs(y - lineY) > 2 * image.scale && (upper ? y < lineY : y > lineY)
      && (shape === 'async' || (left ? x < centerX : x > centerX));
    const baseline = points.filter(([x, y]) => inRegion(x, y)).length;
    let changed = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      if (inRegion(x, y) && ink(actual.endpoint, x, y, color)) changed++;
    }
    expect(baseline, `solid ${shape} control has arm region ${region}`).toBeGreaterThan(1);
    expect(changed, `dotted ${shape} retains arm region ${region}`).toBeGreaterThanOrEqual(Math.ceil(baseline * 0.75));
  }
}

for (const [solid, dotted, shape] of [['-x', '--x', 'cross'], ['-)', '--)', 'async']] as const) {
  test(`sequence ${shape} keeps complete markers on dotted canvas, inline and fullscreen messages`, async ({ page }, info) => {
    const source = sourceFor(solid), changedSource = sourceFor(dotted);
    await launchDocument(page, markdown(source), 'synthetic-marker-shape.md');
    const previewLine = page.locator('.preview-pane .mermaid-svg .messageLine0,.preview-pane .mermaid-svg .messageLine1').first();
    const inline = await capture(page, previewLine, info, 'solid-inline');
    assertShape(inline, inline, shape); assertShaft(inline, false);
    await page.getByRole('button', { name: '全屏查看图表', exact: true }).click();
    const fullLine = page.locator('.mermaid-fullscreen-svg .messageLine0,.mermaid-fullscreen-svg .messageLine1').first();
    const full = await capture(page, fullLine, info, 'solid-fullscreen');
    assertShape(full, full, shape); assertShaft(full, false);
    await page.keyboard.press('Escape');
    await openDiagram(page);
    await page.locator('.canvas-edge-label[data-mermaid-edge-id="edge-1"]').click();
    await page.locator('.canvas-fit-button').click();
    await page.locator('.canvas-zoom-value').click();
    const canvasLine = page.locator('g.canvas-edge[data-mermaid-edge-id="edge-1"] > .canvas-edge-visible');
    const canvas = await capture(page, canvasLine, info, 'solid-canvas');
    assertShape(canvas, canvas, shape); assertShaft(canvas, false);
    await page.locator('.canvas-context-select select').selectOption(dotted);
    const changed = await capture(page, canvasLine, info, 'dotted-canvas');
    assertShape(canvas, changed, shape); assertShaft(changed, true);
    await page.locator('.history-tools button').nth(0).click();
    const undo = await capture(page, canvasLine, info, 'undo-canvas');
    assertShape(canvas, undo, shape); assertShaft(undo, false);
    await page.locator('.history-tools button').nth(1).click();
    const redo = await capture(page, canvasLine, info, 'redo-canvas');
    assertShape(canvas, redo, shape); assertShaft(redo, true);
    expect(await draftSource(page)).toBe(changedSource);
    await showCanvas(page);
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    const inlineChanged = await capture(page, previewLine, info, 'dotted-inline');
    assertShape(inline, inlineChanged, shape); assertShaft(inlineChanged, true);
    expect(await savedSource(page)).toBe(markdown(changedSource));
    await page.getByRole('button', { name: '全屏查看图表', exact: true }).click();
    const fullChanged = await capture(page, fullLine, info, 'dotted-fullscreen');
    assertShape(full, fullChanged, shape); assertShaft(fullChanged, true);
    await page.keyboard.press('Escape');
  });
}
