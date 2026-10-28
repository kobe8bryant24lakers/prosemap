import type { LocalDocument, LocalWorkspace } from './local-desktop.ts';

/** Add an explicitly saved file using the canonical paths returned by native IPC. */
export function includeSavedFile(workspace: LocalWorkspace | null, document: LocalDocument): LocalWorkspace | null {
  if (!workspace) return workspace;
  const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(workspace.root);
  const normalize = (path: string) => windows ? path.replaceAll('\\', '/') : path;
  const prefix = normalize(workspace.root).replace(/\/+$/, '') + '/';
  const path = normalize(document.path);
  if (!path.startsWith(prefix)) return workspace;
  const relative = path.slice(prefix.length);
  if (!relative || relative.split('/').some(part => !part || part === '.' || part === '..')) return workspace;
  if (workspace.files.some(file => normalize(file.path) === path)) return workspace;

  const relativePath = windows && workspace.root.includes('\\') ? relative.replaceAll('/', '\\') : relative;
  const files = [...workspace.files, { path: document.path, name: document.name, relativePath }];
  files.sort((a, b) => {
    const left = a.relativePath.toLowerCase(), right = b.relativePath.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return { ...workspace, files };
}
