import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, savedSource } from './helpers';

test.use({ deviceScaleFactor: 2 });
const cardinalities = ['one', 'zero-one', 'one-many', 'zero-many'] as const;
const left = ['||', '|o', '}|', '}o'], right = ['||', 'o|', '|{', 'o{'];
const previewNames = ['onlyOne', 'zeroOrOne', 'oneOrMore', 'zeroOrMore'];
// Independent Mermaid cardinality semantics; all eight menus and both line types.
const cases: [string, 'from' | 'to' | 'type', number, number, boolean, number][] = [
  ['EC11','from',1,3,true,0], ['EC12','from',0,2,false,1],
  ['EC13','from',0,1,true,2], ['EC14','from',0,0,false,3],
  ['EC21','to',2,3,false,0], ['EC22','to',3,0,true,1],
  ['EC23','to',1,0,false,2], ['EC24','to',0,0,true,3],
  ['ET1','type',1,2,false,1], ['ET2','type',2,1,true,0],
];
const sourceFor = (from: number, to: number, identifying: boolean, reversed = false) => `erDiagram
  direction LR
  SyntheticA {
    string id PK
  }
  SyntheticB {
    int id PK
  }
  SyntheticControl {
    string id PK
  }
  ${reversed ? 'SyntheticB' : 'SyntheticA'} ${left[from]}${identifying ? '--' : '..'}${right[to]} ${reversed ? 'SyntheticA' : 'SyntheticB'} : R1_synthetic
  SyntheticB |o..|{ SyntheticControl : R2_control`;
const markdown = (source: string) => `# SYNTHETIC ER markers\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`;

async function capture(page: Page, info: TestInfo, stage: string) {
  await page.mouse.move(10, 10);
  await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)));
  const geometry = await page.locator('g.canvas-edge[data-mermaid-edge-id="edge-1"] > .canvas-edge-visible').evaluate(element => {
    const path = element as SVGPathElement, matrix = path.getScreenCTM()!;
    const ends = [path.getPointAtLength(0), path.getPointAtLength(path.getTotalLength())].map(p => {
      const q = new DOMPoint(p.x, p.y).matrixTransform(matrix); return { x: q.x, y: q.y };
    });
    const markers = ['marker-start','marker-end'].map(attr => {
      const ref = path.getAttribute(attr); if (!ref) return null;
      const marker = document.getElementById(ref.match(/#([^\s)'"*]+)/)![1])!;
      const paths = [...marker.querySelectorAll('path')].map(p => {
        const length = p.getTotalLength();
        return Array.from({ length: 241 }, (_, i) => { const q = p.getPointAtLength(length*i/240); return { x:q.x, y:q.y }; });
      });
      const circles = [...marker.querySelectorAll('circle')].map(c => ({ x:c.cx.baseVal.value, r:c.r.baseVal.value, fill:getComputedStyle(c).fill, stroke:getComputedStyle(c).stroke }));
      const stroke = getComputedStyle(marker.querySelector('path,circle')!).stroke;
      return { paths, circles, stroke };
    });
    return { ends, markers, d:path.getAttribute('d'), dash:getComputedStyle(path).strokeDasharray };
  });
  const images = [];
  for (let side = 0; side < 2; side++) {
    const p = geometry.ends[side], towardRight = geometry.ends[1-side].x > p.x;
    const clip = { x:Math.floor(p.x+(towardRight?2:-42)), y:Math.floor(p.y-16), width:40, height:32 };
    const png = await page.screenshot({ clip, animations:'disabled', scale:'device' });
    await info.attach(`${stage}-${side}`, { body:png, contentType:'image/png' });
    const pixels = await page.evaluate(async data => {
      const image = new Image(); image.src=`data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
      const ctx=canvas.getContext('2d')!; ctx.drawImage(image,0,0);
      return { width:canvas.width, height:canvas.height, data:[...ctx.getImageData(0,0,canvas.width,canvas.height).data] };
    }, png.toString('base64'));
    images.push({ ...pixels, y:(p.y-clip.y)*2 });
  }
  return { geometry, images };
}

function assertCardinalities(value: Awaited<ReturnType<typeof capture>>, expected: number[], identifying: boolean) {
  expect(value.geometry.dash !== 'none' && !/^0(?:px)?(?:, 0(?:px)?)?$/.test(value.geometry.dash)).toBe(!identifying);
  for (let side=0; side<2; side++) {
    const marker=value.geometry.markers[side], cardinality=expected[side];
    expect(marker, `endpoint ${side} must display cardinality ${cardinalities[cardinality]}`).not.toBeNull();
    if (!marker) continue;
    const zero = cardinality===1 || cardinality===3, many=cardinality>=2;
    expect(marker.circles).toHaveLength(zero?1:0);
    const vertical = new Map<number,number>(), diagonal: {x:number;y:number}[]=[];
    for (const points of marker.paths) for (let i=1;i<points.length;i++) {
      const p=points[i], q=points[i-1], dx=Math.abs(p.x-q.x), dy=Math.abs(p.y-q.y);
      // Ignore discontinuous moves between subpaths; inspect actual geometry,
      // without depending on marker IDs, path strings or exact glyph dimensions.
      if (Math.hypot(dx,dy)>1.5) continue;
      if (dx<.001 && dy>.001) { const x=Math.round(p.x*20)/20; vertical.set(x,(vertical.get(x)??0)+1); }
      if (dx>.01 && dy>.01) diagonal.push(p);
    }
    const bars=[...vertical].filter(([,n])=>n>8).map(([x])=>x);
    expect(bars).toHaveLength(cardinality===0?2:cardinality===3?0:1);
    expect(diagonal.length>10).toBe(many);
    if (many) {
      const min=Math.min(...diagonal.map(p=>p.x)), max=Math.max(...diagonal.map(p=>p.x));
      const spread=(points: typeof diagonal)=>Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y));
      expect(spread(diagonal.filter(p=>p.x>max-(max-min)*.2))).toBeGreaterThan(spread(diagonal.filter(p=>p.x<min+(max-min)*.2)));
    }
    if (zero) {
      const circle=marker.circles[0]; expect(circle.r).toBeGreaterThan(0);
      expect(circle.fill).not.toBe('none'); expect(circle.fill).not.toBe(circle.stroke);
      expect(circle.x).toBeLessThan(many?Math.min(...diagonal.map(p=>p.x)):bars[0]);
    }
    const color=marker.stroke.match(/[\d.]+/g)!.slice(0,3).map(Number), image=value.images[side]; let ink=0;
    for(let y=0;y<image.height;y++) for(let x=0;x<image.width;x++) {
      const offset=(y*image.width+x)*4;
      if(Math.abs(y-image.y)>4 && color.every((v,i)=>Math.abs(image.data[offset+i]-v)<25)) ink++;
    }
    expect(ink,'actual cardinality pixels must exist off the line shaft').toBeGreaterThan(10);
  }
}

for (const [id,side,from,to,identifying,next] of cases) {
  test(`${id}: ER cardinality, line type and reversal paint correctly through history`, async ({page},info) => {
    const a=side==='from'?next:from, b=side==='to'?next:to, identity=side==='type'?Boolean(next):identifying;
    await launchDocument(page,markdown(sourceFor(from,to,identifying)),'synthetic-er-markers.md'); await openDiagram(page);
    await page.locator('.canvas-edge-label[data-mermaid-edge-id="edge-1"]').click(); await page.locator('.canvas-fit-button').click();
    const baseline=await capture(page,info,'baseline'), inspector=page.locator('.canvas-semantic-inspector');
    await inspector.getByRole('combobox',{name:side==='from'?'起点基数':side==='to'?'终点基数':'关系',exact:true}).selectOption(side==='type'?(identity?'identifying':'non-identifying'):cardinalities[next]);
    const changed=await capture(page,info,'changed'); assertCardinalities(changed,[a,b],identity);
    await expect(inspector.getByRole('combobox',{name:'起点基数',exact:true})).toHaveValue(cardinalities[a]);
    await expect(inspector.getByRole('combobox',{name:'终点基数',exact:true})).toHaveValue(cardinalities[b]);
    await page.locator('.history-tools button').nth(0).click(); expect(await capture(page,info,'undo')).toEqual(baseline);
    await page.locator('.history-tools button').nth(1).click(); expect(await capture(page,info,'redo')).toEqual(changed);
    await page.locator('.canvas-context-bar').getByRole('button',{name:/^反向/}).click();
    assertCardinalities(await capture(page,info,'reversed'),[b,a],identity);
    const final=sourceFor(b,a,identity,true); expect(await draftSource(page)).toBe(final);
    await page.getByRole('button',{name:'应用到文档',exact:true}).click();
    await expect(page.locator('.preview-pane .mermaid-svg svg')).toBeVisible();
    expect(await savedSource(page)).toBe(markdown(final));
    const rendered=await page.locator('.mermaid-svg .relationshipLine').first().evaluate(line=>({
      markers:['marker-start','marker-end'].map(attr=>document.getElementById(line.getAttribute(attr)!.match(/#([^\s)'"*]+)/)![1])!.getAttribute('class')),
      dash:getComputedStyle(line).strokeDasharray,
    }));
    expect(rendered.markers[0]).toContain(previewNames[b]); expect(rendered.markers[1]).toContain(previewNames[a]);
    expect(rendered.dash!=='none' && rendered.dash!=='0px').toBe(!identity);
  });
}
