import { test, expect, type Page } from '@playwright/test';
import { launchDocument } from './helpers';

// Synthetic document/model data only; no keychain or external model request.
async function showSuggestion(page: Page, original: string, modified: string) {
  await launchDocument(page, original, 'synthetic-diff-counts.md', 'ready', 'memory');
  await page.evaluate((response) => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command === 'stream_ai') {
        args.onEvent.onmessage({ type: 'delta', text: response });
        args.onEvent.onmessage({ type: 'done' });
        return;
      }
      return invoke(command, args);
    };
  }, modified);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog');
  await settings.getByLabel('模型名称', { exact: true }).fill('synthetic-model');
  await settings.getByLabel('API 密钥', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
  await settings.getByRole('button', { name: '安全保存', exact: true }).click();
  await page.getByRole('button', { name: 'AI 文字助手', exact: true }).click();
  await page.getByRole('button', { name: '生成建议', exact: true }).click();
  const dialog = page.locator('.diff-modal');
  await expect(dialog.getByRole('button', { name: '接受并替换', exact: true })).toBeEnabled();
  return dialog;
}

const cases = [
  { name: 'adds multiple blank lines', original: 'head\ntail\n', modified: 'head\n\n\ntail\n', added: 2, removed: 0 },
  { name: 'removes multiple blank lines', original: 'head\n\n\ntail\n', modified: 'head\ntail\n', added: 0, removed: 2 },
  { name: 'adds blank and nonblank lines to an empty document', original: '', modified: '\nsynthetic first\n\n', added: 3, removed: 0 },
  { name: 'adds an unterminated line to an empty document', original: '', modified: 'synthetic first', added: 1, removed: 0 },
  { name: 'adds blanks before an unterminated final line', original: 'tail', modified: '\n\ntail', added: 2, removed: 0 },
  { name: 'replaces an unterminated final line with blank and nonblank lines', original: 'head\nold', modified: 'head\n\nnew', added: 2, removed: 1 },
  { name: 'counts mixed blank and nonblank insertions', original: 'head\nold\n\ntail\n', modified: 'head\n\nnew\n\n\ntail\n', added: 3, removed: 1 },
  { name: 'counts mixed blank and nonblank deletions', original: 'head\n\nold\n\n\ntail\n', modified: 'head\nnew\n\ntail\n', added: 1, removed: 3 },
  // Loaded originals use LF; raw CRLF suggestions therefore replace these rows.
  { name: 'counts CRLF suggestion rows against the normalized document', original: 'head\r\ntail\r\n', modified: 'head\r\n\r\n\r\ntail\r\n', added: 4, removed: 2 },
  { name: 'counts whitespace-only lines', original: 'head\ntail\n', modified: 'head\n \n\t\ntail\n', added: 2, removed: 0 },
  { name: 'counts unchanged unterminated content as zero changes', original: 'head\n\ntail', modified: 'head\n\ntail', added: 0, removed: 0 },
];

for (const item of cases) {
  test('diff line counts: ' + item.name, async ({ page }) => {
    const dialog = await showSuggestion(page, item.original, item.modified);
    await expect(dialog.locator('.diff-line.added')).toHaveCount(item.added);
    await expect(dialog.locator('.diff-line.removed')).toHaveCount(item.removed);
    // Header totals must count the same visible rows, including empty rows.
    await expect(dialog.locator('.diff-stats b')).toHaveText('+' + item.added, { timeout: 1000 });
    await expect(dialog.locator('.diff-stats i')).toHaveText('−' + item.removed, { timeout: 1000 });
  });
}
