import { expect, test } from '@playwright/test';

const encodingError = '仅支持 UTF-8 编码的 Markdown 文件';
const recovery = { path: '/acceptance/SYNTHETIC_startup_recovery.md', name: 'SYNTHETIC_startup_recovery.md', content: '# SYNTHETIC startup recovery\n\nSynthetic local document only.\n' };

for (const locale of ['en', 'zh-CN'] as const) {
  test(`startup file rejection preserves its translated detail and allows recovery (${locale})`, async ({ page }) => {
    // Only the Tauri boundary is substituted; no native credentials or files.
    await page.addInitScript(({ locale, encodingError, recovery }) => {
      localStorage.setItem('prosemap.locale', locale);
      const w = window as any;
      let nextId = 1;
      const callbacks = new Map<number, (value: unknown) => void>();
      w.isTauri = true;
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      w.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback(callback: (value: unknown) => void) { const id = nextId++; callbacks.set(id, callback); return id; },
        unregisterCallback(id: number) { callbacks.delete(id); },
        convertFileSrc(path: string) { return `/@fs${path}`; },
        async invoke(command: string) {
          if (command === 'model_config_storage') return 'memory';
          if (command === 'load_model_profiles') return null;
          if (command === 'plugin:event|listen') return nextId++;
          if (command === 'plugin:event|unlisten') return;
          if (command === 'read_launch_target') throw encodingError;
          if (command === 'pick_markdown_file') return recovery;
          throw new Error(`Unexpected synthetic startup command: ${command}`);
        },
      };
    }, { locale, encodingError, recovery });
    await page.goto('/');
    await expect(page.locator('.toast')).toHaveText(locale === 'en' ? 'Markdown files must use UTF-8 encoding' : encodingError);
    const current = page.getByRole('textbox', { name: locale === 'en' ? 'Document name' : '文档名称', exact: true });
    await expect(current).toHaveValue(locale === 'en' ? 'Welcome to ProseMap' : 'ProseMap 入门');
    const before = await page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString());
    await page.getByRole('combobox', { name: locale === 'en' ? 'Interface language' : '界面语言', exact: true }).selectOption(locale === 'en' ? 'zh-CN' : 'en');
    await expect(page.locator('.toast')).toHaveText(locale === 'en' ? encodingError : 'Markdown files must use UTF-8 encoding');
    expect(await page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString())).toBe(before);
    await page.getByRole('button', { name: locale === 'en' ? '打开文件' : 'Open file', exact: true }).click();
    await expect(page.getByRole('textbox', { name: locale === 'en' ? '文档名称' : 'Document name', exact: true })).toHaveValue('SYNTHETIC_startup_recovery');
    expect(await page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString())).toBe(recovery.content);
    await expect(page.locator('.confirmation-dialog')).toHaveCount(0);
  });
}
