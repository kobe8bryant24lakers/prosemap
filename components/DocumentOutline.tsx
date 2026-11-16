'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ListTree, PanelLeftClose } from 'lucide-react';
import { activeOutlineHeading, documentOutline, type OutlineHeading } from '@/lib/document-outline';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';

type Props = {
  markdown: string;
  activeLine: number;
  onNavigate: (heading: OutlineHeading) => void;
  onClose: () => void;
};

export default function DocumentOutline({ markdown, activeLine, onNavigate, onClose }: Props) {
  useLocale();
  const headings = useMemo(() => documentOutline(markdown), [markdown]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const activeId = activeOutlineHeading(headings, activeLine);
  const renderHeadings = (nodes: OutlineHeading[]) => <ul>{nodes.map(heading => {
    const closed = collapsed.has(heading.id);
    const title = heading.title || t('无标题');
    return <li key={heading.id}>
      <div className={`outline-row ${activeId === heading.id ? 'active' : ''}`}>
        {heading.children.length > 0 ? <button type="button" className="outline-disclosure"
          aria-label={closed ? t('展开 {0}', title) : t('收起 {0}', title)} aria-expanded={!closed}
          onClick={() => setCollapsed(previous => {
            const next = new Set(previous);
            if (next.has(heading.id)) next.delete(heading.id); else next.add(heading.id);
            return next;
          })}>{closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
          : <span className="outline-disclosure" />}
        <button type="button" className="outline-link" title={title} aria-current={activeId === heading.id ? 'location' : undefined}
          onClick={() => onNavigate(heading)}><span className="outline-level">H{heading.level}</span><span>{title}</span></button>
      </div>
      {heading.children.length > 0 && !closed && renderHeadings(heading.children)}
    </li>;
  })}</ul>;

  return <aside id="document-outline" className="file-explorer document-outline" aria-label={t('文档大纲')}>
    <header><ListTree size={17} /><div><span>{t('文档大纲')}</span></div>
      <button type="button" className="icon-button" onClick={onClose} aria-label={t('收起大纲')} title={t('收起大纲')}><PanelLeftClose size={16} /></button>
    </header>
    {headings.length ? <nav className="outline-list" aria-label={t('章节导航')}>{renderHeadings(headings)}</nav>
      : <p className="file-explorer-empty">{t('暂无标题。使用 Markdown 标题（# 至 ######）创建大纲。')}</p>}
  </aside>;
}
