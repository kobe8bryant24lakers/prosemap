import { isDesktopRuntime } from './ai-client';

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

async function desktopInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
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

export async function readLocalMarkdown(path: string): Promise<LocalDocument> {
  return desktopInvoke<LocalDocument>('read_local_markdown', { path });
}

export async function saveLocalMarkdown(path: string | null, suggestedName: string, content: string): Promise<LocalDocument | null> {
  return desktopInvoke<LocalDocument | null>('save_local_markdown', { path, suggestedName, content });
}

export async function readLaunchTarget(): Promise<LaunchTarget> {
  if (!(await isDesktopRuntime())) return null;
  return desktopInvoke<LaunchTarget>('read_launch_target');
}

export async function listenLocalOpened(onTarget: (target: Exclude<LaunchTarget, null>) => void) {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<Exclude<LaunchTarget, null>>('local-opened', (event) => onTarget(event.payload));
}
