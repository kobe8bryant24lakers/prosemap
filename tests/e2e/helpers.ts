import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

export const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

// Only the native IPC boundary is substituted. UI, CodeMirror, Mermaid, history,
// selection and source serialization run unchanged. This is NOT an installed-app test.
export async function launchDocument(page: Page, content: string, name = 'acceptance.md', modelLoad: 'ready' | 'pending' | 'failed' = 'ready') {
  const images = {
    svg: [...readFileSync(new URL('../fixtures/assets/fixture-diagram.svg', import.meta.url))],
    png: [...readFileSync(new URL('../fixtures/assets/中文 图标.png', import.meta.url))],
  };
  await page.addInitScript(({ content, name, images, modelLoad }) => {
    localStorage.setItem('prosemap.locale', 'zh-CN');
    const w = window as any;
    let nextId = 1;
    const callbacks = new Map<number, (value: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    const document = { path: `/acceptance/${name}`, name, content };
    const state = w.__acceptance = {
      calls: [] as { command: string; args: any }[], saved: [] as any[],
      nextFile: document, saveError: '', cancelSave: false,
      disk: { [document.path]: content } as Record<string, string>, readError: '', pauseRead: false,
      releaseRead: null as null | (() => void),
      modelLoad, releaseModelLoad: null as null | (() => void),
      emit(event: string, payload: unknown) {
        for (const [id, listener] of listeners) if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload });
      },
    };
    w.isTauri = true;
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event: string, id: number) => listeners.delete(id) };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback(callback: (value: unknown) => void) { const id = nextId++; callbacks.set(id, callback); return id; },
      unregisterCallback(id: number) { callbacks.delete(id); },
      convertFileSrc(path: string) { return `/@fs${path}`; },
      async invoke(command: string, args: any = {}) {
        state.calls.push({ command, args });
        if (command === 'load_model_profiles') {
          if (state.modelLoad === 'pending') await new Promise<void>(resolve => { state.releaseModelLoad = resolve; });
          if (state.modelLoad === 'failed') throw '测试：读取系统配置失败';
          return null;
        }
        if (command === 'read_launch_target') return { kind: 'file', document };
        if (command === 'plugin:event|listen') { const id = nextId++; listeners.set(id, args); return id; }
        if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
        if (command === 'pick_markdown_file') return state.nextFile;
        if (command === 'save_local_markdown') {
          if (state.saveError) throw new Error(state.saveError);
          if (state.cancelSave) return null;
          if (args.path && state.disk[args.path] !== args.expectedContent) throw '文件已被外部修改，未覆盖磁盘内容。请重新载入，或另存为以保留当前修改。';
          const saved = { path: args.path ?? `/acceptance/${args.suggestedName}`, name: args.suggestedName, content: args.content };
          state.disk[saved.path] = saved.content;
          state.saved.push(saved); return saved;
        }
        if (command === 'open_external_url' || command === 'open_relative_file' || command === 'save_model_profiles' || command === 'select_model_profile') return;
        if (command === 'pick_markdown_folder') return { root: '/acceptance', name: 'acceptance', files: [{ path: document.path, name, relativePath: name }] };
        if (command === 'read_local_markdown') {
          const read = { path: args.path, name: args.path.split('/').at(-1), content: state.disk[args.path] };
          if (state.pauseRead) await new Promise<void>(resolve => { state.releaseRead = resolve; });
          if (state.readError) throw state.readError;
          return read;
        }
        if (command === 'read_local_image') {
          if (args.source.includes('missing')) throw new Error('Missing fixture image');
          const svg = args.source.endsWith('.svg');
          return { bytes: svg ? images.svg : images.png, mime: svg ? 'image/svg+xml' : 'image/png' };
        }
        throw new Error(`Unimplemented acceptance IPC: ${command}`);
      },
    };
  }, { content, name, images, modelLoad });
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue(name.replace(/\.md$/, ''));
  if (modelLoad === 'ready') await expect(page.getByRole('button', { name: '管理模型', exact: true })).toBeEnabled();
}

export async function savedSource(page: Page) {
  const count = await page.evaluate(() => (window as any).__acceptance.saved.length);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__acceptance.saved.length)).toBe(count + 1);
  return page.evaluate<string>(() => (window as any).__acceptance.saved.at(-1).content);
}

export async function openDiagram(page: Page, index = 0) {
  await page.getByRole('button', { name: '在可视化画布中编辑图表', exact: true }).nth(index).click();
  await expect(page.locator('.mermaid-workbench')).toBeVisible();
  await expect(page.locator('.mermaid-canvas-node').first()).toBeVisible();
}

export async function draftSource(page: Page) {
  await page.locator('.workbench-tabs').getByRole('button', { name: '源码', exact: true }).click();
  return page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).inputValue();
}

export async function showCanvas(page: Page) {
  await page.locator('.workbench-tabs').getByRole('button', { name: '画布', exact: true }).click();
  await expect(page.locator('.mermaid-canvas-node').first()).toBeVisible();
}
