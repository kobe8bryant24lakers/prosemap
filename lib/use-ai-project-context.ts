import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_AI_CONTEXT_FILES, mergeAiContextDocuments, type AiContextDocument, type AiContextFolder } from './ai-context';
import { pickAiContextFolder, readAiContextFolderFiles, refreshAiContextFolder, releaseAiContextFolder } from './local-desktop';

type ProjectSelection = { folder: AiContextFolder | null; paths: string[] };
const emptySelection = (): ProjectSelection => ({ folder: null, paths: [] });
const release = (id: string | undefined) => { if (id) void releaseAiContextFolder(id).catch(() => undefined); };

export function useAiProjectContext() {
  const [selection, setSelection] = useState<ProjectSelection>(emptySelection);
  const current = useRef(selection);
  const operation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => {
    operation.current += 1;
    release(current.current.folder?.id);
  }, []);
  const replace = useCallback((next: ProjectSelection) => {
    current.current = next;
    setSelection(next);
  }, []);
  const reset = useCallback(() => {
    operation.current += 1;
    release(current.current.folder?.id);
    replace(emptySelection());
    setBusy(false);
    setError('');
  }, [replace]);

  async function pick() {
    const id = ++operation.current;
    setBusy(true);
    setError('');
    try {
      const folder = await pickAiContextFolder();
      if (id !== operation.current) { release(folder?.id); return; }
      if (folder) {
        release(current.current.folder?.id);
        replace({ folder, paths: [] });
      }
    } catch (reason) {
      if (id === operation.current) setError(String(reason instanceof Error ? reason.message : reason));
    } finally { if (id === operation.current) setBusy(false); }
  }

  async function refresh() {
    const previous = current.current.folder;
    if (!previous) return;
    const id = ++operation.current;
    setBusy(true);
    setError('');
    try {
      const folder = await refreshAiContextFolder(previous.id);
      if (id !== operation.current) return;
      const paths = current.current.paths.filter(path => folder.files.some(file => file.path === path));
      replace({ folder, paths });
    } catch (reason) {
      if (id === operation.current) setError(String(reason instanceof Error ? reason.message : reason));
    } finally { if (id === operation.current) setBusy(false); }
  }

  function toggle(path: string, attachedCount: number) {
    const selected = current.current;
    if (!selected.folder?.files.some(file => file.path === path)) return;
    if (selected.paths.includes(path)) replace({ ...selected, paths: selected.paths.filter(value => value !== path) });
    else if (selected.paths.length + attachedCount < MAX_AI_CONTEXT_FILES) replace({ ...selected, paths: [...selected.paths, path] });
    else setError('最多可保留 12 个上下文文件，请先移除现有资料');
  }

  const validateAttachmentCount = useCallback((count: number) => {
    if (count + current.current.paths.length > MAX_AI_CONTEXT_FILES) throw new Error('最多可保留 12 个上下文文件，请先移除现有资料');
  }, []);

  async function resolve(documents: AiContextDocument[]) {
    const selected = current.current;
    if (selected.paths.length + documents.length > MAX_AI_CONTEXT_FILES) throw new Error('最多可保留 12 个上下文文件，请先移除现有资料');
    if (!selected.folder || !selected.paths.length) return documents;
    const files = await readAiContextFolderFiles(selected.folder.id, selected.paths);
    if (selected !== current.current) throw new Error('上下文选择已变化，请重新生成');
    return mergeAiContextDocuments(documents, files);
  }

  return { ...selection, busy, error, pick, refresh, reset, toggle, resolve, validateAttachmentCount };
}

export type AiProjectContextState = ReturnType<typeof useAiProjectContext>;
