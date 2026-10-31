import { expect, test, type Locator, type Page } from '@playwright/test';
import { draftSource, launchDocument, mod, openDiagram, showCanvas } from './helpers';

// Synthetic browser fixtures. Installed-app text undo is verified separately.
const classSource = 'classDiagram\n  %% Synthetic property history\n  class A {\n    +String syntheticId\n  }\n  class B\n  A "1" --> "0..*" B : owns';
const erSource = 'erDiagram\n  %% Synthetic property history\n  A {\n    string synthetic_id\n  }\n  B {\n    string id\n  }\n  A ||--o{ B : owns';
const ganttSource = 'gantt\n  dateFormat YYYY-MM-DD\n  section Synthetic\n  A :a, 2026-10-01, until b\n  B :b, 2026-10-05, 1d\n  C :c, after b, 2d';
const groupSource = 'flowchart LR\n  %% prosemap:package\n  subgraph Synthetic["Synthetic group"]\n    A["Synthetic A"]\n  end\n  B["Synthetic B"]\n  A --> B';
const canvas = (page: Page) => page.getByRole('region', { name: 'Mermaid 可视化画布编辑器', exact: true });
const node = (page: Page, id: string) => page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"]`);
const undo = (page: Page) => page.locator('.history-tools button').first();
const redo = (page: Page) => page.locator('.history-tools button').nth(1);

async function openSource(page: Page, source: string) {
  await launchDocument(page, `# Synthetic property transactions\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`, 'synthetic-property-history.md');
  await openDiagram(page);
  await page.locator('.canvas-fit-button').click();
}

async function appendKeys(input: Locator, keys = ['x', 'y', 'z'], beforeLastCharacter = false) {
  await input.focus();
  await input.press(`${mod}+a`);
  await input.press('ArrowRight');
  if (beforeLastCharacter) await input.press('ArrowLeft');
  for (const key of keys) await input.press(key);
}

async function canvasUndo(page: Page) {
  await canvas(page).focus();
  await expect(canvas(page)).toBeFocused();
  await page.keyboard.press(`${mod}+z`);
}

type PropertyCase = {
  name: string; source: string; field: string; original: string; edited: string;
  target: 'node' | 'edge' | 'group'; nodeId?: string; keys?: string[]; beforeLastCharacter?: boolean;
};
const properties: PropertyCase[] = [
  { name: 'class member', source: classSource, target: 'node', nodeId: 'A', field: '类成员 1', original: '+String syntheticId', edited: '+String syntheticIdxyz' },
  { name: 'ER field', source: erSource, target: 'node', nodeId: 'A', field: '实体字段 1', original: 'string synthetic_id', edited: 'string synthetic_idxyz' },
  { name: 'Gantt section', source: ganttSource, target: 'node', nodeId: 'b', field: '分组', original: 'Synthetic', edited: 'Syntheticxyz' },
  { name: 'Gantt ID with after and until references', source: ganttSource, target: 'node', nodeId: 'b', field: '任务 ID', original: 'b', edited: 'bxyz' },
  { name: 'Gantt duration', source: ganttSource, target: 'node', nodeId: 'b', field: '工期 / 结束', original: '1d', edited: '1234d', keys: ['2', '3', '4'], beforeLastCharacter: true },
  { name: 'package name', source: groupSource, target: 'group', field: '分组名称 Synthetic', original: 'Synthetic group', edited: 'Synthetic groupxyz' },
  { name: 'class start multiplicity', source: classSource, target: 'edge', field: '起点多重性', original: '1', edited: '1..*', keys: ['.', '.', '*'] },
  { name: 'class end multiplicity', source: classSource, target: 'edge', field: '终点多重性', original: '0..*', edited: '0..*xyz' },
];

for (const item of properties) {
  test(`${item.name}: three accepted key edits form one canvas history entry`, async ({ page }) => {
    await openSource(page, item.source);
    if (item.target === 'node') await node(page, item.nodeId!).click();
    else if (item.target === 'edge') await page.locator('.canvas-edge-label[data-mermaid-edge-id="edge-1"]').click();
    else await page.locator('.canvas-groups-panel summary').click();
    const input = page.getByRole('textbox', { name: item.field, exact: true });
    await expect(input).toHaveValue(item.original);
    await appendKeys(input, item.keys, item.beforeLastCharacter);
    await expect(input).toHaveValue(item.edited);
    const editedSource = await draftSource(page);
    expect(editedSource).not.toBe(item.source);
    if (item.field === '任务 ID') {
      expect(editedSource).toContain('until bxyz');
      expect(editedSource).toContain('after bxyz');
    }
    await showCanvas(page);
    await canvasUndo(page);
    expect(await draftSource(page)).toBe(item.source);
    await showCanvas(page);
    await expect(undo(page)).toBeDisabled();
    await redo(page).click();
    expect(await draftSource(page)).toBe(editedSource);
  });
}

test('Gantt dates group accepted corrections while incomplete drafts remain outside history', async ({ page }) => {
  const source = 'gantt\n  dateFormat YYYY-MM-DD\n  A :a, 2026-10-01, 1d';
  await openSource(page, source);
  await node(page, 'a').click();
  const input = page.getByRole('textbox', { name: '开始', exact: true });
  for (const value of ['2026-10-02', '2026-10-03', '2026-10-04']) {
    await input.press(`${mod}+a`);
    await input.press('Backspace');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await input.pressSequentially(value);
    await expect(input).toHaveAttribute('aria-invalid', 'false');
  }
  await canvasUndo(page);
  expect(await draftSource(page)).toBe(source);
  await showCanvas(page);
  await expect(undo(page)).toBeDisabled();
});

test('two focus sessions on the same field retain two separate undo boundaries', async ({ page }) => {
  await openSource(page, classSource);
  await node(page, 'A').click();
  const input = page.getByRole('textbox', { name: '类成员 1', exact: true });
  await appendKeys(input);
  const firstSource = await draftSource(page);
  await showCanvas(page);
  await appendKeys(input, ['a', 'b', 'c']);
  await expect(input).toHaveValue('+String syntheticIdxyzabc');
  await canvasUndo(page);
  expect(await draftSource(page)).toBe(firstSource);
  await showCanvas(page);
  await canvasUndo(page);
  expect(await draftSource(page)).toBe(classSource);
});

test('a structural button action after a property edit remains a separate history step', async ({ page }) => {
  await openSource(page, classSource);
  await node(page, 'A').click();
  const input = page.getByRole('textbox', { name: '类成员 1', exact: true });
  await appendKeys(input);
  await page.getByRole('button', { name: '添加成员', exact: true }).click();
  await expect(page.locator('.canvas-detail-list input')).toHaveCount(2);
  await undo(page).click();
  await expect(page.locator('.canvas-detail-list input')).toHaveCount(1);
  await expect(input).toHaveValue('+String syntheticIdxyz');
  await undo(page).click();
  expect(await draftSource(page)).toBe(classSource);
});

test('a toolbar action ends the property transaction even when it retains input focus', async ({ page }) => {
  await openSource(page, classSource);
  await node(page, 'A').click();
  const input = page.getByRole('textbox', { name: '类成员 1', exact: true });
  await appendKeys(input);
  await page.getByRole('button', { name: '自动排列', exact: true }).click();
  await expect(input).toBeFocused();
  await appendKeys(input, ['a', 'b', 'c']);
  await canvasUndo(page);
  await expect(input).toHaveValue('+String syntheticIdxyz');
  await undo(page).click();
  await expect(input).toHaveValue('+String syntheticIdxyz');
  await undo(page).click();
  expect(await draftSource(page)).toBe(classSource);
});

for (const kind of ['class', 'er'] as const) {
  test(`${kind}: input-local undo and redo do not add canvas history entries`, async ({ page }) => {
    const source = kind === 'class' ? classSource : erSource;
    await openSource(page, source);
    await node(page, 'A').click();
    const input = page.getByRole('textbox', { name: kind === 'class' ? '类成员 1' : '实体字段 1', exact: true });
    const original = await input.inputValue();
    await appendKeys(input);
    await input.press(`${mod}+z`);
    // Native browser typing groups may differ; retain ownership and verify redo
    // without requiring this browser to undo the same number of keys as macOS.
    await expect(input).not.toHaveValue(`${original}xyz`);
    await expect(input).toBeFocused();
    await input.press(`${mod}+Shift+z`);
    await expect(input).toHaveValue(`${original}xyz`);
    await canvasUndo(page);
    expect(await draftSource(page)).toBe(source);
    await showCanvas(page);
    await expect(undo(page)).toBeDisabled();
  });
}

test('a property edit locally undone to its original value preserves the prior redo branch', async ({ page }) => {
  await openSource(page, classSource);
  await node(page, 'A').click();
  await page.getByRole('button', { name: '添加成员', exact: true }).click();
  await undo(page).click();
  await expect(undo(page)).toBeDisabled();
  await expect(redo(page)).toBeEnabled();
  const input = page.getByRole('textbox', { name: '类成员 1', exact: true });
  const original = await input.inputValue();
  await appendKeys(input);
  for (let attempt = 0; attempt < 3 && await input.inputValue() !== original; attempt++) await input.press(`${mod}+z`);
  await expect(input).toHaveValue(original);
  await canvas(page).focus();
  await expect(undo(page)).toBeDisabled();
  await expect(redo(page)).toBeEnabled();
  await redo(page).click();
  await expect(page.locator('.canvas-detail-list input')).toHaveCount(2);
  await expect(input).toHaveValue(original);
});

test('a rejected initial Gantt ID draft does not consume the first valid history boundary', async ({ page }) => {
  await openSource(page, ganttSource);
  await node(page, 'b').click();
  const input = page.getByRole('textbox', { name: '任务 ID', exact: true });
  await input.press(`${mod}+a`);
  await input.press('Backspace');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(undo(page)).toBeDisabled();
  await input.press('b');
  await expect(undo(page)).toBeDisabled();
  for (const key of ['x', 'y', 'z']) await input.press(key);
  await expect(input).toHaveValue('bxyz');
  await canvasUndo(page);
  expect(await draftSource(page)).toBe(ganttSource);
  await showCanvas(page);
  await expect(undo(page)).toBeDisabled();
});

test('external source replacement ends property history without resurrecting its old source', async ({ page }) => {
  await openSource(page, classSource);
  await node(page, 'A').click();
  const input = page.getByRole('textbox', { name: '类成员 1', exact: true });
  await appendKeys(input);
  const edited = await draftSource(page);
  const external = `${edited.replace('Synthetic property history', 'Synthetic source replacement')}\n`;
  await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(external);
  await showCanvas(page);
  await expect(undo(page)).toBeDisabled();
  await expect(redo(page)).toBeDisabled();
  await node(page, 'A').click();
  await appendKeys(input, ['a', 'b', 'c']);
  await canvasUndo(page);
  expect(await draftSource(page)).toBe(external);
  await showCanvas(page);
  await expect(undo(page)).toBeDisabled();
});

test('an empty group-name transaction restores routed edges and stage bounds with the prior redo', async ({ page }) => {
  await openSource(page, groupSource);
  await page.locator('.canvas-groups-panel summary').click();
  const input = page.getByRole('textbox', { name: '分组名称 Synthetic', exact: true });
  const original = await input.inputValue();
  await appendKeys(input, ['r']);
  await canvasUndo(page);
  await expect(input).toHaveValue(original);
  await expect(redo(page)).toBeEnabled();
  const layout = () => page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.canvas-editor-stage')!;
    return {
      width: stage.style.width, height: stage.style.height,
      nodes: Array.from(document.querySelectorAll<HTMLElement>('.mermaid-canvas-node')).map(element => ({
        id: element.dataset.mermaidNodeId, left: element.style.left, top: element.style.top,
      })),
      paths: Array.from(document.querySelectorAll('.canvas-edge-visible')).map(element => element.getAttribute('d')),
    };
  });
  const before = await layout();
  await appendKeys(input);
  for (let attempt = 0; attempt < 3 && await input.inputValue() !== original; attempt++) await input.press(`${mod}+z`);
  await expect(input).toHaveValue(original);
  await canvas(page).focus();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await layout()).toEqual(before);
  await expect(undo(page)).toBeDisabled();
  await expect(redo(page)).toBeEnabled();
  await redo(page).click();
  await expect(input).toHaveValue(`${original}r`);
});
