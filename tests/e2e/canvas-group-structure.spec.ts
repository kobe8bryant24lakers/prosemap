import { expect, test, type Page } from '@playwright/test';
import { parseMermaidVisualSource } from '../../lib/mermaid-workbench';
import fixtures from '../fixtures/canvas-group-templates.json' with { type: 'json' };
import { editorSource, draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

async function graph(page: Page) {
  const parsed = parseMermaidVisualSource(await draftSource(page));
  expect(parsed).not.toBeNull();
  await showCanvas(page);
  return parsed!;
}
const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
const node = (page: Page, id: string) => page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"]`);
const parent = (page: Page, id: string) => page.getByRole('combobox', { name: `父级分组 ${id}`, exact: true });
const positions = (page: Page) => page.locator('.mermaid-canvas-node, .canvas-group-boundary').evaluateAll(elements => elements.map(element => ({ id: (element as HTMLElement).dataset.mermaidNodeId ?? element.querySelector('span')!.textContent, style: (element as HTMLElement).style.cssText })));

async function expectGroupGeometry(page: Page, current: NonNullable<ReturnType<typeof parseMermaidVisualSource>>) {
  const geometry = await page.locator('.mermaid-canvas-editor').evaluate(root => {
    const box = (element: HTMLElement) => ({ x: parseFloat(element.style.left), y: parseFloat(element.style.top), width: parseFloat(element.style.width), height: parseFloat(element.style.height) });
    return {
      nodes: Array.from(root.querySelectorAll<HTMLElement>('.mermaid-canvas-node')).map(element => ({ id: element.dataset.mermaidNodeId, ...box(element) })),
      groups: Array.from(root.querySelectorAll<HTMLElement>('.canvas-group-boundary')).map(element => ({ label: element.querySelector('span')!.textContent, ...box(element) })),
    };
  });
  const ancestors = (id?: string) => { const result = new Set<string>(); while (id) { result.add(id); id = current.data!.groups!.find(group => group.id === id)?.parentId; } return result; };
  const separate = (a: typeof geometry.nodes[number], b: typeof geometry.groups[number]) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  for (const group of current.data!.groups!) {
    const boundary = geometry.groups.find(box => box.label === group.label)!;
    for (const n of current.nodes) {
      const box = geometry.nodes.find(box => box.id === n.id)!;
      if (ancestors(n.data?.groupId).has(group.id)) expect(box.x >= boundary.x && box.y >= boundary.y && box.x + box.width <= boundary.x + boundary.width && box.y + box.height <= boundary.y + boundary.height, `${n.id} inside ${group.id}`).toBe(true);
      else expect(separate(box, boundary), `${n.id} outside ${group.id}`).toBe(true);
    }
    for (const other of current.data!.groups!) if (group.id !== other.id && !ancestors(group.parentId).has(other.id) && !ancestors(other.parentId).has(group.id)) {
      const box = geometry.groups.find(box => box.label === other.label)!;
      expect(separate({ id: other.id, ...box }, boundary), `${other.id} separate from ${group.id}`).toBe(true);
    }
  }
}

for (const item of fixtures.templates) {
  test(`${item.template}: group controls, cycle exclusion, reparenting and dissolve preserve contents`, async ({ page }) => {
    const document = `# SYNTHETIC group hierarchy\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`;
    await launchDocument(page, document);
    expect(await editorSource(page)).toBe(document);
    await openDiagram(page);
    const before = parseMermaidVisualSource(item.source)!;
    const panel = page.locator('.canvas-groups-panel');
    await expect(panel.locator('summary')).toContainText(String(item.initialGroups));
    await panel.locator('summary').click();
    for (const group of before.data!.groups!) {
      await expect(page.getByRole('textbox', { name: `分组名称 ${group.id}`, exact: true })).toHaveValue(group.label);
      await expect(parent(page, group.id)).toHaveValue(group.parentId ?? '');
      await expect(page.getByRole('button', { name: `解散分组 ${group.label}`, exact: true })).toBeVisible();
    }
    for (const [id, excluded] of [['SyntheticOuter', ['SyntheticOuter', 'SyntheticMiddle', 'SyntheticInner']], ['SyntheticMiddle', ['SyntheticMiddle', 'SyntheticInner']], ['SyntheticInner', ['SyntheticInner']]] as const) {
      for (const candidate of excluded) await expect(parent(page, id).locator(`option[value="${candidate}"]`)).toHaveCount(0);
      await expect(parent(page, id).locator('option[value="SyntheticOther"]')).toHaveCount(1);
    }
    await node(page, before.nodes[0].id).click();
    await node(page, before.nodes[0].id).press('Shift+ArrowRight');
    const initialPositions = await positions(page);
    await parent(page, 'SyntheticMiddle').selectOption('SyntheticOther');
    let current = await graph(page);
    expect(current.data!.groups!.find(group => group.id === 'SyntheticMiddle')!.parentId).toBe('SyntheticOther');
    expect(current.data!.groups!.find(group => group.id === 'SyntheticInner')!.parentId).toBe('SyntheticMiddle');
    expect(byId(current.nodes)).toEqual(byId(before.nodes));
    expect(current.edges).toEqual(before.edges);
    await expectGroupGeometry(page, current);
    const changedPositions = await positions(page);
    const independent = new Set(before.nodes.filter(n => ![item.collisionNode, 'SyntheticLeaf', 'SyntheticOtherNode', 'SyntheticOutside'].includes(n.id)).map(n => n.id));
    expect(changedPositions.filter(box => independent.has(box.id!))).toEqual(initialPositions.filter(box => independent.has(box.id!)));
    await page.locator('.history-tools button').first().click();
    expect(await positions(page)).toEqual(initialPositions);
    await page.locator('.history-tools button').nth(1).click();
    expect(await positions(page)).toEqual(changedPositions);
    await parent(page, 'SyntheticMiddle').selectOption('');
    current = await graph(page);
    expect(current.data!.groups!.find(group => group.id === 'SyntheticMiddle')!.parentId).toBeUndefined();
    await expectGroupGeometry(page, current);
    await parent(page, 'SyntheticMiddle').selectOption('SyntheticOuter');
    await page.getByRole('button', { name: '解散分组 SYNTHETIC Middle', exact: true }).click();
    current = await graph(page);
    expect(current.data!.groups).toHaveLength(item.initialGroups - 1);
    expect(current.data!.groups!.some(group => group.id === 'SyntheticMiddle')).toBe(false);
    expect(current.data!.groups!.find(group => group.id === 'SyntheticInner')!.parentId).toBe('SyntheticOuter');
    expect(byId(current.nodes)).toEqual(byId(before.nodes.map(n => n.id === item.collisionNode ? { ...n, data: { ...n.data, groupId: 'SyntheticOuter' } } : n)));
    expect(current.edges).toEqual(before.edges);
    await expectGroupGeometry(page, current);
    await page.locator('.history-tools button').first().click();
    current = await graph(page);
    expect(byId(current.data!.groups!)).toEqual(byId(before.data!.groups!));
    expect(byId(current.nodes)).toEqual(byId(before.nodes));
    expect(await editorSource(page)).toBe(document);
  });

  test(`${item.template}: membership changes preserve edges and new connected nodes inherit the group`, async ({ page }) => {
    await launchDocument(page, `# SYNTHETIC group membership\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    await openDiagram(page);
    const before = parseMermaidVisualSource(item.source)!;
    await node(page, 'SyntheticOutside').click();
    const membership = page.getByRole('combobox', { name: '所属包 / 边界', exact: true });
    await membership.selectOption('SyntheticInner');
    let current = await graph(page);
    expect(byId(current.nodes)).toEqual(byId(before.nodes.map(n => n.id === 'SyntheticOutside' ? { ...n, data: { groupId: 'SyntheticInner' } } : n)));
    expect(current.edges).toEqual(before.edges);
    await expectGroupGeometry(page, current);
    await membership.selectOption('');
    current = await graph(page);
    expect(current.nodes.find(n => n.id === 'SyntheticOutside')!.data?.groupId).toBeUndefined();
    expect(current.edges).toEqual(before.edges);
    await expectGroupGeometry(page, current);
    await node(page, 'SyntheticLeaf').click();
    await page.locator('.canvas-editor-toolbar').getByRole('button', { name: '节点', exact: true }).click();
    await page.locator('.mermaid-canvas-node input').fill('SYNTHETIC New member');
    await page.locator('.mermaid-canvas-node input').press('Enter');
    current = await graph(page);
    const added = current.nodes.find(n => n.label === 'SYNTHETIC New member')!;
    expect(added.data?.groupId).toBe('SyntheticInner');
    expect(current.edges).toEqual(before.edges);
    await expectGroupGeometry(page, current);
    await node(page, 'SyntheticLeaf').click();
    await page.locator('.canvas-context-bar').getByRole('button', { name: '下游流程', exact: true }).click();
    await page.locator('.mermaid-canvas-node input').fill('SYNTHETIC Connected member');
    await page.locator('.mermaid-canvas-node input').press('Enter');
    current = await graph(page);
    const connected = current.nodes.find(n => n.label === 'SYNTHETIC Connected member')!;
    expect(connected.data?.groupId).toBe('SyntheticInner');
    expect(current.edges.some(edge => edge.from === 'SyntheticLeaf' && edge.to === connected.id)).toBe(true);
    expect(current.edges.slice(0, before.edges.length)).toEqual(before.edges);
    await expectGroupGeometry(page, current);
    const bounds = await page.locator('.canvas-group-boundary').filter({ has: page.locator('span', { hasText: /^SYNTHETIC Inner$/ }) }).boundingBox();
    for (const id of [added.id, connected.id]) {
      const member = await node(page, id).boundingBox();
      expect(member!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(member!.y).toBeGreaterThanOrEqual(bounds!.y);
      expect(member!.x + member!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
      expect(member!.y + member!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
    }
  });
}
