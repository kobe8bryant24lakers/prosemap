'use client';

import { diffLines } from 'diff';
import { Check, CircleAlert, GitCompareArrows, LoaderCircle, Square, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import type { Proposal } from '@/lib/editor';

type DiffModalProps = {
  proposal: Proposal;
  onAccept: () => void;
  onReject: () => void;
  onStop: () => void;
};

export default function DiffModal({ proposal, onAccept, onReject, onStop }: DiffModalProps) {
  const changes = useMemo(() => diffLines(proposal.original, proposal.modified), [proposal.original, proposal.modified]);
  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const change of changes) {
      const lines = Math.max(1, change.value.split('\n').filter(Boolean).length);
      if (change.added) added += lines;
      if (change.removed) removed += lines;
    }
    return { added, removed };
  }, [changes]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (proposal.status === 'streaming') onStop();
        else onReject();
      }
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [onReject, onStop, proposal.status]);

  return (
    <div className="modal-backdrop diff-backdrop" role="presentation">
      <section className="diff-modal" role="dialog" aria-modal="true" aria-labelledby="diff-title">
        <header className="diff-header">
          <div className="diff-heading-icon"><GitCompareArrows size={20} /></div>
          <div>
            <div className="diff-title-row">
              <h2 id="diff-title">{proposal.title}</h2>
              {proposal.status === 'streaming' ? <span className="stream-badge"><LoaderCircle size={12} /> 正在生成</span> : null}
            </div>
            <p>AI 的建议尚未写入文档，请检查差异后再决定。</p>
          </div>
          <button type="button" className="icon-button modal-close" onClick={proposal.status === 'streaming' ? onStop : onReject} aria-label="关闭差异预览"><X size={18} /></button>
        </header>

        <div className="diff-meta">
          <span>原文</span><span className="diff-arrow">→</span><span>建议版本</span>
          <span className="diff-stats"><b>+{stats.added}</b><i>−{stats.removed}</i></span>
        </div>

        <div className="diff-content" aria-live="polite">
          {proposal.status === 'error' && !proposal.modified ? (
            <div className="diff-waiting diff-failed"><CircleAlert size={22} /><span>未收到模型返回内容</span></div>
          ) : proposal.modified || proposal.status === 'streaming' ? (
            <pre>
              {changes.map((change, changeIndex) => {
                const lines = change.value.split('\n');
                if (lines.at(-1) === '') lines.pop();
                return lines.map((line, lineIndex) => (
                  <span
                    key={`${changeIndex}-${lineIndex}`}
                    className={change.added ? 'diff-line added' : change.removed ? 'diff-line removed' : 'diff-line'}
                  >
                    <i>{change.added ? '+' : change.removed ? '−' : ' '}</i><code>{line || ' '}</code>
                  </span>
                ));
              })}
              {proposal.status === 'streaming' ? <span className="stream-caret" /> : null}
            </pre>
          ) : (
            <div className="diff-waiting"><LoaderCircle size={22} /><span>正在准备第一段建议…</span></div>
          )}
        </div>

        {proposal.error ? <div className="diff-error" role="alert">{proposal.error}</div> : null}

        <footer className="diff-footer">
          <div className="privacy-note">修改仅在你接受后写入编辑器</div>
          <div className="diff-buttons">
            {proposal.status === 'streaming' ? (
              <button type="button" className="secondary-button" onClick={onStop}><Square size={14} /> 停止生成</button>
            ) : (
              <button type="button" className="secondary-button" onClick={onReject}><X size={15} /> 拒绝</button>
            )}
            <button type="button" className="confirm-button" onClick={onAccept} disabled={proposal.status !== 'ready' || !proposal.modified.trim()}><Check size={15} /> 接受并替换</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
