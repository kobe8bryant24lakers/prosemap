import { expect, test } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, savedSource, showCanvas } from './helpers';

for (const [ending, eols] of [['LF', ['\n']], ['CRLF', ['\r\n']], ['CR', ['\r']], ['mixed', ['\r\n', '\n', '\r']]] as const) {
  for (const connector of ['-->|Synthetic edge|', '-- Synthetic edge -->']) {
    test(`${ending} ${connector}: an inline edge edit preserves unrelated source and disk line endings`, async ({ page }) => {
      const source = ['graph LR', '  %% SYNTHETIC: Synthetic edge remains here',
        `    A(["Synthetic --> node"])  ${connector} B[("Synthetic edge")]  `, '  B --> A'].join('\n');
      const document = ['# SYNTHETIC inline edge source', '', '```mermaid', ...source.split('\n'), '```', '', 'SYNTHETIC_END']
        .map((line, index, lines) => line + (index === lines.length - 1 ? '' : eols[index % eols.length])).join('');
      await launchDocument(page, document, 'synthetic-inline-edge-source.md');
      await expect(page.locator('.preview-pane .mermaid-svg svg')).toHaveCount(1);
      await openDiagram(page);
      await page.locator('.canvas-fit-button').click();
      const label = page.locator('.canvas-edge-label[data-mermaid-edge-id="edge-1"]');
      await label.dblclick();
      await label.locator('input').fill('Synthetic replacement');
      await label.locator('input').press('Enter');
      const changedConnector = connector.replace('Synthetic edge', 'Synthetic replacement');
      expect(await draftSource(page)).toBe(source.replace(connector, changedConnector));
      await expect(page.locator('.workbench-preview .mermaid-svg')).toContainText('Synthetic replacement');
      await expect(page.locator('.workbench-preview .mermaid-error')).toHaveCount(0);
      await showCanvas(page);
      await page.locator('.history-tools button').first().click();
      await expect(page.locator('.history-tools button').first()).toBeDisabled();
      expect(await draftSource(page)).toBe(source);
      await showCanvas(page);
      await page.locator('.history-tools button').nth(1).click();
      expect(await draftSource(page)).toBe(source.replace(connector, changedConnector));
      await page.getByRole('button', { name: '应用到文档', exact: true }).click();
      expect(await savedSource(page)).toBe(document.replace(connector, changedConnector));
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      expect(await savedSource(page)).toBe(document);
    });
  }
}
