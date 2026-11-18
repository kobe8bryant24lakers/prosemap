import { ArrowUpRight, Link2, Search, Square, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { t } from '@/lib/i18n';
import type { MermaidFlowGraph, MermaidFlowNode } from '@/lib/mermaid-workbench';

export type CanvasObject = { kind: 'node' | 'edge'; id: string };

type Props = {
  graph: MermaidFlowGraph;
  nodeName: string;
  edgeName: string;
  labelFor: (node: MermaidFlowNode, kind: MermaidFlowGraph['kind']) => string;
  trigger: RefObject<HTMLButtonElement | null>;
  onPick: (object: CanvasObject, focusFields?: boolean) => void;
  onDismiss: () => void;
  onClose: () => void;
};

/** The field owns the keyboard. Browsing matches never changes canvas selection. */
export default function CanvasObjectFinder({ graph, labelFor, nodeName, edgeName, trigger, onPick, onDismiss, onClose }: Props) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const objects = useMemo(() => {
    const names = new Map(graph.nodes.map(node => [node.id, labelFor(node, graph.kind) || node.id]));
    const nodes = graph.nodes.map(node => {
      const title = names.get(node.id)!;
      const ref = node.data?.ref || node.id;
      return { kind: 'node' as const, id: node.id, title, detail: ref === title ? '' : ref,
        search: [title, node.id, ref, nodeName, ...(node.data?.details ?? [])].join(' ').toLocaleLowerCase() };
    });
    const edges = graph.edges.map(edge => {
      const ends = [names.get(edge.from) || edge.from, names.get(edge.to) || edge.to].join(' → ');
      return { kind: 'edge' as const, id: edge.id, title: edge.label || ends, detail: edge.label ? ends : '',
        search: [edge.label, ends, edge.from, edge.to, edge.id, edgeName].join(' ').toLocaleLowerCase() };
    });
    return [...nodes, ...edges];
  }, [graph, nodeName, edgeName, labelFor]);
  const results = useMemo(() => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/);
    return objects.filter(item => words.every(word => item.search.includes(word)));
  }, [objects, query]);
  const index = Math.min(cursor, results.length - 1);
  useLayoutEffect(() => { field.current?.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => {
    const el = list.current, row = el?.children[index];
    if (!el || !row) return;
    const bounds = el.getBoundingClientRect(), rect = row.getBoundingClientRect();
    if (rect.top < bounds.top) el.scrollTop += rect.top - bounds.top;
    else if (rect.bottom > bounds.bottom) el.scrollTop += rect.bottom - bounds.bottom;
  }, [index, results]);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) onClose();
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [onClose, trigger]);

  return <section className="canvas-finder" ref={panel} aria-label={t('查找图中对象')}
    onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !trigger.current?.contains(event.relatedTarget)) onClose(); }}
    onKeyDown={event => {
      if (event.key === 'Tab') return;
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); onDismiss(); return; }
      if (event.target !== field.current) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); setCursor(Math.max(0, Math.min(results.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
      } else if (event.key === 'Enter' && index >= 0) { event.preventDefault(); onPick(results[index], true); }
    }}>
    <div className="canvas-finder-field"><Search size={16} aria-hidden="true" />
      <input ref={field} type="text" role="combobox" aria-label={t('查找图中对象')} aria-expanded="true" aria-autocomplete="list"
        aria-controls={id} aria-activedescendant={index >= 0 ? id + '-' + index : undefined} autoComplete="off" spellCheck={false}
        placeholder={t('输入名称、编号或关系端点')} value={query} onChange={event => { setQuery(event.target.value); setCursor(0); }} />
      <button type="button" className="icon-button" onClick={onDismiss} aria-label={t('关闭查找')}><X size={16} /></button>
    </div>
    <div className="canvas-finder-results" ref={list} role="listbox" id={id} aria-label={t('图中对象')}>
      {results.map((item, i) => <button type="button" role="option" id={id + '-' + i} aria-selected={i === index} tabIndex={-1}
        key={item.kind + ':' + item.id} onMouseDown={event => event.preventDefault()} onClick={() => onPick(item)}>
        {item.kind === 'node' ? <Square size={15} aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}
        <span><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</span>
        <span className="canvas-finder-kind">{item.kind === 'node' ? nodeName : edgeName}</span>
      </button>)}
    </div>
    {!results.length && <p className="canvas-finder-empty">{objects.length ? t('没有匹配的对象，试试名称或编号。') : t('图中还没有对象。')}</p>}
    <footer><span role="status">{t('找到 {0} 个对象', results.length)}</span><span><ArrowUpRight size={13} aria-hidden="true" />{t('回车定位')}</span></footer>
  </section>;
}
