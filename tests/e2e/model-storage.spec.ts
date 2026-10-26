import { test, expect } from '@playwright/test';
import { launchDocument } from './helpers';

for (const storage of ['system', 'memory'] as const) {
  test(`model storage: ${storage} backend is described accurately before and after saving`, async ({ page }) => {
    await launchDocument(page, '# Synthetic settings test\n', 'storage.md', 'ready', storage);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '模型连接', exact: true });
    await expect(dialog.locator('.security-card')).toContainText(storage === 'memory' ? '不访问系统凭据库' : '重启后仍可使用');
    if (storage === 'memory') await expect(dialog.locator('.security-card')).not.toContainText('重启后仍可使用');
    await dialog.getByLabel('配置名称', { exact: true }).fill('Synthetic test');
    await dialog.getByLabel('API 地址', { exact: true }).fill('http://127.0.0.1:1/v1');
    await dialog.getByLabel('模型名称', { exact: true }).fill('synthetic-model');
    await dialog.getByLabel('API 密钥', { exact: true }).fill('synthetic-not-a-real-key');
    await dialog.getByRole('button', { name: '安全保存', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.toast')).toContainText(storage === 'memory' ? '退出后需重新填写' : '已加密保存到系统安全凭据库');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(dialog.getByLabel('模型名称', { exact: true })).toHaveValue('synthetic-model');
    await expect(dialog.getByLabel('API 密钥', { exact: true })).toHaveAttribute('type', 'password');
    if (storage === 'memory') await expect(dialog.locator('.security-card')).not.toContainText('重启后仍可使用');
  });
}
