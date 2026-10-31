import { test, expect } from '@playwright/test';
import { launchDocument, savedSource } from './helpers';

const endpoint = 'https://api.example.test/synthetic/chat/completions';
const upstream = 'Synthetic upstream: 保存{0}。请求地址：https://upstream.example.test/。服务返回：取消';
const cases = [
  {
    name: 'HTTP 429',
    message: '请求过于频繁、额度不足或已达到限额（HTTP 429）。请求地址：' + endpoint + '。服务返回：' + upstream,
    expected: 'Rate limit or quota exceeded (HTTP 429). Request URL: ' + endpoint + '. Service response: ' + upstream,
    event: false,
  },
  {
    name: 'network root cause',
    message: '模型服务拒绝连接，请确认服务已启动且 API 端口正确。请求地址：' + endpoint + '。底层原因：Synthetic refusal 保存{1}',
    expected: 'Connection refused. Check that the service is running and the API port is correct. Request URL: ' + endpoint + '. Root cause: Synthetic refusal 保存{1}',
    event: false,
  },
  {
    name: 'interrupted stream',
    message: '模型流式响应意外中断。模型请求或响应数据传输失败。请求地址：' + endpoint + '。底层原因：Synthetic transfer 保存{1}',
    expected: 'The model stream was interrupted. Request or response transfer failed. Request URL: ' + endpoint + '. Root cause: Synthetic transfer 保存{1}',
    event: true,
  },
  {
    name: 'stream ends before done',
    message: '模型响应提前结束，请重试',
    expected: 'The model response ended early. Please retry.',
    event: true,
  },
  {
    name: 'arbitrary upstream content',
    message: upstream,
    expected: upstream,
    event: true,
  },
];

for (const item of cases) {
  test('AI errors in English: ' + item.name, async ({ page }) => {
    const original = '# Synthetic document\n\n保存 and 取消 are document text.\n';
    await launchDocument(page, original, 'synthetic-ai-error.md', 'ready', 'memory');
    await page.evaluate((item) => {
      const w = window as any;
      const invoke = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
        if (command === 'stream_ai') {
          if (item.event) {
            args.onEvent.onmessage({ type: 'delta', text: 'Synthetic partial content' });
            args.onEvent.onmessage({ type: 'error', message: item.message });
            return;
          }
          throw item.message;
        }
        return invoke(command, args);
      };
    }, item);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const settings = page.getByRole('dialog');
    await settings.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    await settings.getByLabel('Model name', { exact: true }).fill('synthetic-model');
    await settings.getByLabel('API key', { exact: true }).fill('SYNTHETIC-NOT-A-REAL-KEY');
    await settings.getByRole('button', { name: 'Save securely', exact: true }).click();
    await page.getByRole('button', { name: 'AI writing assistant', exact: true }).click();
    await page.getByRole('button', { name: 'Generate suggestion', exact: true }).click();
    const dialog = page.locator('.diff-modal');
    await expect(dialog.getByRole('alert')).toHaveText(item.expected, { timeout: 1000 });
    await expect(dialog.getByRole('button', { name: 'Accept and replace', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Reject', exact: true }).click();
    // The UI helper uses the current locale's Save label separately.
    await page.getByRole('button', { name: 'Manage models', exact: true }).click();
    await settings.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
    await settings.getByRole('button', { name: '取消', exact: true }).click();
    expect(await savedSource(page)).toBe(original);
  });
}
