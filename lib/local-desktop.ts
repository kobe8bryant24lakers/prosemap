import { isDesktopRuntime } from './ai-client';
import type { AiContextDocument } from './ai-context';
import { validatePastedImage } from './image-paste';

export type LocalDocument = {
  path: string;
  name: string;
  content: string;
};

export type LocalFileEntry = {
  path: string;
  name: string;
  relativePath: string;
};

export type LocalWorkspace = {
  root: string;
  name: string;
  files: LocalFileEntry[];
};

export type LaunchTarget =
  | { kind: 'file'; document: LocalDocument }
  | { kind: 'folder'; workspace: LocalWorkspace }
  | null;

async function desktopInvoke<T>(command: string, args?: Record<string, unknown>, beforeInvoke?: () => void): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  beforeInvoke?.();
  return invoke<T>(command, args);
}

export async function pickLocalMarkdown(): Promise<LocalDocument | null> {
  if (!(await isDesktopRuntime())) return null;
  return desktopInvoke<LocalDocument | null>('pick_markdown_file');
}

export async function pickMarkdownFolder(): Promise<LocalWorkspace | null> {
  if (!(await isDesktopRuntime())) return null;
  return desktopInvoke<LocalWorkspace | null>('pick_markdown_folder');
}

export async function pickAiContextFiles(): Promise<AiContextDocument[]> {
  if (!(await isDesktopRuntime())) return [];
  return desktopInvoke<AiContextDocument[]>('pick_ai_context_files');
}

export async function readLocalMarkdown(path: string): Promise<LocalDocument> {
  return desktopInvoke<LocalDocument>('read_local_markdown', { path });
}

export async function saveLocalMarkdown(path: string | null, suggestedName: string, content: string, expectedContent: string | null): Promise<LocalDocument | null> {
  return desktopInvoke<LocalDocument | null>('save_local_markdown', { path, suggestedName, content, expectedContent });
}

export async function openRelativeFile(documentPath: string, source: string): Promise<void> {
  if (!(await isDesktopRuntime())) throw new Error('请在桌面应用中打开本地文件链接。');
  return desktopInvoke('open_relative_file', { documentPath, source });
}

export type SavedImage = { relativePath: string; name: string };
export async function savePastedImage(documentPath: string, file: File, isCurrent: () => boolean = () => true): Promise<SavedImage> {
  const ensureCurrent = () => {
    if (!isCurrent()) throw new Error('粘贴位置或文档已变化，请重新粘贴图片。');
  };
  ensureCurrent();
  await validatePastedImage(file);
  ensureCurrent();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('无法读取剪贴板图片'));
    reader.onabort = () => reject(new Error('无法读取剪贴板图片'));
    reader.readAsDataURL(file);
  });
  // Check after the IPC module loads too. Once native saving has started it
  // cannot be rolled back here; the caller must still check before insertion.
  return desktopInvoke('save_pasted_image', { documentPath, name: file.name, data }, ensureCurrent);
}

export async function readLaunchTarget(): Promise<LaunchTarget> {
  if (!(await isDesktopRuntime())) return null;
  return desktopInvoke<LaunchTarget>('read_launch_target');
}

export async function listenLocalOpened(onTarget: (target: Exclude<LaunchTarget, null>) => void) {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<Exclude<LaunchTarget, null>>('local-opened', (event) => onTarget(event.payload));
}
