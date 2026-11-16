'use client';

import { t, uiMessage } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';
import { useModalFocus } from '@/lib/use-modal-focus';

import { diffLines } from 'diff';
import { BrainCircuit, Check, ChevronDown, ChevronRight, CircleAlert, GitCompareArrows, LoaderCircle, Square, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Proposal } from '@/lib/editor';

type DiffModalProps = {
  proposal: Proposal;
  onAccept: () => void;
  onReject: () => void;
  onStop: () => void;
  onContinue?: () => void;
};

export default function DiffModal({ proposal, onAccept, onReject, onStop, onContinue }: DiffModalProps) {
  useLocale();
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const changes = useMemo(() => diffLines(proposal.original, proposal.modified), [proposal.original, proposal.modified]);
  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const change of changes) {
      if (change.added) added += change.count;
      if (change.removed) removed += change.count;
    }
    return { added, removed };
  }, [changes]);

  const dialogRef = useModalFocus(() => {
    if (proposal.status === 'streaming') onStop();
    else onReject();
  }, () => {
    // Generating a proposal unmounts its assistant button. Return to editing,
    // or to the persistent document entry when the editor is hidden.
    const editor = document.querySelector<HTMLElement>('.editor-pane .cm-content');
    return editor?.getClientRects().length ? editor : document.querySelector<HTMLElement>('.rail .rail-button');
  });

  const reasoning = proposal.reasoning.trim();

  return (
    <div className="modal-backdrop diff-backdrop" role="presentation">
      <section ref={dialogRef} className="diff-modal" role="dialog" aria-modal="true" aria-labelledby="diff-title" tabIndex={-1}>
        <header className="diff-header">
          <div className="diff-heading-icon"><GitCompareArrows size={20} /></div>
          <div>
            <div className="diff-title-row">
              <h2 id="diff-title">{uiMessage(proposal.title)}</h2>
              {proposal.status === 'streaming' ? <span className="stream-badge"><LoaderCircle size={12} />  {proposal.phase === 'compressing' ? t('正在压缩上下文') : t("正在生成")}</span> : null}
            </div>
            <p>{t("AI 的建议尚未写入文档，请检查差异后再决定。")}</p>
          </div>
          <button type="button" className="icon-button modal-close" onClick={proposal.status === 'streaming' ? onStop : onReject} aria-label={t("关闭差异预览")}><X size={18} /></button>
        </header>

        <div className="diff-meta">
          <span>{t("原文")}</span><span className="diff-arrow">→</span><span>{t("建议版本")}</span>
          <span className="diff-stats"><b>+{stats.added}</b><i>−{stats.removed}</i></span>
        </div>

        {proposal.phase === 'compressing' ? <div className="diff-request-notice" role="status">
          {proposal.status === 'streaming'
            ? t('正在压缩对话上下文…（{0}/{1}）', Math.min((proposal.compressionProgress?.completed ?? 0) + 1, proposal.compressionProgress?.total ?? 1), proposal.compressionProgress?.total ?? 1)
            : t('压缩未完成，原始对话已保留，文档没有被修改。')}
        </div> : <section className={`reasoning-panel${reasoningOpen ? ' open' : ''}`}>
          <button type="button" className="reasoning-toggle" onClick={() => setReasoningOpen((open) => !open)} aria-expanded={reasoningOpen}>
            <BrainCircuit size={16} />
            <span><strong>{t("AI 思考过程")}</strong><small>{reasoning ? t("已接收 {0} 个字符", reasoning.length) : proposal.status === 'streaming' ? t("等待模型返回推理内容") : t("模型未返回推理内容")}</small></span>
            {proposal.status === 'streaming' ? <LoaderCircle className="spinning" size={14} /> : reasoningOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {reasoningOpen ? (
            <div className="reasoning-content" aria-live="polite">
              {reasoning ? <pre>{reasoning}</pre> : <p>{proposal.status === 'streaming' ? t("正在等待模型提供可展示的思考过程…") : t("当前模型或接口没有返回可展示的思考过程。")}</p>}
            </div>
          ) : null}
        </section>}

        {proposal.requestContext && (proposal.requestContext.omittedTurns > 0 || proposal.requestContext.omittedReferenceCharacters > 0) ? <div className="diff-request-notice" role="status">
          {proposal.requestContext.omittedTurns > 0 ? <p>{t('本次请求省略了 {0} 轮对话。', proposal.requestContext.omittedTurns)}</p> : null}
          {proposal.requestContext.omittedReferenceCharacters > 0 ? <p>{t('参考资料已截断，本次包含 {0} 个字符。', proposal.requestContext.includedReferenceCharacters.toLocaleString())}</p> : null}
        </div> : null}

        <div className="diff-content" aria-live="polite">
          {proposal.phase === 'compressing' && proposal.status === 'streaming' ? <div className="diff-waiting"><LoaderCircle size={22} /><span>{t('正在整理历史中的目标、约束和决策…')}</span></div> : proposal.status === 'error' && !proposal.modified ? (
            <div className="diff-waiting diff-failed"><CircleAlert size={22} /><span>{t("未收到模型返回内容")}</span></div>
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
            <div className="diff-waiting"><LoaderCircle size={22} /><span>{t("正在准备第一段建议…")}</span></div>
          )}
        </div>

        {proposal.error ? <div className="diff-error" role="alert">{uiMessage(proposal.error)}</div> : null}

        <footer className="diff-footer">
          <div className="privacy-note">{t("修改仅在你接受后写入编辑器")}</div>
          <div className="diff-buttons">
            {proposal.status === 'ready' && onContinue ? <button type="button" className="secondary-button" onClick={onContinue}>{t('继续对话')}</button> : null}
            {proposal.status === 'streaming' ? (
              <button type="button" className="secondary-button" onClick={onStop}><Square size={14} />  {t("停止生成")}</button>
            ) : (
              <button type="button" className="secondary-button" onClick={onReject}><X size={15} />  {t("拒绝")}</button>
            )}
            <button type="button" className="confirm-button" onClick={onAccept} disabled={proposal.status !== 'ready' || !proposal.modified.trim()}><Check size={15} />  {t("接受并替换")}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
