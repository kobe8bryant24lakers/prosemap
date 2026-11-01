import { expect, test, type Page } from '@playwright/test';
import fixtures from '../fixtures/canvas-navigation-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram } from './helpers';

async function selectedAnchor(page: Page, id: string) {
  return page.locator('.mermaid-canvas-editor').evaluate((root, id) => {
    const viewport = root.querySelector<HTMLElement>('.canvas-editor-viewport')!;
    const node = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-canvas-node')).find(n => n.dataset.mermaidNodeId === id)!;
    // Sequence selection includes the participant's entire visible lifeline.
    // Fit selection centers that column, not just its header at the top.
    const selectionColumn = node.querySelector<HTMLElement>('.canvas-sequence-selection-column');
    const view = viewport.getBoundingClientRect(), rect = (selectionColumn ?? node).getBoundingClientRect();
    return {
      anchorKind: selectionColumn ? 'participant-and-lifeline' : 'node',
      selected: node.getAttribute('aria-pressed') === 'true',
      center: [rect.x + rect.width / 2, rect.y + rect.height / 2],
      viewCenter: [view.x + viewport.clientWidth / 2, view.y + viewport.clientHeight / 2],
      visible: rect.x + rect.width / 2 >= view.x && rect.x + rect.width / 2 <= view.right
        && rect.y + rect.height / 2 >= view.y && rect.y + rect.height / 2 <= view.bottom,
      layout: Array.from(root.querySelectorAll<HTMLElement>('.mermaid-canvas-node')).map(n => [n.dataset.mermaidNodeId, n.style.left, n.style.top, n.style.width, n.style.height]),
    };
  }, id);
}

for (const item of fixtures.templates) {
  test(`${item.template}: a selected visible center remains stable while zooming from 100 to 200 percent`, async ({ page }, testInfo) => {
    await launchDocument(page, `# SYNTHETIC centered zoom\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    const root = page.locator('.mermaid-canvas-editor');
    await root.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`).click();
    await root.getByRole('button', { name: '选区', exact: true }).click();
    await root.locator('.canvas-zoom-value').click();
    const initial = await selectedAnchor(page, item.nodeId);
    expect(initial.selected).toBe(true); expect(initial.visible).toBe(true);
    // A blank viewport is not a valid precondition for visible-anchor acceptance.
    for (let axis = 0; axis < 2; axis++) expect(Math.abs(initial.center[axis] - initial.viewCenter[axis])).toBeLessThan(32);
    const anchors = [{ percent: 100, ...initial }];
    let previous = initial, previousPercent = 100;
    for (let i = 1; i <= 13; i++) {
      await root.getByRole('button', { name: '放大画布', exact: true }).click();
      await expect(root.locator('.canvas-zoom-value')).toHaveText(`${Math.min(100 + i * 10, 200)}%`);
      const actual = await selectedAnchor(page, item.nodeId), percent = Math.min(100 + i * 10, 200);
      anchors.push({ percent, ...actual });
      expect(actual.visible).toBe(true); expect(actual.selected).toBe(true);
      expect(actual.layout).toEqual(initial.layout);
      for (let axis = 0; axis < 2; axis++) {
        const expected = previous.viewCenter[axis] + (previous.center[axis] - previous.viewCenter[axis]) * percent / previousPercent;
        // Measure each action. Integer scroll rounding accumulates across actions,
        // especially in WebKit; it is not a new jump on the last zoom click.
        expect.soft(Math.abs(actual.center[axis] - expected), `${percent}% axis ${axis}`).toBeLessThanOrEqual(2);
      }
      previous = actual; previousPercent = percent;
    }
    await testInfo.attach('visible-node-anchors', { body: JSON.stringify(anchors), contentType: 'application/json' });
    expect(await draftSource(page)).toBe(item.source);
  });
}
