'use client';

import {
  Bot,
  BrainCircuit,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Eye,
  GitBranch,
  LayoutTemplate,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { streamAi } from '@/lib/ai-client';
import type { ModelConfig } from '@/lib/editor';
import { parseMermaid } from '@/lib/mermaid-runtime';
import {
  MERMAID_TEMPLATES,
  createMermaidAiPrompts,
  extractMermaidSource,
  mermaidSafetyError,
  parseMermaidVisualSource,
  serializeMermaidVisualGraph,
  type MermaidVisualGraph,
} from '@/lib/mermaid-workbench';
import MermaidCanvasEditor from './MermaidCanvasEditor';
import MermaidDiagram from './MermaidDiagram';
import type { ConfirmationRequest } from './ConfirmDialog';
import './MermaidWorkbench.css';

type WorkbenchTab = 'ai' | 'templates' | 'visual' | 'source';

type AiDraftValidation = {
  kind: 'idle' | 'checking' | 'valid' | 'error';
  message: string;
};

type MermaidWorkbenchProps = {
  sessionId: number;
  config: ModelConfig;
  initialSource?: string;
  inactive?: boolean;
  interactionSuspended?: boolean;
  mode: 'create' | 'edit';
  onApply: (source: string) => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onPendingChangesChange?: (sessionId: number, pending: boolean) => void;
  onRequestConfirmation: (request: ConfirmationRequest) => Promise<boolean>;
};

const TABS: Array<{ id: WorkbenchTab; label: string; icon: typeof Sparkles }> = [
  { id: 'visual', label: '画布', icon: GitBranch },
  { id: 'templates', label: '模板', icon: LayoutTemplate },
  { id: 'ai', label: 'AI 辅助', icon: Sparkles },
  { id: 'source', label: '源码', icon: Braces },
];

const AI_EXAMPLES = [
  '生成一个包含成功、失败和重试分支的基本流程图',
  '生成软件系统的 4+1 架构视图，并写清每个视图的职责',
  '把当前图改成从左到右，精简节点文字并补全异常路径',
];

async function validateMermaid(source: string) {
  const safetyError = mermaidSafetyError(source);
  if (safetyError) throw new Error(safetyError);
  await parseMermaid(source);
}

function diagramKind(source: string): string {
  const firstLine = source.trim().split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (/^(?:flowchart|graph)\b/i.test(firstLine)) return '流程图';
  if (/^sequenceDiagram\b/i.test(firstLine)) return '时序图';
  if (/^stateDiagram/i.test(firstLine)) return '状态图';
  if (/^classDiagram\b/i.test(firstLine)) return '类图';
  if (/^erDiagram\b/i.test(firstLine)) return 'ER 图';
  if (/^mindmap\b/i.test(firstLine)) return '思维导图';
  if (/^gantt\b/i.test(firstLine)) return '甘特图';
  return 'Mermaid';
}

function safelyParseVisualSource(source: string): MermaidVisualGraph | null {
  try {
    if (mermaidSafetyError(source)) return null;
    return parseMermaidVisualSource(source);
  } catch {
    return null;
  }
}

function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches('input, textarea, select, [role="textbox"]')
    || target.isContentEditable;
}

export default function MermaidWorkbench({
  sessionId,
  config,
  initialSource = '',
  inactive = false,
  interactionSuspended = false,
  mode,
  onApply,
  onClose,
  onOpenSettings,
  onPendingChangesChange,
  onRequestConfirmation,
}: MermaidWorkbenchProps) {
  const startingSource = initialSource.trim() ? initialSource : MERMAID_TEMPLATES[0].source;
  const startingGraph = useMemo(() => safelyParseVisualSource(startingSource), [startingSource]);
  const [source, setSource] = useState(startingSource);
  const [graph, setGraph] = useState<MermaidVisualGraph | null>(startingGraph);
  const [tab, setTab] = useState<WorkbenchTab>('visual');
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialSource.trim() ? '' : MERMAID_TEMPLATES[0].id);
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiUseCurrentSource, setAiUseCurrentSource] = useState(mode === 'edit');
  const [aiStatus, setAiStatus] = useState<{ kind: 'idle' | 'running' | 'success' | 'error'; message: string }>({ kind: 'idle', message: '' });
  const [aiReasoning, setAiReasoning] = useState('');
  const [aiReasoningOpen, setAiReasoningOpen] = useState(true);
  const [aiPreviewEditing, setAiPreviewEditing] = useState(false);
  const [aiDraftValidation, setAiDraftValidation] = useState<AiDraftValidation>({ kind: 'checking', message: '等待校验当前草稿' });
  const [formError, setFormError] = useState('');
  const [applying, setApplying] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const aiOperationRef = useRef(0);
  const applyingRef = useRef(false);
  const applyOperationRef = useRef(0);
  const draftRevisionRef = useRef(0);
  const mountedRef = useRef(true);
  const closeRequestPendingRef = useRef(false);
  const configured = Boolean(config.apiKey && config.model);
  const aiRunning = aiStatus.kind === 'running';
  const draftChanged = source.trim() !== startingSource.trim();
  const hasPendingChanges = aiRunning || draftChanged || applying;

  useEffect(() => {
    onPendingChangesChange?.(sessionId, hasPendingChanges);
  }, [hasPendingChanges, onPendingChangesChange, sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      aiOperationRef.current += 1;
      applyOperationRef.current += 1;
      applyingRef.current = false;
      abortRef.current?.abort();
      onPendingChangesChange?.(sessionId, false);
    };
  }, [onPendingChangesChange, sessionId]);

  const discardAndClose = useCallback(() => {
    aiOperationRef.current += 1;
    applyOperationRef.current += 1;
    applyingRef.current = false;
    abortRef.current?.abort();
    onClose();
  }, [onClose]);

  const requestClose = useCallback(async () => {
    if (closeRequestPendingRef.current || inactive || interactionSuspended) return;
    const applyingNow = applyingRef.current;
    if (!hasPendingChanges && !applyingNow) {
      discardAndClose();
      return;
    }
    if (applyingNow) {
      applyOperationRef.current += 1;
      applyingRef.current = false;
      if (mountedRef.current) setApplying(false);
    }
    closeRequestPendingRef.current = true;
    try {
      const confirmed = await onRequestConfirmation({
        title: aiRunning
          ? '停止生成并关闭？'
          : applyingNow
            ? '停止应用并关闭？'
            : '放弃图表草稿？',
        message: aiRunning
          ? 'AI 仍在生成。继续后将停止生成，并丢弃尚未应用到文档的图表草稿。'
          : applyingNow
            ? '图表正在校验并应用。继续后将取消本次应用并关闭工作台。'
            : '当前图表的修改尚未应用到文档。放弃后，这些修改将无法恢复。',
        confirmLabel: aiRunning ? '停止并关闭' : applyingNow ? '取消应用并关闭' : '放弃草稿',
        cancelLabel: '继续编辑',
        destructive: true,
      });
      if (confirmed && mountedRef.current) discardAndClose();
    } finally {
      closeRequestPendingRef.current = false;
    }
  }, [aiRunning, discardAndClose, hasPendingChanges, inactive, interactionSuspended, onRequestConfirmation]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (inactive || interactionSuspended || event.key !== 'Escape' || event.defaultPrevented) return;
      if (isEditingTarget(event.target) || isEditingTarget(document.activeElement)) return;
      event.preventDefault();
      void requestClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inactive, interactionSuspended, requestClose]);

  useEffect(() => {
    if (tab !== 'ai' || aiRunning || !source.trim()) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void validateMermaid(source.trim())
        .then(() => {
          if (active) setAiDraftValidation({ kind: 'valid', message: 'Mermaid v11 语法有效，可应用或继续切换到画布' });
        })
        .catch((reason) => {
          if (!active) return;
          const message = reason instanceof Error ? reason.message.replace(/^Error:\s*/i, '').split('\n')[0] : 'Mermaid 语法校验失败';
          setAiDraftValidation({ kind: 'error', message });
        });
    }, 420);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [aiRunning, source, tab]);

  function invalidatePendingApplyForDraftChange() {
    draftRevisionRef.current += 1;
    applyOperationRef.current += 1;
    applyingRef.current = false;
    setApplying(false);
  }

  function invalidateActiveAiForDraftChange() {
    const activeController = abortRef.current;
    aiOperationRef.current += 1;
    activeController?.abort();
    abortRef.current = null;
    if (activeController) setAiStatus({ kind: 'idle', message: '已停止生成，保留当前草稿' });
  }

  function updateDraft(nextSource: string, templateId = '') {
    invalidateActiveAiForDraftChange();
    invalidatePendingApplyForDraftChange();
    setSource(nextSource);
    setGraph(safelyParseVisualSource(nextSource));
    setAiDraftValidation(nextSource.trim()
      ? { kind: 'checking', message: '正在校验 Mermaid v11 语法…' }
      : { kind: 'error', message: '图表源码不能为空' });
    setSelectedTemplateId(templateId);
    setAiUseCurrentSource(true);
    setFormError('');
  }

  function switchTab(nextTab: WorkbenchTab) {
    if (nextTab === 'visual') setGraph(safelyParseVisualSource(source));
    if (nextTab === 'ai' && !aiRunning) {
      setAiDraftValidation(source.trim()
        ? { kind: 'checking', message: '正在校验 Mermaid v11 语法…' }
        : { kind: 'error', message: '图表源码不能为空' });
    }
    setFormError('');
    setTab(nextTab);
  }

  function selectTemplate(templateId: string) {
    const template = MERMAID_TEMPLATES.find((candidate) => candidate.id === templateId);
    if (!template) return;
    updateDraft(template.source, template.id);
    setAiStatus({ kind: 'idle', message: '' });
    setAiReasoning('');
    setTab('visual');
  }

  function commitGraph(next: MermaidVisualGraph) {
    try {
      const nextSource = serializeMermaidVisualGraph(next);
      invalidateActiveAiForDraftChange();
      invalidatePendingApplyForDraftChange();
      setGraph(next);
      setSource(nextSource);
      setSelectedTemplateId('');
      setAiUseCurrentSource(true);
      setFormError('');
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '画布内容无法转换为 Mermaid 源码');
    }
  }

  async function runAi() {
    const instruction = aiInstruction.trim();
    if (!instruction) {
      setAiStatus({ kind: 'error', message: '请先描述希望生成或修改的图表' });
      return;
    }
    if (!configured) {
      setAiStatus({ kind: 'error', message: '请先连接模型，再使用 AI 生成' });
      onOpenSettings();
      return;
    }

    abortRef.current?.abort();
    const operation = ++aiOperationRef.current;
    if (applyingRef.current) invalidatePendingApplyForDraftChange();
    const controller = new AbortController();
    abortRef.current = controller;
    setAiPreviewEditing(false);
    setAiReasoning('');
    setAiReasoningOpen(true);
    setAiDraftValidation({ kind: 'idle', message: 'AI 生成中，完成后可继续手动编辑' });
    setAiStatus({ kind: 'running', message: 'AI 正在组织图表结构…' });
    const prompts = createMermaidAiPrompts(instruction, aiUseCurrentSource ? source : '');
    let generated = '';
    try {
      await streamAi(
        {
          provider: config.provider,
          baseUrl: config.baseUrl,
          model: config.model,
          apiKey: config.apiKey,
          system: prompts.system,
          prompt: prompts.prompt,
          temperature: 0.3,
          maxTokens: 4096,
        },
        {
          onContentDelta: (chunk) => {
            if (controller.signal.aborted || aiOperationRef.current !== operation) return;
            generated += chunk;
            setAiStatus({ kind: 'running', message: `正在生成 · 已接收 ${generated.length} 个字符` });
          },
          onReasoningDelta: (chunk) => {
            if (controller.signal.aborted || aiOperationRef.current !== operation) return;
            setAiReasoning((current) => current + chunk);
          },
        },
        controller.signal,
      );
      const nextSource = extractMermaidSource(generated);
      if (!nextSource) throw new Error('模型返回了空内容');
      await validateMermaid(nextSource);
      if (controller.signal.aborted || aiOperationRef.current !== operation) return;
      updateDraft(nextSource);
      setAiStatus({ kind: 'success', message: '图表草稿已生成，可继续编辑或应用到文档' });
    } catch (reason) {
      if (controller.signal.aborted || aiOperationRef.current !== operation) return;
      setAiDraftValidation(source.trim()
        ? { kind: 'checking', message: '正在重新校验当前草稿…' }
        : { kind: 'error', message: '图表源码不能为空' });
      setAiStatus({ kind: 'error', message: reason instanceof Error ? reason.message : '图表生成失败，请重试' });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function stopAi() {
    aiOperationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setAiDraftValidation(source.trim()
      ? { kind: 'checking', message: '正在重新校验当前草稿…' }
      : { kind: 'error', message: '图表源码不能为空' });
    setAiStatus({ kind: 'idle', message: '已停止生成，当前草稿保持不变' });
  }

  async function applySource() {
    if (applyingRef.current) return;
    const normalized = source.trim();
    const draftRevision = draftRevisionRef.current;
    const operation = ++applyOperationRef.current;
    applyingRef.current = true;
    setApplying(true);
    setFormError('');
    try {
      await validateMermaid(normalized);
      if (
        !mountedRef.current
        || applyOperationRef.current !== operation
        || draftRevisionRef.current !== draftRevision
      ) return;
      onApply(normalized);
    } catch (reason) {
      if (
        !mountedRef.current
        || applyOperationRef.current !== operation
        || draftRevisionRef.current !== draftRevision
      ) return;
      setFormError(reason instanceof Error ? reason.message.replace(/^Error:\s*/i, '').split('\n')[0] : 'Mermaid 语法校验失败');
    } finally {
      if (applyOperationRef.current === operation) {
        applyingRef.current = false;
        if (mountedRef.current) setApplying(false);
      }
    }
  }

  const sourceLines = source ? source.split(/\r?\n/).length : 0;

  return (
    <div className="modal-backdrop mermaid-workbench-backdrop" role="presentation" onMouseDown={(event) => {
      if (!inactive && !interactionSuspended && event.target === event.currentTarget) void requestClose();
    }}>
      <section className="mermaid-workbench" role="dialog" aria-modal="true" aria-labelledby="mermaid-workbench-title" inert={inactive || interactionSuspended}>
        <header className="workbench-header">
          <span className="workbench-heading-icon"><Workflow size={20} /></span>
          <div>
            <div className="workbench-title-row">
              <h2 id="mermaid-workbench-title">Mermaid 图表工作台</h2>
              <span>{mode === 'edit' ? '编辑当前图表' : '创建新图表'}</span>
            </div>
            <p>在画布上直接拖拽、改名和连线，AI、模板与源码作为辅助</p>
          </div>
          <button type="button" className="icon-button" onClick={() => void requestClose()} aria-label="关闭图表工作台"><X size={19} /></button>
        </header>

        <div className={`workbench-main${tab === 'visual' ? ' visual-mode' : ''}`}>
          <section className="workbench-controls">
            <nav className="workbench-tabs" aria-label="图表编辑方式">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => switchTab(id)}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </nav>

            <div className="workbench-control-scroll">
              {tab === 'ai' ? (
                <div className="workbench-ai-panel">
                  <div className="workbench-section-heading">
                    <span><Bot size={17} /></span>
                    <div><strong>用自然语言生成或修改</strong><small>AI 会基于右侧当前草稿生成完整 Mermaid 源码</small></div>
                  </div>
                  <label htmlFor="mermaid-ai-prompt">描述你想要的图</label>
                  <textarea
                    id="mermaid-ai-prompt"
                    rows={6}
                    value={aiInstruction}
                    onChange={(event) => setAiInstruction(event.target.value)}
                    disabled={aiRunning}
                    placeholder="例如：生成电商订单从创建、支付、履约到售后的完整流程，并标出超时和退款分支"
                  />
                  <label className="workbench-ai-context">
                    <input type="checkbox" checked={aiUseCurrentSource} onChange={(event) => setAiUseCurrentSource(event.target.checked)} disabled={aiRunning} />
                    <span>基于右侧当前草稿修改</span>
                    <small>{aiUseCurrentSource ? 'AI 会尽量保留未要求改变的内容' : 'AI 将从你的描述创建一张新图'}</small>
                  </label>
                  <div className="workbench-prompt-examples">
                    {AI_EXAMPLES.map((example) => <button key={example} type="button" onClick={() => setAiInstruction(example)} disabled={aiRunning}>{example}</button>)}
                  </div>
                  {aiStatus.message ? (
                    <div className={`workbench-ai-status ${aiStatus.kind}`} role="status">
                      {aiStatus.kind === 'running' ? <LoaderCircle size={15} /> : aiStatus.kind === 'error' ? <CircleAlert size={15} /> : aiStatus.kind === 'success' ? <Check size={15} /> : <Bot size={15} />}
                      <span>{aiStatus.message}</span>
                    </div>
                  ) : null}
                  {aiStatus.kind !== 'idle' || aiReasoning ? (
                    <section className={`workbench-ai-reasoning${aiReasoningOpen ? ' open' : ''}`}>
                      <button
                        type="button"
                        className="workbench-ai-reasoning-toggle"
                        onClick={() => setAiReasoningOpen((open) => !open)}
                        aria-expanded={aiReasoningOpen}
                      >
                        <BrainCircuit size={15} />
                        <span>
                          <strong>AI 思考过程</strong>
                          <small>{aiReasoning ? `已接收 ${aiReasoning.length} 个字符` : aiRunning ? '等待模型返回推理内容' : '模型未返回推理内容'}</small>
                        </span>
                        {aiRunning ? <LoaderCircle className="spinning" size={13} /> : aiReasoningOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                      {aiReasoningOpen ? (
                        <div className="workbench-ai-reasoning-content" aria-live="polite">
                          {aiReasoning
                            ? <pre>{aiReasoning}</pre>
                            : <p>{aiRunning ? '正在等待模型提供可展示的思考过程…' : '当前模型或接口没有返回可展示的思考过程。'}</p>}
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                  {!configured ? (
                    <button type="button" className="workbench-configure" onClick={onOpenSettings}>先连接模型</button>
                  ) : null}
                  {aiStatus.kind === 'running' ? (
                    <button type="button" className="workbench-ai-run secondary" onClick={stopAi}><X size={15} /> 停止生成</button>
                  ) : (
                    <button type="button" className="workbench-ai-run" onClick={() => void runAi()} disabled={!aiInstruction.trim()}><Sparkles size={15} /> 生成图表草稿</button>
                  )}
                  <p className="workbench-hint">生成结果只更新工作台草稿，不会直接覆盖文档。</p>
                </div>
              ) : null}

              {tab === 'templates' ? (
                <div className="workbench-template-panel">
                  <div className="workbench-section-heading compact">
                    <span><LayoutTemplate size={17} /></span>
                    <div><strong>从常用图表开始</strong><small>所有现有图种均可直接进入画布，也可继续用 AI 或源码调整</small></div>
                  </div>
                  <div className="workbench-template-grid">
                    {MERMAID_TEMPLATES.map((template) => (
                      <button key={template.id} type="button" className={selectedTemplateId === template.id ? 'active' : ''} onClick={() => selectTemplate(template.id)}>
                        <span><b>{template.name}</b><i>{template.category}</i></span>
                        <small>{template.description}</small>
                        <em>支持画布直接编辑</em>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="workbench-visual-panel" hidden={tab !== 'visual'}>
                {graph && tab === 'visual' ? (
                  <MermaidCanvasEditor
                    active={tab === 'visual' && !inactive}
                    suspended={interactionSuspended}
                    graph={graph}
                    onChange={commitGraph}
                  />
                ) : tab === 'visual' ? (
                  <section className="workbench-preview" style={{ height: '100%' }} aria-label="只读图表预览">
                    <header>
                      <div><CircleAlert size={14} /><strong>当前图表仅支持只读预览</strong><small>{diagramKind(source)}</small></div>
                      <span>当前源码无法安全转换，原始内容已完整保留</span>
                    </header>
                    <div className="workbench-preview-canvas">
                      {source.trim() ? <MermaidDiagram code={source} /> : <div className="workbench-preview-empty"><Workflow size={28} /><span>源码为空，请在源码页输入 Mermaid 图表</span></div>}
                    </div>
                  </section>
                ) : null}
              </div>

              {tab === 'source' ? (
                <div className="workbench-source-panel">
                  <div className="source-editor-heading"><div><strong>Mermaid 源码</strong><small>{sourceLines} 行 · 实时预览</small></div><button type="button" onClick={() => updateDraft(startingSource)}><RotateCcw size={13} /> 恢复打开时内容</button></div>
                  <textarea
                    value={source}
                    onChange={(event) => updateDraft(event.target.value)}
                    spellCheck={false}
                    aria-label="Mermaid 源码编辑器"
                  />
                  <p className="workbench-hint">支持 Mermaid v11 常规语法。为保证本地文档安全，保存时会拒绝 click、HTML 和初始化指令。</p>
                </div>
              ) : null}
            </div>
          </section>

          {tab !== 'visual' ? (
            <section className={`workbench-preview${tab === 'ai' && aiPreviewEditing ? ' workbench-ai-editing' : ''}`} aria-label={tab === 'ai' && aiPreviewEditing ? 'AI 图表草稿编辑器' : '图表草稿预览'}>
              <header>
                <div>
                  <span className="live-dot" />
                  <strong>{tab === 'ai' && aiPreviewEditing ? '手动编辑 AI 草稿' : '草稿预览'}</strong>
                  <small>{tab === 'ai' && aiPreviewEditing ? `${sourceLines} 行` : diagramKind(source)}</small>
                </div>
                {tab === 'ai' ? (
                  <div className="workbench-ai-preview-actions">
                    <span>{aiRunning ? '生成完成后可编辑' : aiPreviewEditing ? '编辑内容同步到当前草稿' : '修改实时呈现'}</span>
                    <button
                      type="button"
                      className="workbench-ai-mode-toggle"
                      onClick={() => setAiPreviewEditing((value) => !value)}
                      disabled={aiRunning}
                    >
                      {aiPreviewEditing ? <><Eye size={13} /> 返回预览</> : <><Pencil size={13} /> 手动编辑</>}
                    </button>
                  </div>
                ) : <span>修改实时呈现</span>}
              </header>
              <div className="workbench-preview-canvas">
                {tab === 'ai' && aiPreviewEditing ? (
                  <div className="workbench-ai-source-editor">
                    <div className="workbench-ai-editor-heading">
                      <div><strong>Mermaid 源码</strong><small>{sourceLines} 行 · 修改会直接更新当前草稿</small></div>
                      <span>切换到画布时继续编辑同一份内容</span>
                    </div>
                    <textarea
                      value={source}
                      onChange={(event) => updateDraft(event.target.value)}
                      disabled={aiRunning}
                      spellCheck={false}
                      aria-label="AI 生成结果源码编辑器"
                    />
                    <div className={`workbench-ai-validation ${aiDraftValidation.kind}`} role="status" aria-live="polite">
                      {aiDraftValidation.kind === 'checking' ? <LoaderCircle className="spinning" size={14} /> : aiDraftValidation.kind === 'valid' ? <Check size={14} /> : aiDraftValidation.kind === 'error' ? <CircleAlert size={14} /> : <Bot size={14} />}
                      <div><strong>{aiDraftValidation.kind === 'checking' ? '正在校验' : aiDraftValidation.kind === 'valid' ? '语法有效' : aiDraftValidation.kind === 'error' ? '需要修正' : '等待 AI'}</strong><small>{aiDraftValidation.message}</small></div>
                    </div>
                  </div>
                ) : source.trim() ? <MermaidDiagram code={source} /> : <div className="workbench-preview-empty"><Workflow size={28} /><span>输入源码后将在这里预览</span></div>}
              </div>
            </section>
          ) : null}
        </div>

        <footer className="workbench-footer">
          <div className={formError ? 'error' : ''}>{formError ? <><CircleAlert size={14} /> {formError}</> : <><Check size={14} /> 应用前会校验语法，文档不会被静默覆盖</>}</div>
          <button type="button" className="secondary-button" onClick={() => void requestClose()}>取消</button>
          <button type="button" className="confirm-button" onClick={() => void applySource()} disabled={applying || aiStatus.kind === 'running'}>{applying ? <LoaderCircle className="spinning" size={14} /> : <Check size={14} />} 应用到文档</button>
        </footer>
      </section>
    </div>
  );
}
