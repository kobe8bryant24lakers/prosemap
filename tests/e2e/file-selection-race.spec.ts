import { test, expect, type Page } from '@playwright/test';
import { launchDocument, savedSource } from './helpers';

const body = (id: string) => `# SYNTHETIC_FILE_${id}\n\nUnique ${id} body 中文 🧭\n`;

async function prepare(page: Page) {
  await launchDocument(page, body('BASE'), 'SYNTHETIC_BASE.md');
  await page.evaluate(() => {
    const w = window as any, original = w.__TAURI_INTERNALS__.invoke;
    const files = ['A', 'B', 'C'].map(id => ({ path: `/acceptance/SYNTHETIC_${id}.md`, name: `SYNTHETIC_${id}.md`, relativePath: `SYNTHETIC_${id}.md` }));
    for (const [i, file] of files.entries()) w.__acceptance.disk[file.path] = `# SYNTHETIC_FILE_${'ABC'[i]}\n\nUnique ${'ABC'[i]} body 中文 🧭\n`;
    w.__fileRace = { requests: [], releases: [], delivered: [], hold: true };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any) => {
      if (command === 'pick_markdown_folder') return { root: '/acceptance', name: 'SYNTHETIC_WORKSPACE', files };
      if (command !== 'read_local_markdown') return original(command, args);
      const id = w.__fileRace.requests.length;
      w.__fileRace.requests.push(args.path);
      const result = await original(command, args);
      if (w.__fileRace.hold) await new Promise<void>(resolve => { w.__fileRace.releases[id] = resolve; });
      w.__fileRace.delivered.push(id);
      return result;
    };
  });
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
}

const choose = (page: Page, id: string) => page.locator('.file-list').getByRole('button', { name: `SYNTHETIC_${id}.md`, exact: true }).click();
async function release(page: Page, id: number) {
  await expect.poll(() => page.evaluate(i => typeof (window as any).__fileRace.releases[i], id)).toBe('function');
  await page.evaluate(i => (window as any).__fileRace.releases[i](), id);
  await expect.poll(() => page.evaluate(i => (window as any).__fileRace.delivered.includes(i), id)).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const order of ['ABC', 'ACB', 'BAC', 'BCA', 'CAB', 'CBA']) {
  test(`last selection wins when native reads complete out of order: ${order}`, async ({ page }) => {
    await prepare(page);
    for (const id of order) await choose(page, id);
    await expect.poll(() => page.evaluate(() => (window as any).__fileRace.requests.length)).toBe(3);
    await release(page, 2);
    const last = order[2];
    await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue(`SYNTHETIC_${last}`);
    for (const id of [0, 1]) {
      await release(page, id);
      await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue(`SYNTHETIC_${last}`);
    }
    await expect(page.locator('.file-list button.active')).toHaveText(`SYNTHETIC_${last}.md`);
    expect(await savedSource(page)).toBe(body(last));
    expect(await page.evaluate(() => (window as any).__acceptance.saved.at(-1).path)).toBe(`/acceptance/SYNTHETIC_${last}.md`);
    await expect(page.locator('.saved-state')).toContainText('已保存到本地');
  });
}

test('reselecting the current file cancels a pending selection without losing current edits', async ({ page }) => {
  await prepare(page);
  await choose(page, 'A');
  await release(page, 0);
  await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('SYNTHETIC_A');
  await choose(page, 'B');
  await choose(page, 'A');
  await release(page, 1);
  await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('SYNTHETIC_A');
  expect(await savedSource(page)).toBe(body('A'));
  await page.locator('.cm-content').fill(body('A') + '\nSYNTHETIC_UNSAVED\n');
  await choose(page, 'C');
  await choose(page, 'A');
  await release(page, 2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.saved-state')).toContainText('未保存');
  expect(await savedSource(page)).toBe(body('A') + '\nSYNTHETIC_UNSAVED\n');
});
