import { expect, test } from '@playwright/test';
import { parseMermaidVisualSource } from '../../lib/mermaid-workbench';
import { launchDocument } from './helpers';

// Synthetic user labels deliberately match UI translations. Only [*] labels
// belong to the interface; ordinary state names and source must stay verbatim.
const source = 'stateDiagram-v2\n  direction LR\n  state "开始" as A\n  state "结束" as B\n  state "Start" as C\n  state "End" as D\n  [*] --> A\n  A --> B: synthetic transition\n  B --> C\n  C --> D\n  D --> [*]';

test('state pseudonode display and accessibility labels follow locale without translating user content', async ({ page }) => {
  await launchDocument(page, `# Synthetic state locale\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`, 'synthetic-state-locale.md');
  for (const locale of ['en', 'zh-CN', 'en']) {
    await page.locator('.language-switcher').selectOption(locale);
    const english = locale === 'en';
    await page.getByRole('button', { name: english ? 'Edit diagram on the visual canvas' : '在可视化画布中编辑图表', exact: true }).click();
    await page.locator('.canvas-fit-button').click();

    for (const [role, label] of [['start', english ? 'Start' : '开始'], ['end', english ? 'End' : '结束']]) {
      const node = page.locator(`.mermaid-canvas-node.role-${role}`);
      await expect(node.locator('.canvas-node-title')).toHaveText(label, { timeout: 2000 });
      await expect(node).toHaveAccessibleName(`${label} ${english ? 'State' : '状态'}`);
      await node.click();
      await expect(page.locator('.canvas-selection-title b')).toHaveText(label);
    }
    for (const [id, label] of [['A', '开始'], ['B', '结束'], ['C', 'Start'], ['D', 'End']]) {
      const node = page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"]`);
      await expect(node.locator('.canvas-node-title')).toHaveText(label);
      await node.click();
      await expect(page.locator('.canvas-selection-title b')).toHaveText(label);
    }
    await page.locator('.canvas-edge-label').filter({ hasText: 'synthetic transition' }).click();
    const endpoint = page.locator('.canvas-edge-inspector select').first();
    await expect(endpoint.locator('option[value="__state_start_1"]')).toHaveText(english ? 'Start' : '开始');
    await expect(endpoint.locator('option[value="__state_end_1"]')).toHaveText(english ? 'End' : '结束');
    await expect(page.locator('.history-tools button').first()).toBeDisabled();
    await page.locator('.workbench-tabs').getByRole('button', { name: english ? 'Source' : '源码', exact: true }).click();
    await expect(page.getByRole('textbox', { name: english ? 'Mermaid source editor' : 'Mermaid 源码编辑器', exact: true })).toHaveValue(source);
    await page.locator('.workbench-footer').getByRole('button', { name: english ? 'Cancel' : '取消', exact: true }).click();
  }
});

// The existing State8 makes the generated ordinary-state ref skip to State9.
// All four literal user labels must remain authored content in either locale.
const conversionSource = 'stateDiagram-v2\n  direction LR\n  state "开始" as A\n  state "结束" as B\n  state "Start" as C\n  state "End" as D\n  state "Synthetic existing State8" as State8\n  [*] --> A: synthetic enter\n  A --> B\n  B --> C\n  C --> D\n  D --> [*]: synthetic exit';

for (const locale of ['en', 'zh-CN']) for (const role of ['start', 'end']) {
  test(`${locale}: converting imported ${role} localizes only its new ordinary default name`, async ({ page }) => {
    const markdown = `# Synthetic state conversion locale\n\n\`\`\`mermaid\n${conversionSource}\n\`\`\`\n`;
    await launchDocument(page, markdown, 'synthetic-state-conversion-locale.md');
    await page.locator('.language-switcher').selectOption(locale);
    const english = locale === 'en';
    const name = role === 'start' ? english ? 'Start' : '开始' : english ? 'End' : '结束';
    const ordinaryLabels = [['A', '开始'], ['B', '结束'], ['C', 'Start'], ['D', 'End']];
    const node = (id: string) => page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"]`);
    const undo = page.locator('.history-tools button').nth(0);
    const redo = page.locator('.history-tools button').nth(1);
    const readSource = async (isEnglish = english) => {
      await page.locator('.workbench-tabs').getByRole('button', { name: isEnglish ? 'Source' : '源码', exact: true }).click();
      const text = await page.getByRole('textbox', { name: isEnglish ? 'Mermaid source editor' : 'Mermaid 源码编辑器', exact: true }).inputValue();
      await page.locator('.workbench-tabs').getByRole('button', { name: isEnglish ? 'Canvas' : '画布', exact: true }).click();
      return text;
    };

    await page.getByRole('button', { name: english ? 'Edit diagram on the visual canvas' : '在可视化画布中编辑图表', exact: true }).click();
    await page.locator('.canvas-fit-button').click();
    for (const [id, label] of ordinaryLabels) {
      await expect(node(id).locator('.canvas-node-title')).toHaveText(label);
      await node(id).click();
      await page.getByRole('button', { name: english ? 'Regular state' : '普通状态', exact: true }).click();
      await expect(node(id).locator('.canvas-node-title')).toHaveText(label);
    }
    await expect(undo).toBeDisabled();
    expect(await readSource()).toBe(conversionSource);

    const pseudoId = `__state_${role}_1`;
    await node(pseudoId).click();
    await expect(node(pseudoId).locator('.canvas-node-title')).toHaveText(name);
    await page.getByRole('button', { name: english ? 'Regular state' : '普通状态', exact: true }).click();
    // The canvas ID stays stable while the semantic source ref becomes State9.
    await expect(node(pseudoId)).toHaveClass(/role-state/);
    await expect(node(pseudoId).locator('.canvas-node-title')).toHaveText(name, { timeout: 2000 });
    const converted = await readSource();
    const graph = parseMermaidVisualSource(converted)!;
    expect(graph.nodes).toHaveLength(7);
    expect(graph.edges).toHaveLength(5);
    expect(graph.nodes.find(candidate => candidate.id === 'State9')).toMatchObject({ label: name, shape: 'rounded', data: { ref: 'State9', stateRole: 'state' } });
    expect(graph.nodes.find(candidate => candidate.id === 'State8')?.label).toBe('Synthetic existing State8');
    for (const [id, label] of ordinaryLabels) expect(graph.nodes.find(candidate => candidate.id === id)?.label).toBe(label);
    const original = parseMermaidVisualSource(conversionSource)!;
    expect(graph.edges).toEqual(original.edges.map(edge => ({
      ...edge,
      from: edge.from === pseudoId ? 'State9' : edge.from,
      to: edge.to === pseudoId ? 'State9' : edge.to,
    })));

    await undo.click();
    expect(await readSource()).toBe(conversionSource);
    await expect(node(pseudoId)).toHaveClass(new RegExp(`role-${role}`));
    await expect(undo).toBeDisabled();
    await redo.click();
    expect(await readSource()).toBe(converted);
    await page.locator('.workbench-footer').getByRole('button', { name: english ? 'Apply to document' : '应用到文档', exact: true }).click();
    await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
    await expect(page.locator('.preview-pane .mermaid-svg svg')).toHaveCount(1);
    await expect(page.locator('.preview-pane .mermaid-error')).toHaveCount(0);
    await page.getByRole('button', { name: english ? 'Save' : '保存', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__acceptance.saved.at(-1)?.content)).toBe(markdown.replace(conversionSource, converted));

    // Once converted, its default is ordinary authored text and must not change
    // with the UI locale. The remaining pseudostate still follows that locale.
    await page.locator('.language-switcher').selectOption(english ? 'zh-CN' : 'en');
    await page.getByRole('button', { name: english ? '在可视化画布中编辑图表' : 'Edit diagram on the visual canvas', exact: true }).click();
    await page.locator('.canvas-fit-button').click();
    await expect(node('State9').locator('.canvas-node-title')).toHaveText(name);
    for (const [id, label] of ordinaryLabels) await expect(node(id).locator('.canvas-node-title')).toHaveText(label);
    const remainingRole = role === 'start' ? 'end' : 'start';
    const remainingName = remainingRole === 'start' ? english ? '开始' : 'Start' : english ? '结束' : 'End';
    await expect(page.locator(`.mermaid-canvas-node.role-${remainingRole} .canvas-node-title`)).toHaveText(remainingName);
    expect(await readSource(!english)).toBe(converted);
    await expect(undo).toBeDisabled();
    await page.locator('.workbench-footer').getByRole('button', { name: english ? '取消' : 'Cancel', exact: true }).click();
  });
}
