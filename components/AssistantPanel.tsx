'use client';

import { Bot, ChevronRight, KeyRound, PenLine, Sparkles, TextQuote, WandSparkles, Workflow, X } from 'lucide-react';
import { useState } from 'react';
import { ACTION_LABELS, type AssistAction, type ModelConfig } from '@/lib/editor';

type AssistantPanelProps = {
  action: AssistAction;
  config: ModelConfig;
  targetLength: number;
  hasSelection: boolean;
  hasMermaidTarget: boolean;
  onActionChange: (action: AssistAction) => void;
  onOpenSettings: () => void;
  onRun: (instruction: string) => void;
  onClose: () => void;
};

const textActions: Array<{ action: Exclude<AssistAction, 'mermaid'>; icon: typeof Sparkles; description: string }> = [
  { action: 'polish', icon: Sparkles, description: '改善语气、清晰度与节奏' },
  { action: 'continue', icon: PenLine, description: '沿用上下文自然补充内容' },
  { action: 'summarize', icon: TextQuote, description: '提炼重点并保留关键信息' },
  { action: 'custom', icon: WandSparkles, description: '按你的具体要求进行处理' },
];

export default function AssistantPanel({
  action,
  config,
  targetLength,
  hasSelection,
  hasMermaidTarget,
  onActionChange,
  onOpenSettings,
  onRun,
  onClose,
}: AssistantPanelProps) {
  const [instruction, setInstruction] = useState('');
  const configured = Boolean(config.apiKey && config.model);

  const instructionRequired = action === 'custom' || action === 'mermaid';
  const placeholder = action === 'mermaid'
    ? hasMermaidTarget
      ? '例如：把审批环节改成财务与法务并行，再汇总到负责人'
      : '例如：创建一个包含登录、校验、成功和失败分支的流程图'
    : action === 'custom'
      ? '例如：改写成适合产品发布会的简洁口吻，并保留所有数字'
      : '补充要求（可选），例如：更简洁、使用专业语气…';

  return (
    <aside className="assistant-panel" aria-label="AI 助手">
      <header className="assistant-header">
        <div className="assistant-title"><span><Sparkles size={16} /></span><div><strong>AI 助手</strong><small>建议先预览，再决定是否采用</small></div></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭 AI 助手"><X size={18} /></button>
      </header>

      <div className="assistant-scroll">
        <section className="assistant-section">
          <div className="section-kicker">文字处理</div>
          <div className="assistant-action-list">
            {textActions.map(({ action: itemAction, icon: Icon, description }) => (
              <button key={itemAction} type="button" className={`assistant-action ${action === itemAction ? 'active' : ''}`} onClick={() => { setInstruction(''); onActionChange(itemAction); }}>
                <span className="assistant-action-icon"><Icon size={16} /></span>
                <span><strong>{ACTION_LABELS[itemAction]}</strong><small>{description}</small></span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        </section>

        <section className="assistant-section mermaid-section">
          <div className="section-kicker">智能可视化</div>
          <button type="button" className={`mermaid-action ${action === 'mermaid' ? 'active' : ''}`} onClick={() => { setInstruction(''); onActionChange('mermaid'); }}>
            <span className="mermaid-action-art" aria-hidden="true"><i /><i /><i /></span>
            <span><b><Workflow size={15} /> Mermaid 智能绘图</b><small>用自然语言创建或修改流程图、时序图与架构图</small></span>
            <ChevronRight size={15} />
          </button>
        </section>

        <section className="assistant-compose">
          <div className="compose-context">
            <span><Bot size={14} /> {ACTION_LABELS[action]}</span>
            <small>{action === 'mermaid' ? (hasMermaidTarget ? '将修改光标所在的 Mermaid 图' : '将在光标位置创建新图') : hasSelection ? `已选中 ${targetLength} 个字符` : `将处理全文 · ${targetLength} 个字符`}</small>
          </div>
          <label htmlFor="ai-instruction">{instructionRequired ? '告诉 AI 你的要求' : '补充要求'}</label>
          <textarea id="ai-instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={placeholder} rows={4} />
          {!configured ? (
            <button type="button" className="configure-callout" onClick={onOpenSettings}>
              <KeyRound size={16} /><span><strong>先连接一个模型</strong><small>支持 OpenAI-compatible 与 Anthropic Claude</small></span><ChevronRight size={15} />
            </button>
          ) : (
            <div className="active-model"><span className="live-dot" /><span>{config.provider === 'openai' ? 'OpenAI-compatible' : 'Anthropic Claude'}</span><b>{config.model}</b><button type="button" onClick={onOpenSettings}>更换</button></div>
          )}
          <button type="button" className="run-button" onClick={() => onRun(instruction.trim())} disabled={!configured || (instructionRequired && !instruction.trim())}>
            <Sparkles size={15} /> 生成建议
          </button>
          <p className="compose-footnote">不会直接改写文档；生成后可逐行检查差异。</p>
        </section>
      </div>
    </aside>
  );
}
