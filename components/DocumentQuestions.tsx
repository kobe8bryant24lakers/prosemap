import { ListChecks, RotateCcw } from 'lucide-react';
import { memo, useLayoutEffect, useRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { t } from '@/lib/i18n';
import type { useDocumentQuestions } from '@/lib/use-document-questions';
import './DocumentQuestions.css';

export type DocumentQuestionsState = ReturnType<typeof useDocumentQuestions>;
type Props = {
  questions: DocumentQuestionsState;
  configured: boolean;
  hasSelection: boolean;
  contextPanel?: ReactNode;
  onAsk: (question: string) => void;
};

const markdownElements = ['p', 'strong', 'em', 'del', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br'];
const Answer = memo(function Answer({ text }: { text: string }) {
  return <div className="question-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml allowedElements={markdownElements} unwrapDisallowed>{text}</ReactMarkdown></div>;
});

export default function DocumentQuestions({ questions, configured, hasSelection, contextPanel, onAsk }: Props) {
  const { turns, memory, pending, busy, draft, setDraft, useSelection } = questions;
  const field = useRef<HTMLTextAreaElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const lastQuestion = useRef<string | undefined>(undefined);
  const scopeReady = !useSelection || hasSelection;
  const empty = !turns.length && !pending && !memory;
  useLayoutEffect(() => {
    if (pending && lastQuestion.current !== pending.question) follow.current = true;
    lastQuestion.current = pending?.question;
    if (follow.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [turns, pending]);

  function send(value: string) {
    if (busy || !value.trim() || !scopeReady) return;
    follow.current = true;
    if (configured) onAsk(value);
    else { setDraft(value); field.current?.focus(); }
  }

  return <>
    <div className="question-tools">
      <label>{t('提问范围')} <select value={useSelection ? 'selection' : 'document'} disabled={busy} onChange={e => questions.setUseSelection(e.target.value === 'selection')}>
        <option value="document">{t('全文')}</option><option value="selection" disabled={!hasSelection}>{t('当前选区')}</option>
      </select></label>
      <button type="button" disabled={empty || busy} onClick={() => { questions.reset(); field.current?.focus(); }}><RotateCcw size={13} aria-hidden="true" />{t('新问答')}</button>
    </div>
    <div ref={feed} className="question-history" role="region" aria-label={t('问答记录')} tabIndex={0}
      onScroll={e => { const el = e.currentTarget; follow.current = el.scrollHeight - el.clientHeight - el.scrollTop < 28; }}>
      {contextPanel && <details className="question-references"><summary>{t('参考资料')}</summary>{contextPanel}</details>}
      {empty && <div className="question-empty"><h3>{t('想了解文档的哪一部分？')}</h3><p>{t('可以询问某个细节，也可以先读一份摘要。')}</p></div>}
      {memory && <details className="question-memory"><summary>{t('已压缩 {0} 轮较早对话', memory.compactedTurns)}</summary><Answer text={memory.summary} /></details>}
      {turns.map(turn => <section className="question-exchange" key={turn.id}>
        <h3>{turn.instruction}</h3><Answer text={turn.output} />
        {turn.truncatedReferences && <small>{t('参考资料已截断，本次包含 {0} 个字符。', turn.truncatedReferences.includedCharacters.toLocaleString())}</small>}
      </section>)}
      {pending && <section className="question-exchange"><h3>{pending.question}</h3>
        {pending.text && <div className="question-stream">{pending.text}</div>}
        {pending.truncatedReferences && <small>{t('参考资料已截断，本次包含 {0} 个字符。', pending.truncatedReferences.includedCharacters.toLocaleString())}</small>}
        {busy ? <p className="question-status" role="status">{pending.phase === 'compressing' ? t('正在整理较早的问答…') : t('正在回答…')}</p>
          : <div className="question-feedback"><p role={pending.phase === 'error' ? 'alert' : 'status'}>{pending.phase === 'error' ? pending.message : t('回答已停止。')}</p>
            <button type="button" disabled={!configured || !scopeReady} onClick={() => send(pending.question)}>{t('重新提问')}</button></div>}
      </section>}
    </div>
    <div className="question-compose">
      <div><label htmlFor="document-question">{turns.length ? t('继续追问') : t('你的问题')}</label>
        <button type="button" disabled={busy || !scopeReady} onClick={() => send(useSelection ? t('请总结选区的主要内容。') : t('请总结这篇文档的主要内容。'))}><ListChecks size={14} aria-hidden="true" />{t('总结要点')}</button>
      </div>
      <textarea ref={field} id="document-question" rows={2} value={draft} onChange={e => setDraft(e.target.value)}
        placeholder={t('输入关于文档的问题…')} aria-keyshortcuts="Meta+Enter Control+Enter" onKeyDown={e => {
          if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
          e.preventDefault();
          if (!e.nativeEvent.isComposing && e.keyCode !== 229 && !e.repeat && configured) send(draft);
        }} />
      {!scopeReady && <small role="status">{t('请选中一段正文，或将提问范围切换为全文。')}</small>}
      <span className="visually-hidden" role="status">{!pending && turns.length ? t('回答已完成') : ''}</span>
    </div>
  </>;
}
