import { expect, test } from '@playwright/test';
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
