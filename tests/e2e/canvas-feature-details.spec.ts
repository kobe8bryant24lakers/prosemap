import { expect, test, type Page } from '@playwright/test';
import { parseMermaidVisualSource } from '../../lib/mermaid-workbench';
import { draftSource, fixture, launchDocument, mod, openDiagram, showCanvas } from './helpers';

const node = (page: Page, id: string) => page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"]`);
const context = (page: Page) => page.locator('.canvas-context-bar');
const field = (page: Page, name: string) => {
  const panel = page.locator('.canvas-semantic-inspector');
  return panel.getByRole('combobox', { name, exact: true }).or(panel.getByRole('textbox', { name, exact: true }));
};
const graphEdges = (page: Page) => page.locator('g.canvas-edge');
const undo = (page: Page) => page.locator('.history-tools button').nth(0);

async function openSource(page: Page, source: string) {
  await launchDocument(page, `# Semantic controls\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`);
  await openDiagram(page);
  await page.locator('.canvas-fit-button').click();
}

async function openFixture(page: Page, file: string) {
  await launchDocument(page, fixture(`diagrams/${file}`));
  await openDiagram(page);
  await page.locator('.canvas-fit-button').click();
}

async function graph(page: Page) {
  const source = await draftSource(page);
  const result = parseMermaidVisualSource(source);
  expect(result, source).not.toBeNull();
  await showCanvas(page);
  return result!;
}

async function selectEdge(page: Page, id: string) {
  const label = page.locator(`.canvas-edge-label[data-mermaid-edge-id="${id}"]`);
  if (await label.count()) await label.click();
  else {
    const hit = page.locator(`g.canvas-edge[data-mermaid-edge-id="${id}"] .canvas-edge-hit`);
    await hit.scrollIntoViewIfNeeded();
    const p = await hit.evaluate(element => {
      const path = element as SVGPathElement, location = path.getPointAtLength(path.getTotalLength() / 2);
      const point = new DOMPoint(location.x, location.y).matrixTransform(path.getScreenCTM()!);
      return { x: point.x, y: point.y };
    });
    await page.mouse.click(p.x, p.y);
  }
  await expect(page.locator(`g.canvas-edge[data-mermaid-edge-id="${id}"]`)).toHaveClass(/selected/);
}

async function connect(page: Page, from: string, to: string) {
  await node(page, from).click();
  await page.keyboard.press('c');
  await node(page, to).click();
}

async function finishConnection(page: Page) {
  const done = context(page).getByRole('button', { name: '完成', exact: true });
  if (await done.count()) await done.click();
}

async function finishNewLabel(page: Page, text: string) {
  const input = page.locator('.mermaid-canvas-node input');
  await expect(input).toBeVisible();
  await input.fill(text);
  await input.press('Enter');
}

async function applyAndRender(page: Page) {
  const source = await draftSource(page);
  await test.info().attach('final-mermaid-source', { body: source, contentType: 'text/plain' });
  await page.getByRole('button', { name: '应用到文档', exact: true }).click();
  await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
  await expect(page.locator('.preview-pane .mermaid-svg svg')).toHaveCount(1);
  await expect(page.locator('.preview-pane .mermaid-error')).toHaveCount(0);
}

for (const item of [
  { kind: 'class', file: '06-class.md', id: 'Order', prefix: '类成员', add: '添加成员', value: '+String trackingCode', invalid: '+bad{}' },
  { kind: 'er', file: '07-er.md', id: 'ORDER', prefix: '实体字段', add: '添加字段', value: 'string tracking_code UK', invalid: 'string bad{}' },
]) {
  test(`${item.kind}: add, edit and delete eight detail rows without losing hidden members`, async ({ page }) => {
    await openFixture(page, item.file);
    // Fixture identifiers are looked up from parsed source, but every mutation is UI driven.
    const initialGraph = await graph(page);
    const target = initialGraph.nodes.find(candidate => candidate.id === item.id) ?? initialGraph.nodes.find(candidate => candidate.data?.details?.length)!;
    await node(page, target.id).click();
    const inputs = page.locator('.canvas-detail-list input');
    while (await inputs.count() < 8) await page.getByRole('button', { name: item.add, exact: true }).click();
    await page.getByRole('textbox', { name: `${item.prefix} 8`, exact: true }).fill(item.value);
    await expect(node(page, target.id).locator('.canvas-node-details > span')).toHaveCount(6);
    let current = await graph(page);
    expect(current.nodes.find(candidate => candidate.id === target.id)!.data!.details).toHaveLength(8);
    expect(current.nodes.find(candidate => candidate.id === target.id)!.data!.details![7]).toBe(item.value);
    await node(page, target.id).click();
    const values = await inputs.evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value));
    await page.getByRole('button', { name: '删除第 2 项', exact: true }).click();
    expect(await inputs.evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))).toEqual(values.filter((_, index) => index !== 1));
    await undo(page).click();
    await node(page, target.id).click();
    expect(await inputs.evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))).toEqual(values);
    await page.getByRole('textbox', { name: `${item.prefix} 8`, exact: true }).fill(item.invalid);
    await expect(page.locator('.workbench-footer .error')).toContainText('不能包含');
    await page.getByRole('textbox', { name: `${item.prefix} 8`, exact: true }).fill(item.value);
    current = await graph(page);
    expect(current.nodes.find(candidate => candidate.id === target.id)!.data!.details![7]).toBe(item.value);
    await applyAndRender(page);
  });
}

test('class: all relationship types retain multiplicities and reverse the correct endpoints', async ({ page }) => {
  await openSource(page, 'classDiagram\n  direction LR\n  class A {\n    +String id\n  }\n  class B\n  class C\n  A "1" --> "0..*" B : owns');
  const relation = ['-->', '--', '<|--', '*--', 'o--', '..>', '..|>', '..'];
  for (const token of relation) {
    await selectEdge(page, 'edge-1');
    await field(page, '关系类型').selectOption(token);
    await expect(field(page, '起点多重性')).toHaveValue('1');
    await expect(field(page, '终点多重性')).toHaveValue('0..*');
    const current = await graph(page);
    expect(current.edges[0].data!.token).toBe(`"1" ${token} "0..*"`);
  }
  await selectEdge(page, 'edge-1');
  await field(page, '起点多重性').fill('2');
  await field(page, '终点多重性').fill('1..*');
  await context(page).getByRole('button', { name: /^反向/ }).click();
  await expect(field(page, '起点')).toHaveValue('B');
  await expect(field(page, '终点')).toHaveValue('A');
  await expect(field(page, '起点多重性')).toHaveValue('1..*');
  await expect(field(page, '终点多重性')).toHaveValue('2');
  await field(page, '终点').selectOption('C');
  expect((await graph(page)).edges[0]).toMatchObject({ from: 'B', to: 'C', label: 'owns' });
  await applyAndRender(page);
});

test('ER: all cardinality pairs, identifying mode, reversal and endpoint changes are retained', async ({ page }) => {
  await openSource(page, 'erDiagram\n  direction LR\n  A ||--o{ B : owns\n  A {\n    string id PK\n  }\n  B {\n    string id PK\n  }\n  C');
  const cardinalities = ['one', 'zero-one', 'one-many', 'zero-many'];
  const left = ['||', '|o', '}|', '}o'], right = ['||', 'o|', '|{', 'o{'];
  for (let a = 0; a < cardinalities.length; a++) for (let b = 0; b < cardinalities.length; b++) {
    await selectEdge(page, 'edge-1');
    await field(page, '起点基数').selectOption(cardinalities[a]);
    await field(page, '终点基数').selectOption(cardinalities[b]);
    expect((await graph(page)).edges[0].data!.token).toBe(`${left[a]}--${right[b]}`);
  }
  await selectEdge(page, 'edge-1');
  await field(page, '起点基数').selectOption('one');
  await field(page, '终点基数').selectOption('zero-many');
  await field(page, '关系').selectOption('non-identifying');
  await context(page).getByRole('button', { name: /^反向/ }).click();
  await expect(field(page, '起点基数')).toHaveValue('zero-many');
  await expect(field(page, '终点基数')).toHaveValue('one');
  await field(page, '终点').selectOption('C');
  expect((await graph(page)).edges[0]).toMatchObject({ from: 'B', to: 'C', data: { token: '}o..||' } });
  await applyAndRender(page);
});

test('Gantt: task section, ID, dates, duration and all statuses round-trip through forms', async ({ page }) => {
  await openFixture(page, '09-gantt.md');
  await node(page, 'req').click();
  await field(page, '分组').fill('验收设计');
  await field(page, '任务 ID').fill('research');
  await field(page, '开始').fill('2026-10-06');
  await field(page, '工期 / 结束').fill('5d');
  for (const label of ['进行中', '已完成', '关键', '里程碑']) {
    const button = page.getByRole('group', { name: '任务状态', exact: true }).getByRole('button', { name: label, exact: true });
    const wasActive = (await button.getAttribute('class'))?.includes('active');
    await button.click();
    await expect(button).toHaveClass(wasActive ? /^$/ : /active/);
    await button.click();
    await expect(button).toHaveClass(wasActive ? /active/ : /^$/);
  }
  let current = await graph(page);
  const task = current.nodes.find(candidate => candidate.data?.ref === 'research')!;
  expect(task.data).toMatchObject({ ganttSection: '验收设计', ganttStart: '2026-10-06', ganttTiming: ['5d'] });
  expect(current.edges.filter(edge => edge.from === task.id)).toHaveLength(2);
  // The canvas keeps its stable object ID while the serialized task ref changes.
  await node(page, 'req').click();
  await field(page, '任务 ID').fill('design');
  await expect(page.locator('.workbench-footer .error')).toContainText('不能重复');
  await field(page, '任务 ID').fill('research_final');
  await field(page, '工期 / 结束').fill('2026-10-15');
  current = await graph(page);
  expect(current.nodes.find(candidate => candidate.data?.ref === 'research_final')!.data!.ganttTiming).toEqual(['2026-10-15']);
  await applyAndRender(page);
});

test('Gantt: dependent and parallel creation, last-dependency removal and dates remain valid', async ({ page }) => {
  await openSource(page, 'gantt\n  dateFormat YYYY-MM-DD\n  section Delivery\n  Research :a, 2026-10-01, 2d\n  Build :b, after a, 3d\n  Test :c, after a b, 2d');
  await node(page, 'b').click();
  await expect(field(page, '开始')).toBeDisabled();
  await context(page).getByRole('button', { name: '后续任务', exact: true }).click();
  await finishNewLabel(page, 'Followup');
  let current = await graph(page);
  const next = current.nodes.find(candidate => candidate.label === 'Followup')!;
  expect(current.edges.some(edge => edge.from === 'b' && edge.to === next.id)).toBe(true);
  await node(page, 'b').click();
  await context(page).getByRole('button', { name: '并行任务', exact: true }).click();
  await finishNewLabel(page, 'Parallel');
  current = await graph(page);
  const parallel = current.nodes.find(candidate => candidate.label === 'Parallel')!;
  expect(current.edges.some(edge => edge.to === parallel.id)).toBe(false);
  expect(parallel.data!.ganttStart).toBeTruthy();
  await node(page, 'b').click();
  await context(page).getByRole('button', { name: '里程碑', exact: true }).click();
  await finishNewLabel(page, 'Milestone');
  current = await graph(page);
  expect(current.nodes.find(candidate => candidate.label === 'Milestone')!.data!.ganttStatuses).toContain('milestone');
  const edge = current.edges.find(candidate => candidate.from === 'a' && candidate.to === 'b')!;
  await selectEdge(page, edge.id);
  await context(page).getByRole('button', { name: '删除', exact: true }).click();
  await node(page, 'b').click();
  await expect(field(page, '开始')).toBeEnabled();
  await expect(field(page, '开始')).toHaveValue('2026-10-01');
  await applyAndRender(page);
});

test('Gantt: cycles, duplicate dependencies and self-dependencies are rejected without edits', async ({ page }) => {
  await openSource(page, 'gantt\n  dateFormat YYYY-MM-DD\n  A :a, 2026-10-01, 1d\n  B :b, after a, 1d\n  C :c, after b, 1d');
  for (const [from, to, message] of [['a', 'a', '自身'], ['a', 'b', '不能重复'], ['c', 'a', '循环']]) {
    await connect(page, from, to);
    await expect(page.locator('.canvas-navigation-hint [role="status"]')).toContainText(message);
    await expect(graphEdges(page)).toHaveCount(2);
    await finishConnection(page);
  }
  await expect(undo(page)).toBeDisabled();
  await selectEdge(page, 'edge-1');
  await expect(field(page, '前置任务').locator('option[value="c"]')).toHaveJSProperty('disabled', true);
  await applyAndRender(page);
});

test('state: degree rules control conversions and pseudo-state edges stay protected', async ({ page }) => {
  await openSource(page, 'stateDiagram-v2\n  direction LR\n  A --> B\n  B --> C');
  await node(page, 'B').click();
  const tools = page.getByRole('group', { name: '状态类型', exact: true });
  await expect(tools.getByRole('button', { name: '开始', exact: true })).toBeDisabled();
  await expect(tools.getByRole('button', { name: '结束', exact: true })).toBeDisabled();
  await node(page, 'A').click();
  await tools.getByRole('button', { name: '开始', exact: true }).click();
  await expect(node(page, 'A')).toHaveClass(/role-start/);
  await expect(context(page).getByRole('button', { name: '改名', exact: true })).toHaveCount(0);
  await expect(context(page).getByRole('button', { name: '复制', exact: true })).toHaveCount(0);
  await selectEdge(page, 'edge-1');
  await expect(page.locator('.canvas-edge-inspector')).toContainText('由状态语义固定');
  await expect(context(page).getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
  await node(page, 'A').click();
  await tools.getByRole('button', { name: '普通状态', exact: true }).click();
  await expect(node(page, 'A')).toHaveClass(/role-state/);
  await node(page, 'C').click();
  await tools.getByRole('button', { name: '结束', exact: true }).click();
  expect((await graph(page)).nodes.filter(candidate => candidate.data?.stateRole === 'end')).toHaveLength(1);
  await applyAndRender(page);
});

test('state: add start/end around a normal state and delete it without orphan pseudo-states', async ({ page }) => {
  await openSource(page, 'stateDiagram-v2\n  A\n  B');
  const library = page.locator('.canvas-node-library');
  await expect(library.getByRole('button', { name: '起点', exact: true })).toBeDisabled();
  await node(page, 'A').click();
  await context(page).getByRole('button', { name: '添加起点', exact: true }).click();
  await node(page, 'A').click();
  await context(page).getByRole('button', { name: '添加终点', exact: true }).click();
  let current = await graph(page);
  expect(current.nodes.filter(candidate => candidate.data?.stateRole === 'start')).toHaveLength(1);
  expect(current.nodes.filter(candidate => candidate.data?.stateRole === 'end')).toHaveLength(1);
  await node(page, 'A').click();
  await context(page).getByRole('button', { name: '删除', exact: true }).click();
  current = await graph(page);
  expect(current.nodes.map(candidate => candidate.id)).toEqual(['B']);
  expect(current.edges).toHaveLength(0);
  await undo(page).click();
  expect((await graph(page)).nodes).toHaveLength(4);
  await applyAndRender(page);
});

const mindSource = 'mindmap\n  root((Root))\n    A["A"]\n      A1["A1"]\n      A2["A2"]\n    B["B"]';
test('mindmap: child, sibling and internal deletion preserve the tree', async ({ page }) => {
  await openSource(page, mindSource);
  await node(page, 'A1').click();
  await context(page).getByRole('button', { name: '子主题', exact: true }).click();
  await finishNewLabel(page, 'Child');
  let current = await graph(page);
  const child = current.nodes.find(candidate => candidate.label === 'Child')!;
  expect(current.edges.some(edge => edge.from === 'A1' && edge.to === child.id)).toBe(true);
  await node(page, 'A1').click();
  await context(page).getByRole('button', { name: '同级主题', exact: true }).click();
  await finishNewLabel(page, 'Sibling');
  current = await graph(page);
  const sibling = current.nodes.find(candidate => candidate.label === 'Sibling')!;
  expect(current.edges.some(edge => edge.from === 'A' && edge.to === sibling.id)).toBe(true);
  await node(page, 'A').click();
  await context(page).getByRole('button', { name: '删除', exact: true }).click();
  current = await graph(page);
  for (const id of ['A1', 'A2', sibling.id]) expect(current.edges.some(edge => edge.from === 'root' && edge.to === id)).toBe(true);
  expect(current.edges.some(edge => edge.from === 'A1' && edge.to === child.id)).toBe(true);
  await applyAndRender(page);
});

test('mindmap: reparenting rejects cycles and deleting root selects a valid new root', async ({ page }) => {
  await openSource(page, mindSource);
  await connect(page, 'B', 'A1');
  await finishConnection(page);
  let current = await graph(page);
  expect(current.edges.some(edge => edge.from === 'B' && edge.to === 'A1')).toBe(true);
  expect(current.edges.filter(edge => edge.to === 'A1')).toHaveLength(1);
  await connect(page, 'A1', 'B');
  await expect(page.locator('.canvas-navigation-hint [role="status"]')).toContainText('循环');
  await finishConnection(page);
  current = await graph(page);
  // Reparenting appends a stable canvas edge ID; parsing source renumbers edges.
  const linkId = await graphEdges(page).last().getAttribute('data-mermaid-edge-id');
  await selectEdge(page, linkId!);
  await expect(field(page, '子主题').locator('option[value="root"]')).toHaveJSProperty('disabled', true);
  await context(page).getByRole('button', { name: '移到根主题', exact: true }).click();
  expect((await graph(page)).edges.some(edge => edge.from === 'root' && edge.to === 'A1')).toBe(true);
  await node(page, 'root').click();
  await context(page).getByRole('button', { name: '删除', exact: true }).click();
  current = await graph(page);
  expect(current.nodes.filter(candidate => candidate.data?.mindRoot)).toHaveLength(1);
  expect(current.edges).toHaveLength(current.nodes.length - 1);
  await applyAndRender(page);
});

test('package: naming, nested parent selection, membership and dissolve preserve content', async ({ page }) => {
  await openSource(page, 'flowchart LR\n  %% prosemap:package\n  subgraph Outer["Outer"]\n    subgraph Inner["Inner"]\n      A["A"]\n    end\n    B["B"]\n  end\n  subgraph Other["Other"]\n    C["C"]\n  end\n  A --> B\n  B --> C');
  await page.locator('.canvas-groups-panel summary').click();
  await page.getByRole('textbox', { name: '分组名称 Inner', exact: true }).fill('领域模块');
  await expect(page.getByRole('combobox', { name: '父级分组 Outer', exact: true }).locator('option[value="Inner"]')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '父级分组 Inner', exact: true }).locator('option[value="Inner"]')).toHaveCount(0);
  await page.getByRole('combobox', { name: '父级分组 Inner', exact: true }).selectOption('Other');
  let current = await graph(page);
  expect(current.data!.groups!.find(group => group.id === 'Inner')).toMatchObject({ label: '领域模块', parentId: 'Other' });
  await node(page, 'B').click();
  await page.getByRole('combobox', { name: '所属包 / 边界', exact: true }).selectOption('Inner');
  await page.getByRole('button', { name: '解散分组 领域模块', exact: true }).click();
  current = await graph(page);
  expect(current.nodes).toHaveLength(3);
  expect(current.edges).toHaveLength(2);
  expect(current.nodes.find(candidate => candidate.id === 'A')!.data!.groupId).toBe('Other');
  expect(current.nodes.find(candidate => candidate.id === 'B')!.data!.groupId).toBe('Other');
  expect(current.data!.groups!.some(group => group.id === 'Inner')).toBe(false);
  await node(page, 'A').click();
  await page.getByRole('combobox', { name: '所属包 / 边界', exact: true }).selectOption('');
  expect((await graph(page)).nodes.find(candidate => candidate.id === 'A')!.data?.groupId).toBeUndefined();
  await applyAndRender(page);
});

test('usecase: new actor stays external, new usecase follows its boundary and empty boundaries can dissolve', async ({ page }) => {
  await openFixture(page, '10-usecase.md');
  const before = await graph(page);
  const usecase = before.nodes.find(candidate => candidate.data?.groupId)!;
  await node(page, usecase.id).click();
  await page.locator('.canvas-editor-toolbar').getByRole('button', { name: '参与者', exact: true }).click();
  await finishNewLabel(page, '«actor» 验收参与者');
  let current = await graph(page);
  expect(current.nodes.find(candidate => candidate.label === '«actor» 验收参与者')!.data?.groupId).toBeUndefined();
  await node(page, usecase.id).click();
  await page.locator('.canvas-editor-toolbar').getByRole('button', { name: '用例', exact: true }).click();
  await finishNewLabel(page, '验收用例');
  current = await graph(page);
  expect(current.nodes.find(candidate => candidate.label === '验收用例')!.data?.groupId).toBe(usecase.data!.groupId);
  const count = current.data!.groups!.length;
  await page.locator('.canvas-editor-toolbar').getByRole('button', { name: '系统边界', exact: true }).click();
  current = await graph(page);
  expect(current.data!.groups).toHaveLength(count + 1);
  const added = current.data!.groups!.find(group => !before.data!.groups!.some(old => old.id === group.id))!;
  await page.locator('.canvas-groups-panel summary').click();
  await page.getByRole('button', { name: `解散分组 ${added.label}`, exact: true }).click();
  expect((await graph(page)).data!.groups).toHaveLength(count);
  await applyAndRender(page);
});

test('sequence: all ten arrow types, message order, reverse and participant roles remain editable', async ({ page }) => {
  await openSource(page, 'sequenceDiagram\n  participant A as Alpha\n  participant B as Beta\n  participant C as Gamma\n  A->>B: First\n  B-->>A: Second\n  B->>C: Third');
  for (const token of ['->>', '-->>', '->', '-->', '-)', '--)', '-x', '--x', '<<->>', '<<-->>']) {
    await selectEdge(page, 'edge-1');
    await context(page).getByRole('combobox', { name: '类型', exact: true }).selectOption(token);
    expect((await graph(page)).edges.find(edge => edge.id === 'edge-1')!.data!.token).toBe(token);
  }
  await selectEdge(page, 'edge-1');
  await expect(context(page).getByRole('button', { name: '提前', exact: true })).toBeDisabled();
  await context(page).getByRole('button', { name: '延后', exact: true }).click();
  expect((await graph(page)).edges.map(edge => edge.label)).toEqual(['Second', 'First', 'Third']);
  await selectEdge(page, 'edge-1');
  await context(page).getByRole('button', { name: /^反向/ }).click();
  let current = await graph(page);
  expect(current.edges.find(edge => edge.label === 'First')).toMatchObject({ from: 'B', to: 'A' });
  await node(page, 'B').click();
  await page.getByRole('group', { name: '参与者类型', exact: true }).getByRole('button', { name: '角色', exact: true }).click();
  await context(page).getByRole('button', { name: '自消息', exact: true }).click();
  const label = page.locator('.canvas-edge-label input');
  await label.fill('Self');
  await label.press('Enter');
  current = await graph(page);
  expect(current.nodes.find(candidate => candidate.id === 'B')!.data!.sequenceType).toBe('actor');
  expect(current.edges.find(edge => edge.label === 'Self')).toMatchObject({ from: 'B', to: 'B' });
  await applyAndRender(page);
});

for (const handle of ['west', 'east', 'south', 'south-west', 'south-east']) {
  test(`sequence: ${handle} handle changes only intended dimensions and undo restores them`, async ({ page }) => {
    await openSource(page, 'sequenceDiagram\n  participant A\n  participant B\n  A->>B: Request');
    await node(page, 'B').click();
    const frame = node(page, 'B').locator('.canvas-node-resize-frame');
    const size = async () => ({ width: await node(page, 'B').evaluate(element => parseFloat((element as HTMLElement).style.width)), height: await frame.evaluate(element => parseFloat((element as HTMLElement).style.height)) });
    const before = await size();
    const button = node(page, 'B').locator(`[data-resize-handle="${handle}"]`);
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.keyboard.down('Alt');
    await page.mouse.move(x + (handle.includes('west') ? -23 : handle === 'south' ? 0 : 23), y + (handle.includes('south') ? 17 : 0), { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const after = await size();
    if (handle === 'south') expect(after.width).toBe(before.width);
    else expect(after.width).toBeGreaterThan(before.width);
    if (handle.includes('south')) expect(after.height).toBeGreaterThan(before.height);
    else expect(after.height).toBe(before.height);
    await page.keyboard.press(`${mod}+z`);
    await node(page, 'B').click();
    expect(await size()).toEqual(before);
    await expect(undo(page)).toBeDisabled();
  });
}

test('flowchart: all node shapes, line styles and graph directions update source and remain reversible', async ({ page }) => {
  await openSource(page, 'flowchart LR\n  A["Alpha"]\n  B["Beta"]\n  A -->|message| B');
  for (const [label, shape] of [['矩形', 'rectangle'], ['圆角', 'rounded'], ['起止', 'terminal'], ['判断', 'decision'], ['圆形', 'circle'], ['数据', 'database']]) {
    await node(page, 'A').click();
    await page.getByRole('group', { name: '节点形状与快速创建', exact: true }).getByRole('button', { name: label, exact: true }).click();
    expect((await graph(page)).nodes.find(candidate => candidate.id === 'A')!.shape).toBe(shape);
  }
  for (const [label, style] of [['箭头', 'arrow'], ['直线', 'line'], ['虚线', 'dotted'], ['强调', 'thick']]) {
    await selectEdge(page, 'edge-1');
    await page.getByRole('group', { name: '连线样式', exact: true }).getByRole('button', { name: label, exact: true }).click();
    expect((await graph(page)).edges[0]).toMatchObject({ style, label: 'message' });
  }
  for (const [label, direction] of [['向下', 'TD'], ['向右', 'LR'], ['向上', 'BT'], ['向左', 'RL']]) {
    await page.getByRole('group', { name: '图表方向', exact: true }).getByRole('button', { name: label, exact: true }).click();
    const current = await graph(page);
    expect(current.direction).toBe(direction);
    expect(current.edges[0]).toMatchObject({ from: 'A', to: 'B' });
  }
  await applyAndRender(page);
});
