import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fixture, launchDocument, mod, openDiagram } from './helpers';

async function focusedInside(dialog: Locator) {
  return dialog.evaluate(element => element.contains(document.activeElement));
}

async function probeFocus(page: Page, dialog: Locator, first: Locator, last: Locator, testInfo: TestInfo) {
  const evidence = { initialInside: await focusedInside(dialog), backwardInside: false, backwardLast: false, forwardInside: false, forwardFirst: false };
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  evidence.backwardInside = await focusedInside(dialog);
  evidence.backwardLast = await last.evaluate(element => element === document.activeElement);
  await last.focus();
  await page.keyboard.press('Tab');
  evidence.forwardInside = await focusedInside(dialog);
  evidence.forwardFirst = await first.evaluate(element => element === document.activeElement);
  writeFileSync(testInfo.outputPath('focus-evidence.json'), JSON.stringify(evidence, null, 2));
  await testInfo.attach('focus-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('dialog-focus.png') });
  expect.soft(evidence).toEqual({ initialInside: true, backwardInside: true, backwardLast: true, forwardInside: true, forwardFirst: true });
}

async function assertFileShortcutsBlocked(page: Page) {
  const commands = () => page.evaluate(() => (window as any).__acceptance.calls.filter((call: { command: string }) => ['save_local_markdown', 'pick_markdown_file'].includes(call.command)).length);
  const before = await commands();
  for (const shortcut of [`${mod}+s`, `${mod}+Shift+s`, `${mod}+o`]) await page.keyboard.press(shortcut);
  expect(await commands()).toBe(before);
}

test('settings owns initial focus, loops both directions, blocks background shortcuts and restores its opener', async ({ page }, testInfo) => {
  await launchDocument(page, '# Focus fixture\n\nOriginal text.');
  const opener = page.getByRole('button', { name: '管理模型', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: '模型连接', exact: true });
  await expect(dialog).toBeVisible();
  await probeFocus(page, dialog, dialog.getByRole('button', { name: '关闭模型配置' }), dialog.getByRole('button', { name: '取消', exact: true }), testInfo);
  await assertFileShortcutsBlocked(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.soft(opener).toBeFocused();
});

test('settings nested over workbench isolates focus and Escape returns to its workbench opener', async ({ page }, testInfo) => {
  await launchDocument(page, fixture('diagrams/01-basic-flowchart.md'));
  await openDiagram(page);
  await page.locator('.workbench-tabs').getByRole('button', { name: /AI/ }).click();
  const workbench = page.locator('.mermaid-workbench');
  const opener = workbench.getByRole('button', { name: '先连接模型', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: '模型连接', exact: true });
  await expect(dialog).toBeVisible();
  await probeFocus(page, dialog, dialog.getByRole('button', { name: '关闭模型配置' }), dialog.getByRole('button', { name: '取消', exact: true }), testInfo);
  await assertFileShortcutsBlocked(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(workbench).toBeVisible();
  await expect.soft(opener).toBeFocused();
  await expect(workbench).not.toHaveAttribute('inert');
});

async function openDiff(page: Page, streaming = false) {
  await launchDocument(page, '# Focus fixture\n\nOriginal text.');
  await page.getByRole('button', { name: '管理模型', exact: true }).click();
  await page.getByLabel('模型名称', { exact: true }).fill('acceptance-model');
  await page.getByLabel('API 密钥', { exact: true }).fill('test-only-not-a-secret');
  await page.getByRole('button', { name: '安全保存', exact: true }).click();
  await expect(page.locator('.settings-modal')).toHaveCount(0);
  await page.evaluate((streaming) => {
    const w = window as any;
    const original = w.__TAURI_INTERNALS__.invoke;
    let resolveStream: (() => void) | undefined;
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command === 'stream_ai') {
        w.__acceptance.calls.push({ command, args: { requestId: args.request.requestId } });
        args.onEvent.onmessage({ type: 'delta', text: '# Improved fixture\n\nA clearer paragraph.' });
        if (streaming) await new Promise<void>(resolve => { resolveStream = resolve; });
        else args.onEvent.onmessage({ type: 'done' });
        return;
      }
      if (command === 'cancel_ai') { resolveStream?.(); return; }
      return original(command, args);
    };
  }, streaming);
  await page.getByRole('button', { name: 'AI 文字助手', exact: true }).click();
  await page.getByRole('button', { name: '生成建议', exact: true }).click();
  await expect(page.locator('.diff-modal')).toBeVisible();
}

test('ready diff loops focus, prevents background file actions and restores the editor after its trigger unmounts', async ({ page }, testInfo) => {
  await openDiff(page);
  const dialog = page.locator('.diff-modal');
  const accept = dialog.getByRole('button', { name: '接受并替换', exact: true });
  await expect(accept).toBeEnabled();
  await probeFocus(page, dialog, dialog.getByRole('button', { name: '关闭差异预览' }), accept, testInfo);
  await assertFileShortcutsBlocked(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.soft(page.locator('.cm-content')).toBeFocused();
  await expect(page.locator('.cm-content')).toContainText('Original text.');
});

test('streaming diff Escape stops first, keeps focus inside, then closes and returns to editor', async ({ page }, testInfo) => {
  await openDiff(page, true);
  const dialog = page.locator('.diff-modal');
  await expect(dialog.getByRole('button', { name: '停止生成', exact: true })).toBeVisible();
  await probeFocus(page, dialog, dialog.getByRole('button', { name: '关闭差异预览' }), dialog.getByRole('button', { name: '停止生成', exact: true }), testInfo);
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('button', { name: '拒绝', exact: true })).toBeVisible();
  expect.soft(await focusedInside(dialog)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.soft(page.locator('.cm-content')).toBeFocused();
  await expect(page.locator('.cm-content')).toContainText('Original text.');
});
