import { expect, test, type Page } from '@playwright/test';
import { MERMAID_TEMPLATES, parseMermaidVisualSource } from '../../lib/mermaid-workbench';
import fixtures from '../fixtures/canvas-navigation-templates.json' with { type: 'json' };
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

async function snapshot(page: Page) {
  return page.locator('.mermaid-canvas-editor').evaluate(root => ({
    nodes: Array.from(root.querySelectorAll<HTMLElement>('.mermaid-canvas-node')).map(node => ({
      id: node.dataset.mermaidNodeId, style: node.style.cssText, selected: node.getAttribute('aria-pressed'),
    })),
    zoom: root.querySelector('.canvas-zoom-value')?.textContent,
    scroll: [root.querySelector('.canvas-editor-viewport')?.scrollLeft, root.querySelector('.canvas-editor-viewport')?.scrollTop],
    history: Array.from(root.querySelectorAll<HTMLButtonElement>('.history-tools button')).map(button => button.disabled),
  }));
}

async function choose(page: Page, id: string) {
  await page.locator('.workbench-tabs').getByRole('button', { name: '模板', exact: true }).click();
  const template = MERMAID_TEMPLATES.find(item => item.id === id)!;
  await page.locator('.workbench-template-grid').getByRole('button').filter({ has: page.locator('b').filter({ hasText: template.name }) }).click();
}

for (const [index, item] of fixtures.templates.entries()) {
  test(`${item.template}: cancel preserves the edited draft and history; confirmed replacement resets only the workbench`, async ({ page }, testInfo) => {
    await launchDocument(page, `# SYNTHETIC template replacement\n\n\`\`\`mermaid\n${item.source}\n\`\`\`\n`);
    const beforeDocument = await page.locator('.cm-content').innerText();
    await openDiagram(page);
    await draftSource(page);
    await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(item.source.replace('Synthetic_NodeBase', 'SYNTHETIC_UNSAVED_DRAFT'));
    await showCanvas(page);
    const root = page.locator('.mermaid-canvas-editor');
    const originalNode = root.locator(`.mermaid-canvas-node[data-mermaid-node-id="${item.nodeId}"]`);
    await originalNode.click();
    await root.getByRole('button', { name: '复制', exact: true }).click();
    const changed = await draftSource(page);
    await showCanvas(page);
    await root.getByRole('button', { name: '复制', exact: true }).click();
    await root.locator('.history-tools button').first().click();
    await originalNode.click();
    await root.getByRole('button', { name: '选区', exact: true }).click();
    const before = await snapshot(page);
    expect(before.history).toEqual([false, false]);
    const target = MERMAID_TEMPLATES.find(template => template.id === fixtures.templates[(index + 1) % fixtures.templates.length].template)!;

    for (const cancel of ['button', 'escape', 'backdrop', 'x']) {
      await choose(page, target.id);
      const dialog = page.getByRole('alertdialog', { name: '用模板替换当前草稿？', exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: '保留草稿', exact: true })).toBeFocused();
      if (cancel === 'button') await page.keyboard.press('Enter');
      if (cancel === 'escape') await page.keyboard.press('Escape');
      if (cancel === 'backdrop') await page.locator('.confirmation-backdrop').click({ position: { x: 20, y: 400 } });
      if (cancel === 'x') await dialog.getByRole('button', { name: '关闭确认对话框', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(await draftSource(page)).toBe(changed);
      await showCanvas(page);
      expect(await snapshot(page)).toEqual(before);
    }

    await choose(page, target.id);
    await page.getByRole('alertdialog').getByRole('button', { name: '替换草稿', exact: true }).click();
    await expect(page.locator('.confirmation-dialog')).toHaveCount(0);
    await expect(root).toBeVisible();
    expect(await draftSource(page)).toBe(target.source);
    await showCanvas(page);
    await expect(root.locator('.history-tools button').first()).toBeDisabled();
    await expect(root.locator('.history-tools button').nth(1)).toBeDisabled();
    await expect(root.locator('.mermaid-canvas-node.selected')).toHaveCount(0);
    await expect(root.locator('.mermaid-canvas-node')).toHaveCount(parseMermaidVisualSource(target.source)!.nodes.length);
    expect(await page.locator('.cm-content').innerText()).toBe(beforeDocument);
    const replacement = await snapshot(page);
    await choose(page, target.id);
    await expect(page.locator('.confirmation-dialog')).toHaveCount(0);
    await expect(root).toBeVisible();
    expect(await snapshot(page)).toEqual(replacement);
    await testInfo.attach('synthetic-template-boundary', {
      body: JSON.stringify({ changed, target: target.id, source: target.source, before, replacement }), contentType: 'application/json',
    });
  });
}

test('a clean opening draft can select a template directly', async ({ page }) => {
  await launchDocument(page, '# SYNTHETIC clean template\n\n```mermaid\nflowchart LR\n  A["Synthetic"]\n```\n');
  await openDiagram(page);
  await choose(page, 'sequence');
  await expect(page.locator('.confirmation-dialog')).toHaveCount(0);
  expect(await draftSource(page)).toBe(MERMAID_TEMPLATES.find(item => item.id === 'sequence')!.source);
});

test('selecting the identical template preserves manual layout and its undo history', async ({ page }) => {
  const template = MERMAID_TEMPLATES.find(item => item.id === 'basic-flowchart')!;
  await launchDocument(page, `# SYNTHETIC identical template\n\n\`\`\`mermaid\n${template.source}\n\`\`\`\n`);
  await openDiagram(page);
  const node = page.locator('.mermaid-canvas-node[data-mermaid-node-id="Start"]');
  await node.click();
  await node.press('Shift+ArrowRight');
  expect(await draftSource(page)).toBe(template.source);
  await showCanvas(page);
  const before = await snapshot(page);
  expect(before.history).toEqual([false, true]);
  await choose(page, template.id);
  await expect(page.locator('.confirmation-dialog')).toHaveCount(0);
  await expect(page.locator('.mermaid-canvas-editor')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});
