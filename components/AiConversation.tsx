'use client';

import { MessageSquare, RotateCcw } from 'lucide-react';
import type { AiConversationTurn } from '@/lib/ai-conversation';
import type { AiConversationMemory } from '@/lib/ai-compaction';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';
import './AiConversation.css';

type AiConversationProps = {
  turns: AiConversationTurn[];
  onReset: () => void;
  disabled?: boolean;
  omittedTurns?: number;
  memory?: AiConversationMemory | null;
};

export default function AiConversation({ turns, memory = null, onReset, disabled = false }: AiConversationProps) {
  useLocale();
  return (
    <section className="ai-conversation" aria-label={t('AI 对话记录')}>
      <header>
        <strong><MessageSquare size={14} /> {t('连续对话')}</strong>
        <button type="button" onClick={onReset} disabled={disabled || (!turns.length && !memory)} title={t('清空对话记录，保留当前内容')}>
          <RotateCcw size={12} /> {t('新对话')}
        </button>
      </header>
      {memory ? <details className="ai-conversation-memory">
        <summary>{t('已压缩 {0} 轮较早对话', memory.compactedTurns)}</summary>
        <p>{t('摘要由模型生成，可能遗漏细节；当前文档和最新要求优先。')}</p>
        <pre>{memory.summary}</pre>
      </details> : null}
      {turns.length ? (
        <ol className="ai-conversation-turns">
          {turns.map((turn) => (
            <li key={turn.id}>
              <p className="ai-conversation-instruction">{turn.instruction}</p>
              <details>
                <summary>
                  <span>{t('查看生成内容')}</span>
                  <small>{turn.status === 'applied' ? t('已应用') : turn.status === 'discarded' ? t('已放弃') : t('待应用')}</small>
                </summary>
                <pre>{turn.output}</pre>
              </details>
            </li>
          ))}
        </ol>
      ) : !memory ? <p className="ai-conversation-empty">{t('可连续提出修改要求，AI 会参考本次会话的历史。')}</p> : null}
      <footer>
        <div>{t('对话仅保存在当前会话中。')}</div>
        <div>{t('历史较长时，会用当前模型自动压缩为摘要，保留最近对话；压缩会增加模型请求。')}</div>
      </footer>
    </section>
  );
}
