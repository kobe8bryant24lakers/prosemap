'use client';

import { useState } from 'react';
import { FileText, FolderOpen, Paperclip, RefreshCw, X } from 'lucide-react';
import { t, uiMessage } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';
import { MAX_AI_CONTEXT_CHARACTERS, MAX_AI_CONTEXT_FILES, type AiContextDocument } from '@/lib/ai-context';
import type { AiProjectContextState } from '@/lib/use-ai-project-context';
import './AiContextPanel.css';

type Props = {
  documents: AiContextDocument[];
  project: AiProjectContextState;
  onPickFiles: () => void;
  onRemoveFile: (path: string) => void;
};

export default function AiContextPanel({ documents, project, onPickFiles, onRemoveFile }: Props) {
  useLocale();
  const [query, setQuery] = useState('');
  const characters = documents.reduce((total, document) => total + document.content.length, 0);
  const count = project.paths.length + documents.length;
  const matches = project.folder?.files.filter(file => file.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  return (
    <section className="assistant-context-files" aria-label={t('AI 上下文资料')}>
      <header>
        <span><Paperclip size={13} /> {t('上下文资料')}</span>
        <button type="button" onClick={onPickFiles}><Paperclip size={12} /> {t('添加文件')}</button>
      </header>
      <div className="project-context">
        <button type="button" className="project-context-pick" onClick={() => void project.pick()} disabled={project.busy}>
          <FolderOpen size={14} /> {project.busy ? t('正在扫描文件夹…') : project.folder ? t('更换上下文文件夹') : t('选择代码仓或文件夹')}
        </button>
        {project.folder ? <>
          <div className="project-context-heading">
            <strong>{project.folder.name}</strong>
            <button type="button" onClick={() => void project.refresh()} disabled={project.busy} aria-label={t('刷新上下文文件列表')}><RefreshCw size={13} /></button>
            <button type="button" onClick={project.reset} aria-label={t('移除上下文文件夹')}><X size={13} /></button>
          </div>
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('搜索文件路径')} aria-label={t('搜索上下文文件')} />
          <div className="project-context-selected" aria-label={t('已选择的项目文件')}>
            {project.paths.map(path => <button type="button" key={path} onClick={() => project.toggle(path, documents.length)} title={path} aria-label={t('移除上下文 {0}', path)}>{path}<X size={11} /></button>)}
          </div>
          <div className="project-context-files">
            {matches.slice(0, 200).map(file => <label key={file.path} title={file.path}>
              <input type="checkbox" checked={project.paths.includes(file.path)} onChange={() => project.toggle(file.path, documents.length)} disabled={project.busy || (!project.paths.includes(file.path) && count >= MAX_AI_CONTEXT_FILES)} />
              <span>{file.path}</span><small>{Math.ceil(file.bytes / 1024)} KB</small>
            </label>)}
            {!matches.length ? <p>{t('没有匹配的上下文文件')}</p> : null}
          </div>
          {matches.length > 200 ? <p>{t('显示前 200 个匹配文件，请搜索以缩小范围。')}</p> : null}
          {project.folder.truncated ? <p className="project-context-warning">{t('文件夹扫描未覆盖全部文件，可选择更小的子目录。')}</p> : null}
        </> : <p>{t('支持本地代码仓和资料目录；选中的文件会在每次生成前重新读取。')}</p>}
        {project.error ? <p className="project-context-warning" role="alert">{uiMessage(project.error)}</p> : null}
      </div>
      {documents.length ? <div className="assistant-context-list">
        {documents.map(document => <div key={document.path} title={document.name}>
          <FileText size={12} /><span>{document.name}<small>{document.content.length.toLocaleString()} {t('字符')}</small></span>
          <button type="button" onClick={() => onRemoveFile(document.path)} aria-label={t('移除上下文 {0}', document.name)}><X size={12} /></button>
        </div>)}
      </div> : null}
      <footer className={characters > MAX_AI_CONTEXT_CHARACTERS ? 'truncated' : ''}>
        <div>{t('已选择 {0}/{1} 个文件', count, MAX_AI_CONTEXT_FILES)}</div>
        <div>{t('生成时，所选内容会发送到当前模型服务；参考内容最多 80,000 字符，超出时截断。')}</div>
      </footer>
    </section>
  );
}
