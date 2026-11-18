'use client';

import { t, uiMessage } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';
import { useModalFocus } from '@/lib/use-modal-focus';

import { buildProposalReview } from '@/lib/proposal-review';
import ProposalComparison from '@/components/ProposalComparison';
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
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const { original, modified, status, sourceDocument, from } = proposal;
  const review = useMemo(() => status === 'ready'
    ? buildProposalReview(original, modified, sourceDocument.slice(0, from).split('\n').length) : null,
  [status, original, modified, sourceDocument, from]);

  const dialogRef = useModalFocus(() => {
    if (proposal.status === 'streaming') onStop();
    else onReject();
  }, () => {
    // Generating a proposal unmounts its assistant button. Return to editing,
    // or to the persistent document entry when the editor is hidden.
    const editor = document.querySelector<HTMLElement>('.editor-pane .cm-content');
    return editor?.getClientRects().length ? editor : document.querySelector<HTMLElement>('.view-mode-switch button[aria-pressed="true"]');
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
              {proposal.status === 'streaming' ? <span className="stream-badge" role="status"><LoaderCircle size={12} />  {proposal.phase === 'compressing' ? t('正在压缩上下文') : t("正在生成")}</span> : null}
            </div>
            <p>{t("AI 的建议尚未写入文档，请检查差异后再决定。")}</p>
          </div>
          <button type="button" className="icon-button modal-close" onClick={proposal.status === 'streaming' ? onStop : onReject} aria-label={t("关闭差异预览")}><X size={18} /></button>
        </header>

        {proposal.phase === 'compressing' ? <div className="diff-request-notice" role="status">
          {proposal.status === 'streaming'
            ? t('正在压缩对话上下文…（{0}/{1}）', Math.min((proposal.compressionProgress?.completed ?? 0) + 1, proposal.compressionProgress?.total ?? 1), proposal.compressionProgress?.total ?? 1)
            : t('压缩未完成，原始对话已保留，文档没有被修改。')}
        </div> : null}

        {proposal.requestContext && (proposal.requestContext.omittedTurns > 0 || proposal.requestContext.omittedReferenceCharacters > 0) ? <div className="diff-request-notice" role="status">
          {proposal.requestContext.omittedTurns > 0 ? <p>{t('本次请求省略了 {0} 轮对话。', proposal.requestContext.omittedTurns)}</p> : null}
          {proposal.requestContext.omittedReferenceCharacters > 0 ? <p>{t('参考资料已截断，本次包含 {0} 个字符。', proposal.requestContext.includedReferenceCharacters.toLocaleString())}</p> : null}
        </div> : null}

        {review ? <ProposalComparison review={review} /> : <div className="diff-content diff-pending">
          {proposal.action !== 'custom' && modified ? <pre className="proposal-draft">{modified}{status === 'streaming' && <span className="stream-caret" />}</pre>
            : status === 'error' ? <div className="diff-waiting diff-failed"><CircleAlert size={22} /><span>{t('未收到可审阅的建议')}</span></div>
            : <div className="diff-waiting" role="status"><LoaderCircle size={22} /><span>{proposal.phase === 'compressing' ? t('正在整理历史中的目标、约束和决策…') : t('正在准备第一段建议…')}</span></div>}
        </div>}

        {reasoning && <section className="reasoning-panel">
          <button type="button" className="reasoning-toggle" onClick={() => setReasoningOpen(open => !open)} aria-expanded={reasoningOpen} aria-controls={reasoningOpen ? "proposal-reasoning" : undefined}>
            <BrainCircuit size={15} aria-hidden="true" /><strong>{t('AI 思考过程')}</strong>
            {reasoningOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          </button>
          {reasoningOpen && <div className="reasoning-content" id="proposal-reasoning"><pre>{reasoning}</pre></div>}
        </section>}

        {proposal.error ? <div className="diff-error" role="alert">{uiMessage(proposal.error)}</div> : null}

        <footer className="diff-footer">
          <div className="privacy-note">{review && review.hunks.length > 1 ? t('接受后将应用全部 {0} 处改动', review.hunks.length) : t('修改仅在你接受后写入编辑器')}</div>
          <div className="diff-buttons">
            {proposal.status === 'ready' && onContinue ? <button type="button" className="secondary-button" onClick={onContinue}>{t('继续对话')}</button> : null}
            {proposal.status === 'streaming' ? (
              <button type="button" className="secondary-button" onClick={onStop}><Square size={14} />  {t("停止生成")}</button>
            ) : (
              <button type="button" className="secondary-button" onClick={onReject}><X size={15} />  {review?.hunks.length === 0 ? t('关闭') : t('拒绝')}</button>
            )}
            <button type="button" className="confirm-button" onClick={onAccept} disabled={!review?.hunks.length || (proposal.action !== 'custom' && !proposal.modified.trim())}><Check size={15} />  {t("接受并替换")}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
