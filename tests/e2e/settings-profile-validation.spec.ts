import { test, expect } from '@playwright/test';
import { launchDocument } from './helpers';

// All profiles and keys are synthetic; the native storage boundary is substituted.
test('incomplete profiles remain identifiable while editing another profile and after changing language', async ({ page }) => {
  await launchDocument(page, '# Synthetic profile validation\n', 'synthetic-profiles.md', 'ready', 'memory');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('配置名称', { exact: true }).fill('Synthetic A');
  await dialog.getByLabel('模型名称', { exact: true }).fill('synthetic-a');
  await dialog.getByLabel('API 密钥', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
  await dialog.getByRole('button', { name: '添加模型', exact: true }).click();
  await dialog.getByLabel('配置名称', { exact: true }).fill('Synthetic B');
  const a = dialog.locator('.profile-list button').filter({ hasText: 'Synthetic A' });
  const b = dialog.locator('.profile-list button').filter({ hasText: 'Synthetic B' });
  await a.click();
  await expect(b).toContainText('未完成');
  await expect(a).not.toContainText('未完成');
  await expect(dialog.getByRole('button', { name: '安全保存', exact: true })).toBeDisabled();
  await b.click();
  await dialog.getByLabel('模型名称', { exact: true }).fill('synthetic-b');
  await dialog.getByLabel('API 密钥', { exact: true }).fill('SYNTHETIC-B-NOT-A-REAL-KEY');
  await dialog.getByLabel('API 地址', { exact: true }).fill('https://api.example.test/v1?synthetic=invalid');
  await expect(b).toContainText('未完成');
  await expect(dialog.locator('#base-url')).toHaveAccessibleErrorMessage('API 地址不能包含查询参数（?）');
  await dialog.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await expect(b).toContainText('Incomplete');
  await expect(dialog.locator('#base-url')).toHaveAccessibleErrorMessage('API endpoints cannot contain query parameters (?)');
  await a.click();
  await expect(b).toContainText('Incomplete');
  await expect(dialog.locator('#base-url-error')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Save securely', exact: true })).toBeDisabled();
  await b.click();
  await expect(dialog.locator('#base-url')).toHaveAccessibleErrorMessage('API endpoints cannot contain query parameters (?)');
  await expect(dialog.getByLabel('Model name', { exact: true })).toHaveValue('synthetic-b');
  await dialog.getByLabel('API endpoint', { exact: true }).fill('https://api.example.test:8443/v1');
  await expect(dialog.locator('.profile-incomplete')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save securely', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Manage models', exact: true }).click();
  await expect(dialog.locator('.profile-incomplete')).toHaveCount(0);
  await expect(dialog.locator('.profile-list button')).toHaveCount(2);
});

test('20 profile limit keeps each draft editable, hides synthetic keys and saves all completed profiles', async ({ page }) => {
  await launchDocument(page, '# Synthetic profile limit\n', 'synthetic-profiles.md', 'ready', 'memory');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog');
  for (let index = 1; index <= 20; index++) {
    if (index > 1) await dialog.getByRole('button', { name: '添加模型', exact: true }).click();
    await expect(dialog.getByLabel('API 密钥', { exact: true })).toHaveAttribute('type', 'password');
    await dialog.getByLabel('API 地址', { exact: true }).fill('https://api.example.test/v1');
    await dialog.getByLabel('模型名称', { exact: true }).fill(`synthetic-${String(index).padStart(2, '0')}`);
    await dialog.getByLabel('API 密钥', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
    if (index < 20) await dialog.getByRole('button', { name: '显示密钥', exact: true }).click();
  }
  await expect(dialog.locator('.profile-list button')).toHaveCount(20);
  await expect(dialog.getByRole('button', { name: '添加模型', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '安全保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '管理模型', exact: true }).click();
  await expect(dialog.locator('.profile-list button')).toHaveCount(20);
  await dialog.locator('.profile-list button').filter({ hasText: 'synthetic-20' }).click();
  await expect(dialog.getByLabel('模型名称', { exact: true })).toHaveValue('synthetic-20');
  await expect(dialog.getByLabel('API 密钥', { exact: true })).toHaveAttribute('type', 'password');
});

for (const size of [{ width: 1440, height: 900 }, { width: 900, height: 600 }]) {
  test(`settings keyboard focus remains visible above the footer at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await launchDocument(page, '# Synthetic settings keyboard\n', 'synthetic-profiles.md', 'ready', 'memory');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect.poll(() => dialog.evaluate(element => element.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
    const seen = new Set<string>();
    for (let index = 0; index < 20; index++) {
      await page.keyboard.press('Tab');
      const field = await dialog.evaluate(element => {
        const active = document.activeElement as HTMLElement | null;
        if (!active?.matches('#profile-name, #base-url, #model-name, #api-key')) return null;
        const rect = active.getBoundingClientRect();
        const footer = element.querySelector('.settings-footer')!.getBoundingClientRect();
        const header = element.querySelector('.settings-header')!.getBoundingClientRect();
        return { id: active.id, top: rect.top, bottom: rect.bottom, headerBottom: header.bottom, footerTop: footer.top };
      });
      if (field) {
        seen.add(field.id);
        await expect.poll(() => dialog.evaluate((element, id) => {
          const rect = element.querySelector(`#${id}`)!.getBoundingClientRect();
          const footer = element.querySelector('.settings-footer')!.getBoundingClientRect();
          const header = element.querySelector('.settings-header')!.getBoundingClientRect();
          return rect.top >= header.bottom - 1 && rect.bottom <= footer.top + 1;
        }, field.id), { message: `${field.id} stays visible between the header and footer` }).toBe(true);
      }
    }
    expect([...seen].sort()).toEqual(['api-key', 'base-url', 'model-name', 'profile-name']);
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: '安全保存', exact: true })).toBeInViewport();
  });
}

test('API endpoint validation explains each invalid address accessibly and clears after correction', async ({ page }) => {
  await launchDocument(page, '# Synthetic endpoint validation\n', 'synthetic-endpoints.md', 'ready', 'memory');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('模型名称', { exact: true }).fill('synthetic-model');
  await dialog.getByLabel('API 密钥', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
  const endpoint = dialog.locator('#base-url');
  const error = dialog.locator('#base-url-error');
  const save = dialog.locator('.settings-footer .confirm-button');
  for (const [value, message] of [
    ['', '请输入 API 地址'],
    ['  ', '请输入 API 地址'],
    ['not a url', 'API 地址无效'],
    ['file:///synthetic', 'API 地址必须使用 HTTP 或 HTTPS'],
    ['ftp://api.example.test/v1', 'API 地址必须使用 HTTP 或 HTTPS'],
    ['https://synthetic-user:synthetic-password@api.example.test/v1', 'API 地址不能包含用户名或密码'],
    ['https://api.example.test/v1?synthetic=invalid', 'API 地址不能包含查询参数（?）'],
    ['https://api.example.test/v1?', 'API 地址不能包含查询参数（?）'],
    ['https://api.example.test/v1#synthetic', 'API 地址不能包含锚点（#）'],
    ['https://api.example.test/v1#', 'API 地址不能包含锚点（#）'],
    ['https://api.example.test/v1#synthetic?query-like', 'API 地址不能包含锚点（#）'],
    ['https://./', 'API 地址缺少有效的主机名或 IP'],
    ['https://.../', 'API 地址缺少有效的主机名或 IP'],
    ['http://127.0.0.1:0/v1', 'API 地址端口必须在 1 到 65535 之间'],
    ['https://api.example.test:65536/v1', 'API 地址端口必须在 1 到 65535 之间'],
    ['https://api.example.test:invalid/v1', 'API 地址端口必须在 1 到 65535 之间'],
    ['http://[::1]:65536/v1', 'API 地址端口必须在 1 到 65535 之间'],
  ]) {
    await endpoint.fill(value);
    await expect(endpoint).toHaveAttribute('aria-invalid', 'true');
    await expect(endpoint).toHaveAttribute('aria-errormessage', 'base-url-error');
    await expect(endpoint).toHaveAttribute('aria-describedby', 'base-url-error base-url-help');
    await expect(error).toHaveAttribute('role', 'status');
    await expect(error).toHaveText(message);
    await expect(endpoint).toHaveAccessibleErrorMessage(message);
    await expect(save).toBeDisabled();
    await expect(dialog.locator('.profile-incomplete')).toHaveCount(1);
  }
  await dialog.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await expect(error).toHaveText('API port must be between 1 and 65535');
  for (const valid of [
    'https://api.example.test:8443/v1',
    'http://127.0.0.1:1/v1',
    'http://[::1]:65535/v1',
    'https://api.example.test/v1%3Fsynthetic%23encoded',
    'https://api.example.test/v1%3fsynthetic%23encoded',
    'https://api.example.test./v1',
  ]) {
    await endpoint.fill(valid);
    await expect(endpoint).toHaveAttribute('aria-invalid', 'false');
    await expect(endpoint).not.toHaveAttribute('aria-errormessage');
    await expect(endpoint).toHaveAttribute('aria-describedby', 'base-url-help');
    await expect(error).toHaveCount(0);
    await expect(save).toBeEnabled();
    await expect(dialog.locator('.profile-incomplete')).toHaveCount(0);
  }
});
