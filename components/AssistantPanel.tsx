'use client';

import type { ReactNode } from 'react';

import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';

import { Bot, ChevronRight, FileText, KeyRound, Paperclip, PenLine, Sparkles, TextQuote, WandSparkles, Workflow, X } from 'lucide-react';
import { MAX_AI_CONTEXT_CHARACTERS, type AiContextDocument } from '@/lib/ai-context';
import { ACTION_LABELS, type AssistAction, type ModelConfig } from '@/lib/editor';

type AssistantPanelProps = {
  action: AssistAction;
  instruction: string;
  config: ModelConfig;
  modelSwitcher: ReactNode;
  targetLength: number;
  hasSelection: boolean;
  hasMermaidTarget: boolean;
  contextDocuments: AiContextDocument[];
  contextPanel?: ReactNode;
  conversation?: ReactNode;
  onActionChange: (action: AssistAction) => void;
  onInstructionChange: (instruction: string) => void;
  onPickContext: () => void;
  onRemoveContext: (path: string) => void;
  onOpenSettings: () => void;
  onRun: (instruction: string) => void;
  onClose: () => void;
};

const textActions: Array<{ action: Exclude<AssistAction, 'mermaid'>; icon: typeof Sparkles; description: string }> = [
  { action: 'polish', icon: Sparkles, get description() { return t("改善语气、清晰度与节奏"); } },
  { action: 'continue', icon: PenLine, get description() { return t("沿用上下文自然补充内容"); } },
  { action: 'summarize', icon: TextQuote, get description() { return t("提炼重点并保留关键信息"); } },
  { action: 'custom', icon: WandSparkles, get description() { return t("按你的具体要求进行处理"); } },
];

export default function AssistantPanel({
  action,
  instruction,
  config,
  modelSwitcher,
  targetLength,
  hasSelection,
  hasMermaidTarget,
  contextDocuments,
  contextPanel,
  conversation,
  onActionChange,
  onInstructionChange,
  onPickContext,
  onRemoveContext,
  onOpenSettings,
  onRun,
  onClose,
}: AssistantPanelProps) {
  useLocale();
  const configured = Boolean(config.apiKey && config.model);
  const contextCharacters = contextDocuments.reduce((total, document) => total + document.content.length, 0);

  const instructionRequired = action === 'custom' || action === 'mermaid';
  const placeholder = action === 'mermaid'
    ? hasMermaidTarget
      ? t("例如：把审批环节改成财务与法务并行，再汇总到负责人")
      : t("例如：创建一个包含登录、校验、成功和失败分支的流程图")
    : action === 'custom'
      ? t("例如：改写成适合产品发布会的简洁口吻，并保留所有数字")
      : t("补充要求（可选），例如：更简洁、使用专业语气…");

  return (
    <aside id="writing-assistant" className="assistant-panel" aria-label={t("AI 助手")}>
      <header className="assistant-header">
        <div className="assistant-title"><span><Sparkles size={16} /></span><div><strong>{t("AI 助手")}</strong><small>{t("建议先预览，再决定是否采用")}</small></div></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t("关闭 AI 助手")}><X size={18} /></button>
      </header>

      <div className="assistant-scroll">
        <label className="assistant-compact-action">
          {t('处理方式')}
          <select value={action} onChange={event => onActionChange(event.target.value as AssistAction)}>
            {textActions.map(({ action: itemAction }) => <option key={itemAction} value={itemAction}>{t(ACTION_LABELS[itemAction])}</option>)}
            <option value="mermaid">{t(ACTION_LABELS.mermaid)}</option>
          </select>
        </label>
        <section className="assistant-section">
          <div className="assistant-action-list" role="group" aria-label={t("文字处理")}>
            {textActions.map(({ action: itemAction, icon: Icon, description }) => (
              <button key={itemAction} type="button" className={`assistant-action ${action === itemAction ? 'active' : ''}`} aria-pressed={action === itemAction} title={description} onClick={() => onActionChange(itemAction)}>
                <Icon size={15} aria-hidden="true" />
                <strong>{t(ACTION_LABELS[itemAction])}</strong>
              </button>
            ))}
          </div>
        </section>

        <section className="assistant-section mermaid-section">
          <button type="button" className={`mermaid-action ${action === 'mermaid' ? 'active' : ''}`} aria-pressed={action === 'mermaid'} onClick={() => onActionChange('mermaid')}>
            <Workflow size={18} aria-hidden="true" />
            <span><b>{t("Mermaid 智能绘图")}</b><small>{t("用自然语言创建或修改流程图、时序图与架构图")}</small></span>
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </section>

        <section className="assistant-compose">
          <div className="compose-context" id="assistant-scope" role="status" aria-atomic="true">
            <span><Bot size={14} /> {t(ACTION_LABELS[action])}</span>
            <small>{action === 'mermaid' ? (hasMermaidTarget ? t("将修改光标所在的 Mermaid 图") : t("将在光标位置创建新图")) : hasSelection ? t("已选中 {0} 个字符", targetLength) : t("将处理全文 · {0} 个字符", targetLength)}</small>
          </div>
          <label htmlFor="ai-instruction">{instructionRequired ? t("告诉 AI 你的要求") : t("补充要求")}</label>
          <textarea id="ai-instruction" value={instruction} onChange={(event) => onInstructionChange(event.target.value)} placeholder={placeholder} rows={4}
            aria-describedby="assistant-scope assistant-submit-hint"
            onKeyDown={event => {
              if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
              event.preventDefault();
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (configured && (!instructionRequired || instruction.trim())) onRun(instruction.trim());
            }} />
          <p className="assistant-submit-hint" id="assistant-submit-hint">{t('⌘ / Ctrl + Enter 生成建议')}</p>
          {conversation}
          {contextPanel ?? <section className="assistant-context-files" aria-label={t("AI 上下文资料")}>
            <header>
              <span><Paperclip size={13} />  {t("上下文资料")}</span>
              <button type="button" onClick={onPickContext}><Paperclip size={12} />  {t("添加文件")}</button>
            </header>
            {contextDocuments.length ? (
              <div className="assistant-context-list">
                {contextDocuments.map((document) => (
                  <div key={document.path} title={document.path}>
                    <FileText size={12} />
                    <span>{document.name}<small>{document.content.length.toLocaleString('zh-CN')}  {t("字符")}</small></span>
                    <button type="button" onClick={() => onRemoveContext(document.path)} aria-label={t("移除上下文 {0}", document.name)}><X size={12} /></button>
                  </div>
                ))}
              </div>
            ) : <p>{t("可加入 Markdown、资料、配置或代码，让 AI 理解当前文档之外的环境。")}</p>}
            <footer className={contextCharacters > MAX_AI_CONTEXT_CHARACTERS ? 'truncated' : ''}>
              {contextDocuments.length
                ? t("{0} 个文件 · {1} 字符{2}", contextDocuments.length, contextCharacters.toLocaleString('zh-CN'), contextCharacters > MAX_AI_CONTEXT_CHARACTERS ? t(" · 请求时截取前 {0}", MAX_AI_CONTEXT_CHARACTERS.toLocaleString('zh-CN')) : '')
                : t("仅在本次文档会话中使用，不会修改这些文件")}
            </footer>
          </section>}
        </section>
      </div>
      <footer className="assistant-footer">
          {!configured ? (
            <button type="button" className="configure-callout" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onOpenSettings(); }}>
              <KeyRound size={16} /><span><strong>{t("先连接一个模型")}</strong><small>{t("支持 OpenAI-compatible 与 Anthropic Claude")}</small></span><ChevronRight size={15} />
            </button>
          ) : (
            <div className="active-model">{modelSwitcher}</div>
          )}
          <button type="button" className="run-button" onClick={() => onRun(instruction.trim())} disabled={!configured || (instructionRequired && !instruction.trim())}>
            <Sparkles size={15} />  {t("生成建议")} </button>
          <p className="compose-footnote">{t("不会直接改写文档；生成后可逐行检查差异。")}</p>
      </footer>
    </aside>
  );
}
