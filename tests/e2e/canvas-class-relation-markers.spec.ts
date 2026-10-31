import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, savedSource, showCanvas } from './helpers';

test.use({ deviceScaleFactor: 2 });
type Shape = 'none' | 'open' | 'triangle' | 'diamond' | 'filled-diamond';
// UML/Mermaid semantics, independent of the canvas's marker IDs/path strings.
const relations: [string, Shape, Shape, boolean][] = [
  ['-->', 'none', 'open', false], ['--', 'none', 'none', false],
  ['<|--', 'triangle', 'none', false], ['*--', 'filled-diamond', 'none', false],
  ['o--', 'diamond', 'none', false], ['..>', 'none', 'open', true],
  ['..|>', 'none', 'triangle', true], ['..', 'none', 'none', true],
];
const sourceFor = (token: string) => `classDiagram
  direction LR
  %% SYNTHETIC relationship data
  class SyntheticA {
    +String id
    +open()
  }
  class SyntheticB {
    +int count
  }
  SyntheticA "1" ${token} "0..*" SyntheticB : synthetic relation`;
const markdown = (source: string) => `# SYNTHETIC class markers\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`;

async function capture(page: Page, info: TestInfo, stage: string) {
  await page.mouse.move(10, 10);
  await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)));
  const path = page.locator('g.canvas-edge[data-mermaid-edge-id="edge-1"] > .canvas-edge-visible');
  const geometry = await path.evaluate(element => {
    const line = element as SVGPathElement, matrix = line.getScreenCTM()!;
    const style = getComputedStyle(line);
    const endpoints = [line.getPointAtLength(0), line.getPointAtLength(line.getTotalLength())].map(p => {
      const q = new DOMPoint(p.x, p.y).matrixTransform(matrix); return { x: q.x, y: q.y };
    });
    const markers = ['marker-start', 'marker-end'].map(attribute => {
      const ref = line.getAttribute(attribute); if (!ref) return null;
      const id = ref.match(/#([^\s)'"*]+)/)![1];
      const shape = line.ownerDocument.getElementById(id)!.querySelector('path,polygon') as SVGGeometryElement;
      const box = shape.getBBox(), s = getComputedStyle(shape);
      const inside = (x: number, y: number) => shape.isPointInFill(new DOMPoint(box.x + box.width * x, box.y + box.height * y));
      return { fill: s.fill, stroke: s.stroke, strokeWidth: Number.parseFloat(s.strokeWidth),
        probes: [[.15,.15],[.5,.15],[.85,.15],[.15,.5],[.5,.5],[.85,.5]].map(([x,y]) => inside(x,y)) };
    });
    return { endpoints, markers, d: line.getAttribute('d'), dash: style.strokeDasharray, stroke: style.stroke };
  });
  expect(geometry.endpoints[1].x - geometry.endpoints[0].x).toBeGreaterThan(100);
  expect(geometry.endpoints[1].y).toBeCloseTo(geometry.endpoints[0].y, 1);
  const images = [];
  for (let side = 0; side < 2; side++) {
    const point = geometry.endpoints[side];
    // Stay on the relationship side of the node border. Exclude the horizontal
    // shaft when counting marker ink so a plain line cannot satisfy an arrow.
    const clip = { x: Math.floor(point.x + (side === 0 ? 2 : -30)), y: Math.floor(point.y - 18), width: 28, height: 36 };
    const png = await page.screenshot({ clip, animations: 'disabled', scale: 'device' });
    const decoded = await page.evaluate(async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image,0,0);
      return { data: [...ctx.getImageData(0,0,canvas.width,canvas.height).data], width: canvas.width, height: canvas.height };
    }, png.toString('base64'));
    await info.attach(`${stage}-${side}`, { body: png, contentType: 'image/png' });
    images.push({ ...decoded, y: (point.y - clip.y) * 2 });
  }
  return { geometry, images };
}

function assertShapes(value: Awaited<ReturnType<typeof capture>>, expected: Shape[], dashed: boolean) {
  expect(value.geometry.dash !== 'none' && !/^0(?:px)?(?:, 0(?:px)?)?$/.test(value.geometry.dash)).toBe(dashed);
  for (let side = 0; side < 2; side++) {
    const marker = value.geometry.markers[side], shape = expected[side];
    if (shape === 'none') expect(marker).toBeNull();
    else {
      expect(marker, `endpoint ${side} must paint ${shape}`).not.toBeNull();
      if (!marker) continue;
      if (shape === 'open') {
        const openPaint = marker.fill === 'none' || marker.fill === 'rgba(0, 0, 0, 0)' || !marker.probes[3];
        expect(openPaint, 'open arrow must not be a closed filled triangle').toBe(true);
      } else {
        expect(marker.strokeWidth).toBeGreaterThan(0);
        expect(marker.stroke).not.toBe('none');
        expect(marker.fill === marker.stroke, 'solid/hollow semantics').toBe(shape === 'filled-diamond');
        expect(marker.probes).toEqual(shape === 'triangle' ? [true,false,false,true,true,true] : [false,true,false,true,true,true]);
      }
    }
    const image = value.images[side];
    const color = (marker ? (marker.stroke === 'none' ? marker.fill : marker.stroke) : value.geometry.stroke).match(/[\d.]+/g)!.slice(0,3).map(Number);
    let ink = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4;
      if (Math.abs(y - image.y) > 4 && color.every((v,i) => Math.abs(image.data[offset+i]-v)<25)) ink++;
    }
    if (shape === 'none') expect(ink, 'no stray marker beyond shaft').toBeLessThan(5);
    else expect(ink, 'actual endpoint pixels contain the marker').toBeGreaterThan(5);
  }
}

for (const [token, start, end, dashed] of relations) {
  test(`class ${token} paints correct endpoints and preserves relation data through history`, async ({ page }, info) => {
    const baseToken = token === '-->' ? '--' : '-->', source = sourceFor(baseToken), changedSource = sourceFor(token);
    await launchDocument(page, markdown(source), 'synthetic-class-markers.md'); await openDiagram(page);
    await page.locator('.canvas-edge-label[data-mermaid-edge-id="edge-1"]').click();
    await page.locator('.canvas-fit-button').click();
    const baseline = await capture(page,info,'baseline');
    const inspector = page.locator('.canvas-semantic-inspector');
    await inspector.getByRole('combobox',{name:'关系类型',exact:true}).selectOption(token);
    await expect(inspector.getByRole('textbox',{name:'起点多重性',exact:true})).toHaveValue('1');
    await expect(inspector.getByRole('textbox',{name:'终点多重性',exact:true})).toHaveValue('0..*');
    const changed = await capture(page,info,'changed'); assertShapes(changed,[start,end],dashed);
    await page.locator('.history-tools button').nth(0).click();
    const undo = await capture(page,info,'undo'); expect(undo).toEqual(baseline);
    await page.locator('.history-tools button').nth(1).click();
    const redo = await capture(page,info,'redo'); expect(redo).toEqual(changed);
    expect(await draftSource(page)).toBe(changedSource); await showCanvas(page);
    await page.getByRole('button',{name:'应用到文档',exact:true}).click();
    await expect(page.locator('.preview-pane .mermaid-svg svg')).toBeVisible();
    expect(await savedSource(page)).toBe(markdown(changedSource));
  });
}
