import { Boxes, CalendarRange, Check, ChevronRight, Database, FolderTree, GitBranch, Layers, ListTree, MessagesSquare, Network, Search, Users, Waypoints, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { MERMAID_TEMPLATES } from '@/lib/mermaid-workbench';

const glyphs: Record<string, typeof GitBranch> = {
  'basic-flowchart': GitBranch, 'four-plus-one': Network, architecture: Layers, sequence: MessagesSquare,
  state: Waypoints, class: Boxes, er: Database, mindmap: ListTree, gantt: CalendarRange, usecase: Users, package: FolderTree,
};

export default function MermaidTemplateLibrary({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const matches = MERMAID_TEMPLATES.filter(item =>
    [t(item.name), t(item.category), t(item.description), item.id].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="workbench-template-panel">
    <h3>{t('选择图表模板')}</h3>
    <p>{t('选好模板后会打开画布，可以继续修改。')}</p>
    <div className="template-search"><Search size={15} aria-hidden="true" />
      <input ref={input} type="text" aria-label={t('查找模板')} placeholder={t('按名称或用途查找')} value={query} onChange={event => setQuery(event.target.value)} />
      {query && <button type="button" className="icon-button" aria-label={t('清除模板搜索')} onClick={() => { setQuery(''); input.current?.focus(); }}><X size={14} /></button>}
    </div>
    <div className="workbench-template-grid">
      {matches.map(item => {
        const Icon = glyphs[item.id] || GitBranch;
        return <button key={item.id} type="button" className={item.id === selected ? 'active' : ''} aria-current={item.id === selected || undefined}
          onClick={event => { event.currentTarget.focus({ preventScroll: true }); onSelect(item.id); }}>
          <Icon size={18} aria-hidden="true" /><span><b>{t(item.name)}</b><small>{t(item.description)}</small></span>
          {item.id === selected ? <Check size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
        </button>;
      })}
    </div>
    {!matches.length && <p role="status">{t('没有匹配的模板，试试图表类型或用途。')}</p>}
  </div>;
}
