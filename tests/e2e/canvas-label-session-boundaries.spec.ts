import { expect, test } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, showCanvas } from './helpers';

const source = 'stateDiagram-v2\n  state "SyntheticAlpha" as A\n  state "SyntheticBeta" as B\n  A --> B: SyntheticTransition';

test('canceling a different label does not roll back the prior accepted editing session', async ({ page }) => {
  await launchDocument(page, `# Synthetic label sessions\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`, 'synthetic-label-sessions.md');
  await openDiagram(page);
  await page.locator('.canvas-fit-button').click();
  const first = page.locator('.mermaid-canvas-node[data-mermaid-node-id="A"]');
  const second = page.locator('.mermaid-canvas-node[data-mermaid-node-id="B"]');
  await first.dblclick();
  await first.locator('input').fill('SyntheticAccepted');
  await first.locator('input').fill('SyntheticAccepted#');
  // Deselecting the first object starts a different editing session.
  await second.dblclick();
  await expect(second.locator('input')).toBeFocused();
  await second.locator('input').press('Escape');
  await expect(first).toContainText('SyntheticAccepted', { timeout: 1500 });
  expect(await draftSource(page)).toBe(source.replace('SyntheticAlpha', 'SyntheticAccepted'));
  await showCanvas(page);
  await page.locator('.history-tools button').first().click();
  expect(await draftSource(page)).toBe(source);
});

test('leaving inline mode discards only rejected text and retains accepted source and history', async ({ page }) => {
  await launchDocument(page, `# Synthetic label mode switch\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`, 'synthetic-label-modes.md');
  await openDiagram(page);
  const node = page.locator('.mermaid-canvas-node[data-mermaid-node-id="A"]');
  await node.dblclick();
  await node.locator('input').fill('SyntheticAccepted');
  await node.locator('input').fill('SyntheticAccepted#');
  expect(await draftSource(page)).toBe(source.replace('SyntheticAlpha', 'SyntheticAccepted'));
  await showCanvas(page);
  await expect(node.locator('input')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '应用到文档', exact: true })).toBeEnabled();
  await page.locator('.history-tools button').first().click();
  expect(await draftSource(page)).toBe(source);
});
