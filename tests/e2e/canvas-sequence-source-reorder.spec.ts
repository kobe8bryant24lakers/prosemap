import { expect, test } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, savedSource, showCanvas } from './helpers';

// Synthetic X15/S15/S16 regression. Source expectations are literal message
// swaps; desktop IPC is mocked, so native acceptance remains separate.
const source = [
  'sequenceDiagram', '  actor A as Synthetic Actor', '  participant B as Synthetic App',
  '  participant C as Synthetic API', '  A->>B: M1 request',
  '  Note over A: Synthetic note', '  activate B', '  loop Synthetic loop',
  '    B->>C: M2 query', '    %% SYNTHETIC keep this comment',
  '    alt Synthetic success', '      C-->>B: M3 success',
  '    else Synthetic retry', '      C-->>B: M4 retry', '    end', '  end',
  '  deactivate B', '  B-->>A: M5 complete',
].join('\n');

for (const eol of ['LF', 'CRLF']) {
  for (const direction of ['earlier', 'later']) {
    test(`sequence source reorder ${direction} preserves ${eol} directive bytes through both histories and save`, async ({ page }) => {
      const expected = direction === 'earlier'
        ? source.replace('    B->>C: M2 query', '    C-->>B: M3 success')
          .replace('      C-->>B: M3 success', '      B->>C: M2 query')
        : source.replace('      C-->>B: M3 success', '      C-->>B: SYNTHETIC_SWAP')
          .replace('      C-->>B: M4 retry', '      C-->>B: M3 success')
          .replace('SYNTHETIC_SWAP', 'M4 retry');
      const markdown = (body: string) => `# SYNTHETIC sequence preservation\n\nHead remains.\n\n\`\`\`mermaid\n${body}\n\`\`\`\n\nTail remains.\n`
        .replaceAll('\n', eol === 'CRLF' ? '\r\n' : '\n');
      await launchDocument(page, markdown(source), 'synthetic-sequence-reorder.md');
      await openDiagram(page);
      await page.locator('.canvas-fit-button').click();
      await page.locator('.canvas-edge-label[data-mermaid-edge-id="edge-3"]').click();
      await page.locator('.canvas-context-bar').getByRole('button', { name: direction === 'earlier' ? '提前' : '延后', exact: true }).click();
      const order = direction === 'earlier' ? ['M1 request', 'M3 success', 'M2 query', 'M4 retry', 'M5 complete']
        : ['M1 request', 'M2 query', 'M4 retry', 'M3 success', 'M5 complete'];
      await expect(page.locator('.canvas-edge-label')).toHaveText(order.map((label, index) => new RegExp(`^${index + 1}\\s*${label}$`)));
      expect(await draftSource(page)).toBe(expected);
      await showCanvas(page);
      await page.locator('.history-tools button').nth(0).click();
      expect(await draftSource(page)).toBe(source);
      await showCanvas(page);
      await expect(page.locator('.history-tools button').nth(0)).toBeDisabled();
      await page.locator('.history-tools button').nth(1).click();
      expect(await draftSource(page)).toBe(expected);
      await page.getByRole('button', { name: '应用到文档', exact: true }).click();
      await expect(page.locator('.preview-pane .mermaid-svg svg')).toHaveCount(1);
      await expect(page.locator('.preview-pane .mermaid-error')).toHaveCount(0);
      expect(await savedSource(page)).toBe(markdown(expected));
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      expect(await savedSource(page)).toBe(markdown(source));
      await page.getByRole('button', { name: '重做', exact: true }).click();
      expect(await savedSource(page)).toBe(markdown(expected));
    });
  }
}
