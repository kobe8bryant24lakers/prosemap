'use client';

import type { ReactNode } from 'react';

import { templateSource } from '@/lib/localized-content';
import { t, uiMessage } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';
import { useModalFocus } from '@/lib/use-modal-focus';

import {
  Bot,
  BrainCircuit,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Eye,
  FileText,
  GitBranch,
  LayoutTemplate,
  Maximize2,
  Minimize2,
  LoaderCircle,
  Pencil,
  Paperclip,
  RotateCcw,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { streamAi } from '@/lib/ai-client';
import { appendAiContext, MAX_AI_CONTEXT_CHARACTERS, type AiContextDocument } from '@/lib/ai-context';
import { useAiConversation } from '@/lib/use-ai-conversation';
import type { ModelConfig } from '@/lib/editor';
import { parseMermaid } from '@/lib/mermaid-runtime';
import { MermaidSourceHistory } from '@/lib/mermaid-source-preservation';
import {
  activateMermaidCanvasDraft,
  commitMermaidCanvasGraph,
  createMermaidCanvasSession,
  updateMermaidCanvasDraft,
} from '@/lib/mermaid-canvas-session';
import {
  MERMAID_TEMPLATES,
  createMermaidAiPrompts,
  extractMermaidSource,
  mermaidSafetyError,
  parseMermaidVisualSource,
  type MermaidVisualGraph,
} from '@/lib/mermaid-workbench';
import MermaidCanvasEditor from './MermaidCanvasEditor';
import MermaidDiagram from './MermaidDiagram';
import AiConversation from './AiConversation';
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
  modelSwitcher: ReactNode;
  initialSource?: string;
  inactive?: boolean;
  interactionSuspended?: boolean;
  contextDocuments: AiContextDocument[];
  contextPanel?: ReactNode;
  resolveContextDocuments?: () => Promise<AiContextDocument[]>;
  mode: 'create' | 'edit';
  onApply: (source: string) => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onPickContext: () => void;
  onRemoveContext: (path: string) => void;
  onPendingChangesChange?: (sessionId: number, pending: boolean) => void;
  onRequestConfirmation: (request: ConfirmationRequest) => Promise<boolean>;
};

const TABS: Array<{ id: WorkbenchTab; label: string; icon: typeof Sparkles }> = [
  { id: 'visual', get label() { return t("画布"); }, icon: GitBranch },
  { id: 'templates', get label() { return t("模板"); }, icon: LayoutTemplate },
  { id: 'ai', get label() { return t("AI 辅助"); }, icon: Sparkles },
  { id: 'source', get label() { return t("源码"); }, icon: Braces },
];

const AI_EXAMPLES = [
  '生成一个包含成功、失败和重试分支的基本流程图',
  '生成软件系统的 4+1 架构视图，并写清每个视图的职责',
  '生成订单系统的用例图，包含用户、管理员、系统边界及包含和扩展关系',
  '生成包含表现层、领域层和基础设施层的嵌套包结构图',
  '把当前图改成从左到右，精简节点文字并补全异常路径',
];

async function validateMermaid(source: string) {
  const safetyError = mermaidSafetyError(source);
  if (safetyError) throw new Error(safetyError);
  await parseMermaid(source);
}

function diagramKind(source: string): string {
  if (/^\s*%% prosemap:usecase\s*$/m.test(source)) return t("用例图");
  if (/^\s*%% prosemap:package\s*$/m.test(source)) return t("包结构图");
  const firstLine = source.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith('%%'))?.trim() ?? '';
  if (/^(?:flowchart|graph)\b/i.test(firstLine)) return t("流程图");
  if (/^sequenceDiagram\b/i.test(firstLine)) return t("时序图");
  if (/^stateDiagram/i.test(firstLine)) return t("状态图");
  if (/^classDiagram\b/i.test(firstLine)) return t("类图");
  if (/^erDiagram\b/i.test(firstLine)) return t("ER 图");
  if (/^mindmap\b/i.test(firstLine)) return t("思维导图");
  if (/^gantt\b/i.test(firstLine)) return t("甘特图");
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
  modelSwitcher,
  initialSource = '',
  inactive = false,
  interactionSuspended = false,
  contextDocuments,
  contextPanel,
  resolveContextDocuments,
  mode,
  onApply,
  onClose,
  onOpenSettings,
  onPickContext,
  onRemoveContext,
  onPendingChangesChange,
  onRequestConfirmation,
}: MermaidWorkbenchProps) {
  useLocale();
  const [startingSource] = useState(() => initialSource.trim() ? initialSource : templateSource(MERMAID_TEMPLATES[0]));
  const startingGraph = useMemo(() => safelyParseVisualSource(startingSource), [startingSource]);
  const [source, setSource] = useState(startingSource);
  const [sourceHistory] = useState(() => new MermaidSourceHistory());
  const canvasSourceRef = useRef(startingSource);
  const [canvasSession, setCanvasSession] = useState(() => createMermaidCanvasSession(startingGraph));
  const { graph, canvasGraph, externalRevision } = canvasSession;
  const [expanded, setExpanded] = useState(false);
  const [canvasRevision, setCanvasRevision] = useState(0);
  const [tab, setTab] = useState<WorkbenchTab>('visual');
  const tabRef = useRef<WorkbenchTab>('visual');
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialSource.trim() ? '' : MERMAID_TEMPLATES[0].id);
  const [aiInstruction, setAiInstruction] = useState('');
  const conversation = useAiConversation();
  const [aiRequestNotice, setAiRequestNotice] = useState<{ omittedTurns: number; contextCharacters: number; contextTruncated: boolean } | null>(null);
  const [aiUseCurrentSource, setAiUseCurrentSource] = useState(mode === 'edit');
  const [aiStatus, setAiStatus] = useState<{ kind: 'idle' | 'running' | 'success' | 'error'; message: string }>({ kind: 'idle', message: '' });
  const [aiReasoning, setAiReasoning] = useState('');
  const [aiCompressionFailed, setAiCompressionFailed] = useState(false);
  const [aiReasoningOpen, setAiReasoningOpen] = useState(true);
  const [aiPreviewEditing, setAiPreviewEditing] = useState(false);
  const [aiDraftValidation, setAiDraftValidation] = useState<AiDraftValidation>({ kind: 'checking', message: t("等待校验当前草稿") });
  const [formError, setFormError] = useState('');
  const [applying, setApplying] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const aiOperationRef = useRef(0);
  const applyingRef = useRef(false);
  const applyOperationRef = useRef(0);
  const draftRevisionRef = useRef(0);
  const mountedRef = useRef(true);
  const closeRequestPendingRef = useRef(false);
  const templateRequestPendingRef = useRef(false);
  const configured = Boolean(config.apiKey && config.model);
  const aiRunning = aiStatus.kind === 'running';
  const draftChanged = source !== startingSource;
  const hasPendingChanges = aiRunning || draftChanged || applying;
  const contextCharacters = contextDocuments.reduce((total, document) => total + document.content.length, 0);

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
          ? t("停止生成并关闭？")
          : applyingNow
            ? t("停止应用并关闭？")
            : t("放弃图表草稿？"),
        message: aiRunning
          ? t("AI 仍在生成。继续后将停止生成，并丢弃尚未应用到文档的图表草稿。")
          : applyingNow
            ? t("图表正在校验并应用。继续后将取消本次应用并关闭工作台。")
            : t("当前图表的修改尚未应用到文档。放弃后，这些修改将无法恢复。"),
        confirmLabel: aiRunning ? t("停止并关闭") : applyingNow ? t("取消应用并关闭") : t("放弃草稿"),
        cancelLabel: t("继续编辑"),
        destructive: true,
      });
      if (confirmed && mountedRef.current) discardAndClose();
    } finally {
      closeRequestPendingRef.current = false;
    }
  }, [aiRunning, discardAndClose, hasPendingChanges, inactive, interactionSuspended, onRequestConfirmation]);

  // Keep canvas autofocus and let its inline editors consume Escape before closing.
  const dialogRef = useModalFocus(
    () => { void requestClose(); },
    () => document.querySelector<HTMLElement>('.cm-content'),
    { captureEscape: false, preserveInitialFocus: true },
  );

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
          if (active) setAiDraftValidation({ kind: 'valid', message: t("Mermaid v11 语法有效，可应用或继续切换到画布") });
        })
        .catch((reason) => {
          if (!active) return;
          const message = reason instanceof Error ? reason.message.replace(/^Error:\s*/i, '').split('\n')[0] : t("Mermaid 语法校验失败");
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
    if (activeController) setAiStatus({ kind: 'idle', message: t("已停止生成，保留当前草稿") });
  }

  function updateDraft(nextSource: string, templateId = '') {
    invalidateActiveAiForDraftChange();
    invalidatePendingApplyForDraftChange();
    setSource(nextSource);
    const nextGraph = safelyParseVisualSource(nextSource);
    const publish = Boolean(templateId) || tabRef.current === 'visual';
    const changedSource = Boolean(nextGraph) && nextSource !== canvasSourceRef.current;
    if (publish && changedSource) {
      sourceHistory.reset(nextGraph, nextSource);
      canvasSourceRef.current = nextSource;
    }
    setCanvasSession((current) => {
      if (templateId) return createMermaidCanvasSession(nextGraph);
      const draft = updateMermaidCanvasDraft(current, nextGraph);
      if (!publish) return draft;
      const next = activateMermaidCanvasDraft(draft);
      return changedSource && next.externalRevision === current.externalRevision
        ? { ...next, externalRevision: next.externalRevision + 1 }
        : next;
    });
    setAiDraftValidation(nextSource.trim()
      ? { kind: 'checking', message: t("正在校验 Mermaid v11 语法…") }
      : { kind: 'error', message: t("图表源码不能为空") });
    setSelectedTemplateId(templateId);
    setAiUseCurrentSource(true);
    setFormError('');
  }

  function switchTab(nextTab: WorkbenchTab) {
    tabRef.current = nextTab;
    if (nextTab === 'visual') {
      // Publish one history boundary when returning from an external edit,
      // including spelling/whitespace changes that parse to the same graph.
      // Temporarily invalid drafts and edits restored to the original bytes
      // leave the mounted canvas and its history intact.
      const changedSource = Boolean(canvasSession.graph) && source !== canvasSourceRef.current;
      if (changedSource) sourceHistory.reset(canvasSession.graph, source);
      else sourceHistory.remember(canvasSession.graph, source);
      if (canvasSession.graph) canvasSourceRef.current = source;
      setCanvasSession((current) => {
        const next = activateMermaidCanvasDraft(current);
        return changedSource && next.externalRevision === current.externalRevision
          ? { ...next, externalRevision: next.externalRevision + 1 }
          : next;
      });
    }
    if (nextTab === 'ai' && !aiRunning) {
      setAiDraftValidation(source.trim()
        ? { kind: 'checking', message: t("正在校验 Mermaid v11 语法…") }
        : { kind: 'error', message: t("图表源码不能为空") });
    }
    setFormError('');
    setTab(nextTab);
  }

  async function selectTemplate(templateId: string) {
    if (inactive || interactionSuspended || templateRequestPendingRef.current) return;
    const template = MERMAID_TEMPLATES.find((candidate) => candidate.id === templateId);
    if (!template) return;
    const nextSource = templateSource(template);
    if (nextSource === source && !aiRunning && !applyingRef.current) {
      switchTab('visual');
      return;
    }
    if (draftChanged || aiRunning || applyingRef.current) {
      const revision = draftRevisionRef.current;
      templateRequestPendingRef.current = true;
      try {
        const confirmed = await onRequestConfirmation({
          title: t("用模板替换当前草稿？"),
          message: aiRunning || applyingRef.current
            ? t("替换会停止正在进行的生成或应用，并丢弃当前草稿、画布布局和历史。文档内容保持不变。")
            : t("尚未应用的修改将被模板替换，画布布局和历史也会重置。文档内容保持不变。"),
          confirmLabel: t("替换草稿"),
          cancelLabel: t("保留草稿"),
          destructive: true,
        });
        if (!confirmed || !mountedRef.current) return;
        // AI can complete while the confirmation is open. The user confirmed
        // replacing the earlier draft, not a result that arrived afterwards.
        if (draftRevisionRef.current !== revision) {
          setFormError(t("草稿已更新，请重新选择模板。"));
          return;
        }
      } finally {
        templateRequestPendingRef.current = false;
      }
    }
    setCanvasRevision((revision) => revision + 1);
    updateDraft(nextSource, template.id);
    conversation.reset();
    setAiCompressionFailed(false);
    setAiRequestNotice(null);
    setAiStatus({ kind: 'idle', message: '' });
    setAiReasoning('');
    tabRef.current = 'visual';
    setTab('visual');
  }

  function commitGraph(next: MermaidVisualGraph, editBase?: MermaidVisualGraph) {
    try {
      const nextSource = sourceHistory.commit(source, canvasGraph, next, editBase);
      canvasSourceRef.current = nextSource;
      invalidateActiveAiForDraftChange();
      invalidatePendingApplyForDraftChange();
      setCanvasSession((current) => commitMermaidCanvasGraph(current, next));
      setSource(nextSource);
      setSelectedTemplateId('');
      setAiUseCurrentSource(true);
      setFormError('');
      return true;
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : t("画布内容无法转换为 Mermaid 源码"));
      return false;
    }
  }

  async function runAi() {
    const instruction = aiInstruction.trim();
    if (!instruction) {
      setAiStatus({ kind: 'error', message: t("请先描述希望生成或修改的图表") });
      return;
    }
    if (!configured) {
      setAiStatus({ kind: 'error', message: t("请先连接模型，再使用 AI 生成") });
      onOpenSettings();
      return;
    }

    abortRef.current?.abort();
    const operation = ++aiOperationRef.current;
    if (applyingRef.current) invalidatePendingApplyForDraftChange();
    const controller = new AbortController();
    abortRef.current = controller;
    setAiPreviewEditing(false);
    setAiCompressionFailed(false);
    setAiRequestNotice(null);
    setAiReasoning('');
    setAiReasoningOpen(true);
    setAiDraftValidation({ kind: 'idle', message: t("AI 生成中，完成后可继续手动编辑") });
    setAiStatus({ kind: 'running', message: t("AI 正在组织图表结构…") });
    const prompts = createMermaidAiPrompts(instruction, aiUseCurrentSource ? source : '');
    let generated = '';
    let compressing = false;
    try {
      const references = resolveContextDocuments ? await resolveContextDocuments() : contextDocuments;
      if (controller.signal.aborted || aiOperationRef.current !== operation) return;
      const { prompt, context } = appendAiContext(prompts.prompt, references);
      const system = `${prompts.system}\n历史输出可能尚未应用或已被人工修改。以最新用户消息提供的当前草稿为编辑依据，同时延续历史中仍然适用的要求。`;
      const history = await conversation.prepare(
        config,
        Math.max(0, 140_000 - system.length - prompt.length),
        controller.signal,
        ({ completed, total }) => {
          if (controller.signal.aborted || aiOperationRef.current !== operation) return;
          compressing = true;
          setAiStatus({ kind: 'running', message: t('正在压缩对话上下文…（{0}/{1}）', Math.min(completed + 1, total), total) });
        },
        () => mountedRef.current && aiOperationRef.current === operation,
      );
      if (controller.signal.aborted || aiOperationRef.current !== operation) return;
      compressing = false;
      setAiStatus({ kind: 'running', message: t("AI 正在组织图表结构…") });
      setAiRequestNotice(history.omittedTurns || context.omittedCharacters ? {
        omittedTurns: history.omittedTurns,
        contextCharacters: context.includedCharacters,
        contextTruncated: context.omittedCharacters > 0,
      } : null);
      await streamAi(
        {
          provider: config.provider,
          baseUrl: config.baseUrl,
          model: config.model,
          apiKey: config.apiKey,
          system,
          prompt,
          history: history.messages,
          temperature: 0.3,
          maxTokens: 4096,
        },
        {
          onContentDelta: (chunk) => {
            if (controller.signal.aborted || aiOperationRef.current !== operation) return;
            generated += chunk;
            setAiStatus({ kind: 'running', message: t("正在生成 · 已接收 {0} 个字符", generated.length) });
          },
          onReasoningDelta: (chunk) => {
            if (controller.signal.aborted || aiOperationRef.current !== operation) return;
            setAiReasoning((current) => current + chunk);
          },
        },
        controller.signal,
      );
      const nextSource = extractMermaidSource(generated);
      if (!nextSource) throw new Error(t("模型返回了空内容"));
      await validateMermaid(nextSource);
      if (controller.signal.aborted || aiOperationRef.current !== operation) return;
      updateDraft(nextSource);
      conversation.append({
        id: crypto.randomUUID(), instruction, output: nextSource, status: 'proposed',
      });
      setAiStatus({ kind: 'success', message: t("图表草稿已生成，可继续编辑或应用到文档") });
    } catch (reason) {
      if (controller.signal.aborted || aiOperationRef.current !== operation) return;
      setAiCompressionFailed(compressing);
      setAiDraftValidation(source.trim()
        ? { kind: 'checking', message: t("正在重新校验当前草稿…") }
        : { kind: 'error', message: t("图表源码不能为空") });
      const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
      setAiStatus({ kind: 'error', message: message.trim() || t("图表生成失败，请重试") });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function stopAi() {
    setAiCompressionFailed(false);
    aiOperationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setAiDraftValidation(source.trim()
      ? { kind: 'checking', message: t("正在重新校验当前草稿…") }
      : { kind: 'error', message: t("图表源码不能为空") });
    setAiStatus({ kind: 'idle', message: t("已停止生成，当前草稿保持不变") });
  }

  async function applySource() {
    if (applyingRef.current || (tab === 'visual' && formError)) return;
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
      onApply(source);
    } catch (reason) {
      if (
        !mountedRef.current
        || applyOperationRef.current !== operation
        || draftRevisionRef.current !== draftRevision
      ) return;
      setFormError(reason instanceof Error ? reason.message.replace(/^Error:\s*/i, '').split('\n')[0] : t("Mermaid 语法校验失败"));
    } finally {
      if (applyOperationRef.current === operation) {
        applyingRef.current = false;
        if (mountedRef.current) setApplying(false);
      }
    }
  }

  const sourceLines = source ? source.split(/\r?\n/).length : 0;

  return (
    <div className={`modal-backdrop mermaid-workbench-backdrop${expanded ? ' is-expanded' : ''}`} role="presentation" onMouseDown={(event) => {
      if (!inactive && !interactionSuspended && event.target === event.currentTarget) {
        // The default mouse focus change runs after a confirmation takes focus.
        event.preventDefault();
        void requestClose();
      }
    }}>
      <section ref={dialogRef} className="mermaid-workbench" role="dialog" aria-modal="true" aria-labelledby="mermaid-workbench-title" tabIndex={-1} inert={inactive || interactionSuspended}>
        <header className="workbench-header">
          <span className="workbench-heading-icon"><Workflow size={20} /></span>
          <div>
            <div className="workbench-title-row">
              <h2 id="mermaid-workbench-title">{t("Mermaid 图表工作台")}</h2>
              <span>{mode === 'edit' ? t("编辑当前图表") : t("创建新图表")}</span>
            </div>
            <p>{t("在画布上直接拖拽、改名和连线，AI、模板与源码作为辅助")}</p>
          </div>
          <div className="workbench-window-actions">
            <button type="button" className="icon-button" onClick={() => setExpanded((value) => !value)} aria-pressed={expanded} aria-label={expanded ? t('还原窗口') : t('全屏编辑')} title={expanded ? t('还原窗口') : t('全屏编辑')}>
              {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          <button type="button" className="icon-button" onClick={() => void requestClose()} aria-label={t("关闭图表工作台")}><X size={19} /></button>
          </div>
        </header>

        <div className={`workbench-main${tab === 'visual' ? ' visual-mode' : ''}`}>
          <section className="workbench-controls">
            <nav className="workbench-tabs" aria-label={t("图表编辑方式")}>
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
                    <div><strong>{t("用自然语言生成或修改")}</strong><small>{t("AI 会基于右侧当前草稿生成完整 Mermaid 源码")}</small></div>
                  </div>
                  <AiConversation
                    turns={conversation.turns}
                    memory={conversation.memory}
                    onReset={() => {
                      conversation.reset();
                      setAiCompressionFailed(false);
                      setAiRequestNotice(null);
                      setAiStatus({ kind: 'idle', message: '' });
                      setAiReasoning('');
                    }}
                    disabled={aiRunning || applying}
                  />
                  {aiRequestNotice ? <div className="workbench-request-notice" role="status">
                    {aiRequestNotice.omittedTurns ? <div>{t('本次请求省略了 {0} 轮对话。', aiRequestNotice.omittedTurns)}</div> : null}
                    {aiRequestNotice.contextTruncated ? <div>{t('参考资料已截断，本次包含 {0} 个字符。', aiRequestNotice.contextCharacters.toLocaleString())}</div> : null}
                  </div> : null}
                  <label htmlFor="mermaid-ai-prompt">{t("描述你想要的图")}</label>
                  <textarea
                    id="mermaid-ai-prompt"
                    rows={6}
                    value={aiInstruction}
                    onChange={(event) => setAiInstruction(event.target.value)}
                    disabled={aiRunning}
                    placeholder={t("例如：生成电商订单从创建、支付、履约到售后的完整流程，并标出超时和退款分支")}
                  />
                  <label className="workbench-ai-context">
                    <input type="checkbox" checked={aiUseCurrentSource} onChange={(event) => setAiUseCurrentSource(event.target.checked)} disabled={aiRunning} />
                    <span>{t("基于右侧当前草稿修改")}</span>
                    <small>{aiUseCurrentSource ? t("AI 会尽量保留未要求改变的内容") : t("AI 将从你的描述创建一张新图")}</small>
                  </label>
                  {contextPanel ? <fieldset className="workbench-context-slot" disabled={aiRunning}>{contextPanel}</fieldset> : <section className="workbench-context-files" aria-label={t("Mermaid AI 上下文资料")}>
                    <header>
                      <span><Paperclip size={13} />  {t("上下文资料")}</span>
                      <button type="button" onClick={onPickContext} disabled={aiRunning}><Paperclip size={12} />  {t("添加文件")}</button>
                    </header>
                    {contextDocuments.length ? (
                      <div>
                        {contextDocuments.map((document) => (
                          <span key={document.path} title={document.path}>
                            <FileText size={11} /> <b>{document.name}</b>
                            <button type="button" onClick={() => onRemoveContext(document.path)} disabled={aiRunning} aria-label={t("移除上下文 {0}", document.name)}><X size={11} /></button>
                          </span>
                        ))}
                      </div>
                    ) : <p>{t("加入需求、接口、代码或其他图表资料，AI 会据此补全参与者、节点和关系。")}</p>}
                    <footer className={contextCharacters > MAX_AI_CONTEXT_CHARACTERS ? 'truncated' : ''}>
                      {contextDocuments.length
                        ? t("{0} 个文件 · {1} 字符{2}", contextDocuments.length, contextCharacters.toLocaleString('zh-CN'), contextCharacters > MAX_AI_CONTEXT_CHARACTERS ? t(" · 截取前 {0}", MAX_AI_CONTEXT_CHARACTERS.toLocaleString('zh-CN')) : '')
                        : t("资料只作为参考，不会被修改")}
                    </footer>
                  </section>}
                  <div className="workbench-prompt-examples">
                    {AI_EXAMPLES.map((example) => <button key={example} type="button" onClick={() => setAiInstruction(t(example))} disabled={aiRunning}>{t(example)}</button>)}
                  </div>
                  {aiStatus.message ? (
                    <div className={`workbench-ai-status ${aiStatus.kind}`} role="status">
                      {aiStatus.kind === 'running' ? <LoaderCircle size={15} /> : aiStatus.kind === 'error' ? <CircleAlert size={15} /> : aiStatus.kind === 'success' ? <Check size={15} /> : <Bot size={15} />}
                      <span>{uiMessage(aiStatus.message)}</span>
                    </div>
                  ) : null}
                  {aiCompressionFailed ? <p className="workbench-request-notice">{t('压缩未完成，原始对话已保留，文档没有被修改。')}</p> : null}
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
                          <strong>{t("AI 思考过程")}</strong>
                          <small>{aiReasoning ? t("已接收 {0} 个字符", aiReasoning.length) : aiRunning ? t("等待模型返回推理内容") : t("模型未返回推理内容")}</small>
                        </span>
                        {aiRunning ? <LoaderCircle className="spinning" size={13} /> : aiReasoningOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                      {aiReasoningOpen ? (
                        <div className="workbench-ai-reasoning-content" aria-live="polite">
                          {aiReasoning
                            ? <pre>{aiReasoning}</pre>
                            : <p>{aiRunning ? t("正在等待模型提供可展示的思考过程…") : t("当前模型或接口没有返回可展示的思考过程。")}</p>}
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                  {modelSwitcher}
                  {!configured ? (
                    <button type="button" className="workbench-configure" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onOpenSettings(); }}>{t("先连接模型")}</button>
                  ) : null}
                  {aiStatus.kind === 'running' ? (
                    <button type="button" className="workbench-ai-run secondary" onClick={stopAi}><X size={15} />  {t("停止生成")}</button>
                  ) : (
                    <button type="button" className="workbench-ai-run" onClick={() => void runAi()} disabled={!aiInstruction.trim()}><Sparkles size={15} />  {t("生成图表草稿")}</button>
                  )}
                  <p className="workbench-hint">{t("生成结果只更新工作台草稿，不会直接覆盖文档。")}</p>
                </div>
              ) : null}

              {tab === 'templates' ? (
                <div className="workbench-template-panel">
                  <div className="workbench-section-heading compact">
                    <span><LayoutTemplate size={17} /></span>
                    <div><strong>{t("从常用图表开始")}</strong><small>{t("所有现有图种均可直接进入画布，也可继续用 AI 或源码调整")}</small></div>
                  </div>
                  <div className="workbench-template-grid">
                    {MERMAID_TEMPLATES.map((template) => (
                      <button key={template.id} type="button" className={selectedTemplateId === template.id ? 'active' : ''} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); void selectTemplate(template.id); }}>
                        <span><b>{t(template.name)}</b><i>{t(template.category)}</i></span>
                        <small>{t(template.description)}</small>
                        <em>{t("支持画布直接编辑")}</em>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="workbench-visual-panel" hidden={tab !== 'visual'}>
                {canvasGraph ? (
                  <div hidden={!graph} style={{ height: '100%' }}>
                    <MermaidCanvasEditor
                      key={canvasRevision}
                      active={tab === 'visual' && Boolean(graph) && !inactive}
                      suspended={interactionSuspended}
                      graph={canvasGraph}
                      externalRevision={externalRevision}
                      onChange={commitGraph}
                    />
                  </div>
                ) : null}
                {!graph && tab === 'visual' ? (
                  <section className="workbench-preview" style={{ height: '100%' }} aria-label={t("只读图表预览")}>
                    <header>
                      <div><CircleAlert size={14} /><strong>{t("当前图表仅支持只读预览")}</strong><small>{diagramKind(source)}</small></div>
                      <span>{t("包含尚未支持的画布结构；原始内容已完整保留，可在“源码”页继续编辑")}</span>
                    </header>
                    <div className="workbench-preview-canvas">
                      {source.trim() ? <MermaidDiagram code={source} /> : <div className="workbench-preview-empty"><Workflow size={28} /><span>{t("源码为空，请在源码页输入 Mermaid 图表")}</span></div>}
                    </div>
                  </section>
                ) : null}
              </div>

              {tab === 'source' ? (
                <div className="workbench-source-panel">
                  <div className="source-editor-heading"><div><strong>{t("Mermaid 源码")}</strong><small>{sourceLines}  {t("行 · 实时预览")}</small></div><button type="button" onClick={() => updateDraft(startingSource)}><RotateCcw size={13} />  {t("恢复打开时内容")}</button></div>
                  <textarea
                    value={source}
                    onChange={(event) => updateDraft(event.target.value)}
                    spellCheck={false}
                    aria-label={t("Mermaid 源码编辑器")}
                  />
                  <p className="workbench-hint">{t("支持 Mermaid v11 常规语法及不带属性的 <br> 换行。保存时会拒绝其他 HTML、click 和初始化指令。")}</p>
                </div>
              ) : null}
            </div>
          </section>

          {tab !== 'visual' ? (
            <section className={`workbench-preview${tab === 'ai' && aiPreviewEditing ? ' workbench-ai-editing' : ''}`} aria-label={tab === 'ai' && aiPreviewEditing ? t("AI 图表草稿编辑器") : t("图表草稿预览")}>
              <header>
                <div>
                  <span className="live-dot" />
                  <strong>{tab === 'ai' && aiPreviewEditing ? t("手动编辑 AI 草稿") : t("草稿预览")}</strong>
                  <small>{tab === 'ai' && aiPreviewEditing ? t("{0} 行", sourceLines) : diagramKind(source)}</small>
                </div>
                {tab === 'ai' ? (
                  <div className="workbench-ai-preview-actions">
                    <span>{aiRunning ? t("生成完成后可编辑") : aiPreviewEditing ? t("编辑内容同步到当前草稿") : t("修改实时呈现")}</span>
                    <button
                      type="button"
                      className="workbench-ai-mode-toggle"
                      onClick={() => setAiPreviewEditing((value) => !value)}
                      disabled={aiRunning}
                    >
                      {aiPreviewEditing ? <><Eye size={13} />  {t("返回预览")}</> : <><Pencil size={13} />  {t("手动编辑")}</>}
                    </button>
                  </div>
                ) : <span>{t("修改实时呈现")}</span>}
              </header>
              <div className="workbench-preview-canvas">
                {tab === 'ai' && aiPreviewEditing ? (
                  <div className="workbench-ai-source-editor">
                    <div className="workbench-ai-editor-heading">
                      <div><strong>{t("Mermaid 源码")}</strong><small>{sourceLines}  {t("行 · 修改会直接更新当前草稿")}</small></div>
                      <span>{t("切换到画布时继续编辑同一份内容")}</span>
                    </div>
                    <textarea
                      value={source}
                      onChange={(event) => updateDraft(event.target.value)}
                      disabled={aiRunning}
                      spellCheck={false}
                      aria-label={t("AI 生成结果源码编辑器")}
                    />
                    <div className={`workbench-ai-validation ${aiDraftValidation.kind}`} role="status" aria-live="polite">
                      {aiDraftValidation.kind === 'checking' ? <LoaderCircle className="spinning" size={14} /> : aiDraftValidation.kind === 'valid' ? <Check size={14} /> : aiDraftValidation.kind === 'error' ? <CircleAlert size={14} /> : <Bot size={14} />}
                      <div><strong>{aiDraftValidation.kind === 'checking' ? t("正在校验") : aiDraftValidation.kind === 'valid' ? t("语法有效") : aiDraftValidation.kind === 'error' ? t("需要修正") : t("等待 AI")}</strong><small>{uiMessage(aiDraftValidation.message)}</small></div>
                    </div>
                  </div>
                ) : source.trim() ? <MermaidDiagram code={source} /> : <div className="workbench-preview-empty"><Workflow size={28} /><span>{t("输入源码后将在这里预览")}</span></div>}
              </div>
            </section>
          ) : null}
        </div>

        <footer className="workbench-footer">
          <div className={formError ? 'error' : ''}>{formError ? <><CircleAlert size={14} /> {uiMessage(formError)}</> : <><Check size={14} />  {t("应用前会校验语法，文档不会被静默覆盖")}</>}</div>
          <button type="button" className="secondary-button" onClick={() => void requestClose()}>{t("取消")}</button>
          <button type="button" className="confirm-button" onClick={() => void applySource()} disabled={applying || aiStatus.kind === 'running' || (tab === 'visual' && !!formError)}>{applying ? <LoaderCircle className="spinning" size={14} /> : <Check size={14} />}  {t("应用到文档")}</button>
        </footer>
      </section>
    </div>
  );
}
