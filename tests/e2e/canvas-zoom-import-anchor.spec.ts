import { expect, test } from '@playwright/test';
import { launchDocument } from './helpers';

// Fabricated fixture; the second graph is imported into an already open workspace.
const synthetic = {
  "originalDocument": "# SYNTHETIC canvas navigation\n\nFabricated acceptance data only.\n\n```mermaid\nflowchart TD\n  Start([\"Synthetic_NodeBase\"])\n  Input[\"Receive request\"]\n  Check{\"Valid?\"}\n  Process[\"Process request\"]\n  Error[\"Return error\"]\n  End([\"End\"])\n  Start -->|Synthetic_EdgeBase| Input\n  Input --> Check\n  Check -->|Yes| Process\n  Check -->|No| Error\n  Process --> End\n  Error --> End\n```\n\nSYNTHETIC_END\n",
  "source": "flowchart TD\n  Start([\"Synthetic_NodeBase\"])\n  Input[\"Receive request\"]\n  Check{\"Valid?\"}\n  Process[\"Process request\"]\n  Error[\"Return error\"]\n  End([\"End\"])\n  Start -->|Synthetic_EdgeBase| Input\n  Input --> Check\n  Check -->|Yes| Process\n  Check -->|No| Error\n  Process --> End\n  Error --> End\n  QA_A --> QA_B\n  QA_B --> QA_C\n  QA_A[\"SYNTHETIC_A\"]\n  subgraph QA_Group[\"SYNTHETIC copy group\"]\n  QA_B[\"SYNTHETIC_B 中间节点 long label 🙂\"]\n  end\n  QA_C[\"SYNTHETIC_C\"]"
};

for (const locale of ['zh-CN', 'en']) test(`${locale}: first zoom reset after importing and fitting a selected node preserves the visible center`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 868 });
  await launchDocument(page, synthetic.originalDocument);
  await page.locator('.language-switcher').selectOption(locale);
  await page.getByRole('button', {name: /在可视化画布中编辑图表|Edit diagram on the visual canvas/}).click();
  await page.locator('.workbench-tabs').getByRole('button', { name: /^(源码|Source)$/ }).click();
  await page.getByRole('textbox', { name: /Mermaid 源码编辑器|Mermaid source editor/ }).fill(synthetic.source);
  await page.locator('.workbench-tabs').getByRole('button', {name:/^(画布|Canvas)$/}).click();
  const root = page.locator('.mermaid-canvas-editor');
  await root.locator('.canvas-fit-button').click();
  await root.locator('.mermaid-canvas-node[data-mermaid-node-id="QA_B"]').click();
  await root.getByRole('button', { name: /^(选区|Selection)$/ }).click();
  const snapshot = () => root.evaluate(root => {
    const view = root.querySelector<HTMLElement>('.canvas-editor-viewport')!;
    const stage = root.querySelector<HTMLElement>('.canvas-editor-stage')!;
    const node = root.querySelector<HTMLElement>('[data-mermaid-node-id="QA_B"].mermaid-canvas-node')!;
    const v = view.getBoundingClientRect(), n = node.getBoundingClientRect(), s = stage.getBoundingClientRect();
    return { node: [n.x+n.width/2,n.y+n.height/2], center: [v.x+view.clientWidth/2,v.y+view.clientHeight/2], stage: [s.x,s.y], scroll: [view.scrollLeft,view.scrollTop], zoom: new DOMMatrix(getComputedStyle(stage).transform).a };
  });
  const before = await snapshot();
  await page.screenshot({ path: testInfo.outputPath('before.png') });
  await root.locator('.canvas-zoom-value').click();
  const after = await snapshot();
  await page.screenshot({ path: testInfo.outputPath('after.png') });
  await testInfo.attach('center-geometry', { body: JSON.stringify({ before, after }), contentType: 'application/json' });
  expect(after.zoom).toBe(1);
  for (const axis of [0,1]) {
    expect(Math.abs(before.node[axis]-before.center[axis])).toBeLessThan(3);
    const expected = before.center[axis] + (before.node[axis]-before.center[axis])/before.zoom;
    expect(Math.abs(after.node[axis]-expected)).toBeLessThanOrEqual(2);
  }
});
