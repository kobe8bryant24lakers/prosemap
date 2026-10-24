import { test, expect } from '@playwright/test';
import { launchDocument, savedSource } from './helpers';

test('pending credential read gives feedback, can close, and never blocks document editing', async ({ page }, testInfo) => {
  const original = '# 继续编辑\n\n模型配置还在读取。\n';
  await launchDocument(page, original, 'acceptance.md', 'pending');
  const opener = page.getByRole('button', { name: '设置', exact: true });
  await opener.click();
  const waiting = page.getByRole('dialog', { name: '读取模型配置', exact: true });
  await expect(waiting).toBeVisible();
  await expect(waiting.getByRole('status')).toHaveText('正在读取本机模型配置…');
  await expect(page.getByLabel('API 密钥', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('loading-feedback.png') });
  await page.keyboard.press('Escape');
  await expect(waiting).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await savedSource(page)).toBe(original);
  await opener.click();
  await page.evaluate(() => { (window as any).__acceptance.releaseModelLoad(); });
  const settings = page.getByRole('dialog', { name: '模型连接', exact: true });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('button', { name: '安全保存', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
});

test('failed credential read cannot save an empty profile set and supports retry without duplicate pending requests', async ({ page }, testInfo) => {
  await launchDocument(page, '# 配置错误恢复\n', 'acceptance.md', 'failed');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '读取模型配置', exact: true });
  await expect(dialog.getByRole('status')).toHaveText('测试：读取系统配置失败');
  await expect(page.getByRole('button', { name: '安全保存', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('read-error-recovery.png') });
  await page.evaluate(() => { (window as any).__acceptance.modelLoad = 'pending'; });
  await dialog.getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('正在读取本机模型配置…');
  await expect(dialog.getByRole('button', { name: '重新读取', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__acceptance.calls.filter((c: any) => c.command === 'load_model_profiles').length)).toBe(2);
  await page.evaluate(() => { const state = (window as any).__acceptance; state.modelLoad = 'ready'; state.releaseModelLoad(); });
  await expect(page.getByRole('dialog', { name: '模型连接', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__acceptance.calls.filter((c: any) => c.command === 'save_model_profiles').length)).toBe(0);
});
