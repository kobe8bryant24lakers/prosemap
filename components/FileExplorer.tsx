'use client';

import { useMemo, useRef, useState } from 'react';
import { FileText, FolderOpen, Search, X } from 'lucide-react';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';
import type { LocalFileEntry, LocalWorkspace } from '@/lib/local-desktop';

type Props = {
  workspace: LocalWorkspace | null;
  activePath: string | null;
  onOpen: (entry: LocalFileEntry) => void;
  onChooseFolder: () => void;
  onClose: () => void;
};

export default function FileExplorer({ workspace, activePath, onOpen, onChooseFolder, onClose }: Props) {
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const files = useMemo(() => workspace?.files.filter(entry =>
    entry.relativePath.toLocaleLowerCase().includes(normalizedQuery)) ?? [], [workspace, normalizedQuery]);
  const clearSearch = () => { setQuery(''); searchRef.current?.focus(); };

  return <aside id="local-files" className="file-explorer" aria-label={t('本地 Markdown 文件')}>
    <header>
      <FolderOpen size={17} aria-hidden="true" />
      <div><span>{t('本地文件夹')}</span><strong title={workspace?.root}>{workspace?.name ?? t('尚未打开文件夹')}</strong></div>
      <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭文件列表')} title={t('关闭文件列表')}><X size={16} /></button>
    </header>
    {workspace ? <>
      <div className="file-search">
        <label htmlFor="workspace-file-search"><Search size={14} aria-hidden="true" /><span>{t('查找文件')}</span></label>
        <div className="file-search-field">
          <input ref={searchRef} id="workspace-file-search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder={t('文件名或路径')} autoComplete="off" spellCheck={false}
            onKeyDown={event => {
              if (event.key === 'Escape' && !event.nativeEvent.isComposing && query) {
                event.preventDefault(); event.stopPropagation(); clearSearch();
              }
            }} />
          {query && <button type="button" onClick={clearSearch} aria-label={t('清除文件搜索')} title={t('清除文件搜索')}><X size={14} /></button>}
        </div>
      </div>
      <div className="file-scan-status">
        <span role="status" aria-atomic="true">{normalizedQuery
          ? t('找到 {0} / {1} 个文件', files.length.toLocaleString(locale), workspace.files.length.toLocaleString(locale))
          : t('已列出 {0} 个文件', workspace.files.length.toLocaleString(locale))}</span>
        {workspace.scanLimits?.fileCount != null && <p>{t('本次扫描达到 {0} 个文件上限，可能还有文件未显示。', workspace.scanLimits.fileCount.toLocaleString(locale))}</p>}
        {workspace.scanLimits?.depth != null && <p>{t('超过 {0} 层的子文件夹未扫描。', workspace.scanLimits.depth)}</p>}
      </div>
      {files.length ? <div className="file-list">
        {files.map(entry => <button type="button" key={entry.path} className={entry.path === activePath ? 'active' : ''}
          aria-current={entry.path === activePath ? 'page' : undefined} onClick={() => onOpen(entry)} title={entry.relativePath}>
          <FileText size={15} aria-hidden="true" /><span>{entry.relativePath}</span>
        </button>)}
      </div> : <div className="file-explorer-empty">
        <p>{normalizedQuery ? t('没有匹配的文件') : t(workspace.scanLimits?.depth != null ? '扫描范围内没有 Markdown 文件。' : '此文件夹中没有 Markdown 文件。')}</p>
        {normalizedQuery && <button type="button" className="text-button" onClick={clearSearch}>{t('清除搜索')}</button>}
      </div>}
    </> : <div className="file-explorer-welcome">
      <FolderOpen size={28} aria-hidden="true" />
      <p>{t('打开文件夹后，可在这里直接切换其中的 Markdown 文件。')}</p>
      <button type="button" onClick={onChooseFolder}>{t('选择文件夹')}</button>
    </div>}
  </aside>;
}
