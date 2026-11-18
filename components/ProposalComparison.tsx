'use client';

import { ArrowUpRight, Check, Minus, Plus } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import type { buildProposalReview, ReviewHunk, ReviewRow } from '@/lib/proposal-review';

type Mode = 'changes' | 'full';
type Review = ReturnType<typeof buildProposalReview>;

function location(hunk: ReviewHunk) {
  if (hunk.inserted) return t('插入位置：第 {0} 行', hunk.fromLine);
  return hunk.fromLine === hunk.toLine ? t('原文第 {0} 行', hunk.fromLine) : t('原文第 {0}–{1} 行', hunk.fromLine, hunk.toLine);
}

function lineText(row: ReviewRow, compact = false) {
  const blank = compact && /^[ \t]*$/.test(row.text);
  return <>{blank ? <span className="diff-annotation">{row.text ? t('仅空白：{0}', row.text.replaceAll(' ', '·').replaceAll('\t', '⇥')) : t('空行')}</span> : row.text || ' '}
    {row.showEnding && <small className="diff-ending">{row.ending ? t('行末：{0}', row.ending) : t('行末无换行')}</small>}</>;
}

export default function ProposalComparison({ review }: { review: Review }) {
  const [mode, setMode] = useState<Mode>('changes');
  const scroller = useRef<HTMLDivElement>(null);
  const positions = useRef({ changes: { top: 0, left: 0 }, full: { top: 0, left: 0 } });
  const jump = useRef<number | null>(null);

  function show(next: Mode, row?: number) {
    if (next === mode) return;
    const el = scroller.current;
    if (el) positions.current[mode] = { top: el.scrollTop, left: el.scrollLeft };
    jump.current = row ?? null;
    setMode(next);
  }

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const row = jump.current === null ? null : el.querySelector<HTMLElement>(`[data-row="${jump.current}"]`);
    jump.current = null;
    if (row) {
      el.focus({ preventScroll: true });
      el.scrollTo({ top: el.scrollTop + row.getBoundingClientRect().top - el.getBoundingClientRect().top - 36, left: 0 });
    } else el.scrollTo(positions.current[mode]);
  }, [mode]);

  return <>
    <div className="diff-meta">
      <div className="review-switch" role="group" aria-label={t('对比视图')}>
        <button type="button" aria-pressed={mode === 'changes'} onClick={() => show('changes')}>{t('只看改动')}</button>
        <button type="button" aria-pressed={mode === 'full'} onClick={() => show('full')}>{t('全文对照')}</button>
      </div>
      <div className="review-summary">
        <span className="review-total">{review.hunks.length === 1 ? t('共 1 处改动') : t('共 {0} 处改动', review.hunks.length)}</span>
        <span className="diff-stats" title={t('新增 {0} 行，移除 {1} 行', review.added, review.removed)}>
          <span className="visually-hidden">{t('新增 {0} 行，移除 {1} 行', review.added, review.removed)}</span>
          <b aria-hidden="true">+{review.added}</b><i aria-hidden="true">−{review.removed}</i>
        </span>
      </div>
    </div>
    <div ref={scroller} className="diff-content" role="region" aria-label={mode === 'changes' ? t('只看改动') : t('全文对照')} tabIndex={0}>
      {mode === 'full' ? <div className="review-source">
        {review.rows.map((row, index) => <div key={index} data-row={index} className={`diff-line ${row.kind}`}>
          <span className="diff-line-number" aria-hidden="true">{row.line}</span>
          <i aria-hidden="true">{row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ''}</i>
          {row.kind !== 'context' && <span className="visually-hidden">{row.kind === 'added' ? t('新增行') : t('移除行')} </span>}
          <code>{lineText(row)}</code>
        </div>)}
      </div> : review.hunks.length ? <div className="review-changes">{review.hunks.map((hunk, index) => {
        const rows = review.rows.slice(hunk.start, hunk.end);
        const lineLabel = location(hunk);
        return <section className="review-hunk" key={hunk.start} aria-labelledby={`hunk-${index}`}>
          <div className="hunk-heading">
            <h3 id={`hunk-${index}`}>{t('第 {0} 处改动', index + 1)}</h3>
            <button type="button" onClick={() => show('full', hunk.start)} aria-label={t('在全文中查看：{0}', lineLabel)}>{lineLabel}<ArrowUpRight size={13} aria-hidden="true" /></button>
          </div>
          {(['removed', 'added'] as const).map(kind => {
            const part = rows.filter(row => row.kind === kind);
            if (!part.length) return null;
            return <div className={`review-version ${kind}`} key={kind}>
              <span className="version-label">{kind === 'added' ? <Plus size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}{kind === 'added' ? t('建议版本') : t('原文')}</span>
              <div>{part.map(row => <div key={row.line} className={`diff-line ${kind}`}>{lineText(row, true)}</div>)}</div>
            </div>;
          })}
        </section>;
      })}</div> : <div className="diff-waiting diff-identical"><Check size={22} aria-hidden="true" /><span>{t('建议与原文相同，无需替换。')}</span></div>}
    </div>
  </>;
}
