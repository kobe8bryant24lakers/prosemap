import { expect, test, type Page } from '@playwright/test';
import { parseMermaidVisualSource } from '../../lib/mermaid-workbench';
import fixtures from '../fixtures/canvas-navigation-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

const connectedAction = {
  flowchart: '下游流程', sequence: '新参与者并发送', state: '下一状态',
  class: '关联类', er: '关联实体', mindmap: '子主题', gantt: '后续任务',
};

async function checkCounts(page: Page, expected: number[]) {
  const root = page.locator('.mermaid-canvas-editor');
  const status = await root.locator('.canvas-editor-status > span').first().innerText();
  const nodeCount = await root.locator('.mermaid-canvas-node').count();
  const source = await draftSource(page), graph = parseMermaidVisualSource(source);
  if (!graph) throw new Error('Synthetic count source must be parseable');
  expect(status.match(/\d+/g)?.map(Number)).toEqual(expected);
  expect(nodeCount).toBe(expected[0]);
  expect([graph.nodes.length, graph.edges.length]).toEqual(expected);
  await showCanvas(page);
  return source;
}

for (const item of fixtures.templates) {
  test(`${item.template}: counts match complete source after connected creation, deletion, duplication and undo`, async ({ page }, testInfo) => {
    await launchDocument(page, `# SYNTHETIC object counts\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    const root = page.locator('.mermaid-canvas-editor');
    const base = [item.nodes.length, item.edges], added = [base[0] + 1, base[1] + 1];
    const evidence = [{ phase: 'initial', source: await checkCounts(page, base) }];
    await root.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`).click();
    await root.getByRole('button', { name: connectedAction[item.kind as keyof typeof connectedAction], exact: true }).click();
    evidence.push({ phase: 'added', source: await checkCounts(page, added) });
    const addedId = await root.locator('.mermaid-canvas-node.selected').getAttribute('data-mermaid-node-id');
    expect(addedId).toBeTruthy();
    await root.getByRole('button', { name: '删除', exact: true }).click();
    evidence.push({ phase: 'deleted-connected', source: await checkCounts(page, base) });
    await root.locator('.history-tools button').first().click();
    evidence.push({ phase: 'undo-delete', source: await checkCounts(page, added) });
    await root.locator(`.mermaid-canvas-node[data-mermaid-node-id="${addedId}"]`).click();
    await root.getByRole('button', { name: '复制', exact: true }).click();
    const copied = [base[0] + 2, base[1] + 1 + (item.kind === 'mindmap' ? 1 : 0)];
    evidence.push({ phase: 'copied', source: await checkCounts(page, copied) });
    await root.locator('.history-tools button').first().click();
    evidence.push({ phase: 'undo-copy', source: await checkCounts(page, added) });
    await root.locator('.history-tools button').first().click();
    const restored = await checkCounts(page, base);
    expect(restored).toBe(item.source);
    evidence.push({ phase: 'undo-add', source: restored });
    await expect(root.locator('.history-tools button').first()).toBeDisabled();
    await testInfo.attach('synthetic-count-source-chain', { body: JSON.stringify(evidence), contentType: 'application/json' });
  });
}
