import { expect, test } from '@playwright/test';
import { fixture, launchDocument, openDiagram, draftSource, showCanvas, savedSource } from './helpers';

const cases = JSON.parse(fixture('synthetic-semantic-persistence.json')).templates as {
  template: string; kind: string; before: string; after: string; persistentFields: string[];
}[];
const documentFor = (source: string) => `# SYNTHETIC semantic persistence\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nSYNTHETIC_END\n`;

for (const item of cases) {
  test(`${item.template}: changed semantic source survives apply, save and a fresh document session`, async ({ page, context }) => {
    await launchDocument(page, documentFor(item.before));
    await openDiagram(page);
    expect(await draftSource(page)).toBe(item.before);
    await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(item.after);
    await showCanvas(page);
    await expect(page.locator('.canvas-readonly')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '应用到文档', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
    const saved = await savedSource(page);
    expect(saved).toBe(documentFor(item.after));
    await expect(page.locator('.preview-pane .mermaid-svg svg')).toHaveCount(1);
    await expect(page.locator('.preview-pane .mermaid-error')).toHaveCount(0);

    // Browser IPC uses an in-memory disk. The installed-app acceptance separately
    // verifies actual filesystem persistence across process exit and restart.
    const reopened = await context.newPage();
    await launchDocument(reopened, saved);
    await expect(reopened.locator('.preview-pane .mermaid-svg svg')).toHaveCount(1);
    await openDiagram(reopened);
    expect(await draftSource(reopened)).toBe(item.after);
    await showCanvas(reopened);
    await expect(reopened.locator('.mermaid-canvas-node').first()).toBeVisible();
    await reopened.close();
  });
}
