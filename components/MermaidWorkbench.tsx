'use client';

import {
  Bot,
  Braces,
  Check,
  CircleAlert,
  GitBranch,
  LayoutTemplate,
  LoaderCircle,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { streamAi } from '@/lib/ai-client';
import type { ModelConfig } from '@/lib/editor';
import {
  MERMAID_TEMPLATES,
  createMermaidAiPrompts,
  extractMermaidSource,
  mermaidSafetyError,
  nextMermaidNodeId,
  parseFlowchartSource,
  serializeFlowchart,
  type MermaidEdgeStyle,
  type MermaidFlowDirection,
  type MermaidFlowGraph,
  type MermaidNodeShape,
} from '@/lib/mermaid-workbench';
import MermaidDiagram from './MermaidDiagram';
import './MermaidWorkbench.css';

type WorkbenchTab = 'ai' | 'templates' | 'visual' | 'source';

type MermaidWorkbenchProps = {
  config: ModelConfig;
  initialSource?: string;
  inactive?: boolean;
  mode: 'create' | 'edit';
  onApply: (source: string) => void;
  onClose: () => void;
  onOpenSettings: () => void;
};

const TABS: Array<{ id: WorkbenchTab; label: string; icon: typeof Sparkles }> = [
  { id: 'ai', label: 'AI 生成', icon: Sparkles },
  { id: 'templates', label: '模板', icon: LayoutTemplate },
  { id: 'visual', label: '可视化编辑', icon: GitBranch },
  { id: 'source', label: '源码', icon: Braces },
];

const NODE_SHAPES: Array<{ value: MermaidNodeShape; label: string }> = [
  { value: 'rectangle', label: '矩形' },
  { value: 'rounded', label: '圆角' },
  { value: 'terminal', label: '开始 / 结束' },
  { value: 'decision', label: '判断分支' },
  { value: 'circle', label: '圆形' },
  { value: 'database', label: '数据库' },
];

const EDGE_STYLES: Array<{ value: MermaidEdgeStyle; label: string }> = [
  { value: 'arrow', label: '实线箭头' },
  { value: 'line', label: '无箭头' },
  { value: 'dotted', label: '虚线箭头' },
  { value: 'thick', label: '强调箭头' },
];

const AI_EXAMPLES = [
  '生成一个包含成功、失败和重试分支的基本流程图',
  '生成软件系统的 4+1 架构视图，并写清每个视图的职责',
  '把当前图改成从左到右，精简节点文字并补全异常路径',
];

async function validateMermaid(source: string) {
  const safetyError = mermaidSafetyError(source);
  if (safetyError) throw new Error(safetyError);
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
  await mermaid.parse(source);
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

export default function MermaidWorkbench({ config, initialSource = '', inactive = false, mode, onApply, onClose, onOpenSettings }: MermaidWorkbenchProps) {
  const startingSource = initialSource.trim() || MERMAID_TEMPLATES[0].source;
  const startingGraph = useMemo(() => parseFlowchartSource(startingSource), [startingSource]);
  const [source, setSource] = useState(startingSource);
  const [graph, setGraph] = useState<MermaidFlowGraph | null>(startingGraph);
  const [tab, setTab] = useState<WorkbenchTab>(initialSource.trim() ? (startingGraph ? 'visual' : 'source') : 'templates');
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialSource.trim() ? '' : MERMAID_TEMPLATES[0].id);
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiUseCurrentSource, setAiUseCurrentSource] = useState(mode === 'edit');
  const [aiStatus, setAiStatus] = useState<{ kind: 'idle' | 'running' | 'success' | 'error'; message: string }>({ kind: 'idle', message: '' });
  const [formError, setFormError] = useState('');
  const [applying, setApplying] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const configured = Boolean(config.apiKey && config.model);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (inactive || event.key !== 'Escape') return;
      event.preventDefault();
      abortRef.current?.abort();
      onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inactive, onClose]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function switchTab(nextTab: WorkbenchTab) {
    if (nextTab === 'visual') setGraph(parseFlowchartSource(source));
    setFormError('');
    setTab(nextTab);
  }

  function selectTemplate(templateId: string) {
    const template = MERMAID_TEMPLATES.find((candidate) => candidate.id === templateId);
    if (!template) return;
    setSelectedTemplateId(template.id);
    setSource(template.source);
    setGraph(parseFlowchartSource(template.source));
    setAiUseCurrentSource(true);
    setAiStatus({ kind: 'idle', message: '' });
    setFormError('');
  }

  function commitGraph(next: MermaidFlowGraph) {
    setGraph(next);
    setSource(serializeFlowchart(next));
    setSelectedTemplateId('');
    setAiUseCurrentSource(true);
    setFormError('');
  }

  function addNode() {
    if (!graph) return;
    const id = nextMermaidNodeId(graph.nodes);
    commitGraph({ ...graph, nodes: [...graph.nodes, { id, label: '新节点', shape: 'rectangle' }] });
  }

  function renameNode(previousId: string, nextId: string) {
    if (!graph) return;
    const normalized = nextId.trim();
    if (!/^[A-Za-z_][\w-]*$/.test(normalized)) {
      setFormError('节点 ID 必须以英文字母或下划线开头，且只能包含字母、数字、下划线和连字符');
      return;
    }
    if (normalized !== previousId && graph.nodes.some((node) => node.id === normalized)) {
      setFormError(`节点 ID “${normalized}” 已存在`);
      return;
    }
    commitGraph({
      ...graph,
      nodes: graph.nodes.map((node) => node.id === previousId ? { ...node, id: normalized } : node),
      edges: graph.edges.map((edge) => ({
        ...edge,
        from: edge.from === previousId ? normalized : edge.from,
        to: edge.to === previousId ? normalized : edge.to,
      })),
    });
  }

  function removeNode(nodeId: string) {
    if (!graph) return;
    commitGraph({
      ...graph,
      nodes: graph.nodes.filter((node) => node.id !== nodeId),
      edges: graph.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
    });
  }

  function addEdge() {
    if (!graph || graph.nodes.length < 2) {
      setFormError('至少需要两个节点才能添加连线');
      return;
    }
    const from = graph.nodes[0].id;
    const to = graph.nodes[1].id;
    commitGraph({
      ...graph,
      edges: [...graph.edges, { id: `edge-${Date.now()}-${graph.edges.length}`, from, to, label: '', style: 'arrow' }],
    });
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
    const controller = new AbortController();
    abortRef.current = controller;
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
        (chunk) => {
          generated += chunk;
          setAiStatus({ kind: 'running', message: `正在生成 · 已接收 ${generated.length} 个字符` });
        },
        controller.signal,
      );
      const nextSource = extractMermaidSource(generated);
      if (!nextSource) throw new Error('模型返回了空内容');
      await validateMermaid(nextSource);
      if (controller.signal.aborted) return;
      setSource(nextSource);
      setGraph(parseFlowchartSource(nextSource));
      setSelectedTemplateId('');
      setAiUseCurrentSource(true);
      setAiStatus({ kind: 'success', message: '图表草稿已生成，可继续编辑或应用到文档' });
    } catch (reason) {
      if (controller.signal.aborted) return;
      setAiStatus({ kind: 'error', message: reason instanceof Error ? reason.message : '图表生成失败，请重试' });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function stopAi() {
    abortRef.current?.abort();
    abortRef.current = null;
    setAiStatus({ kind: 'idle', message: '已停止生成，当前草稿保持不变' });
  }

  async function applySource() {
    const normalized = source.trim();
    setApplying(true);
    setFormError('');
    try {
      await validateMermaid(normalized);
      onApply(normalized);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message.replace(/^Error:\s*/i, '').split('\n')[0] : 'Mermaid 语法校验失败');
    } finally {
      setApplying(false);
    }
  }

  const sourceLines = source ? source.split(/\r?\n/).length : 0;

  return (
    <div className="modal-backdrop mermaid-workbench-backdrop" role="presentation" onMouseDown={(event) => { if (!inactive && event.target === event.currentTarget) onClose(); }}>
      <section className="mermaid-workbench" role="dialog" aria-modal="true" aria-labelledby="mermaid-workbench-title">
        <header className="workbench-header">
          <span className="workbench-heading-icon"><Workflow size={20} /></span>
          <div>
            <div className="workbench-title-row">
              <h2 id="mermaid-workbench-title">Mermaid 图表工作台</h2>
              <span>{mode === 'edit' ? '编辑当前图表' : '创建新图表'}</span>
            </div>
            <p>AI、模板、表单和源码协同编辑，确认后再写回 Markdown</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭图表工作台"><X size={19} /></button>
        </header>

        <div className="workbench-main">
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
                    placeholder="例如：生成电商订单从创建、支付、履约到售后的完整流程，并标出超时和退款分支"
                  />
                  <label className="workbench-ai-context">
                    <input type="checkbox" checked={aiUseCurrentSource} onChange={(event) => setAiUseCurrentSource(event.target.checked)} />
                    <span>基于右侧当前草稿修改</span>
                    <small>{aiUseCurrentSource ? 'AI 会尽量保留未要求改变的内容' : 'AI 将从你的描述创建一张新图'}</small>
                  </label>
                  <div className="workbench-prompt-examples">
                    {AI_EXAMPLES.map((example) => <button key={example} type="button" onClick={() => setAiInstruction(example)}>{example}</button>)}
                  </div>
                  {aiStatus.message ? (
                    <div className={`workbench-ai-status ${aiStatus.kind}`} role="status">
                      {aiStatus.kind === 'running' ? <LoaderCircle size={15} /> : aiStatus.kind === 'error' ? <CircleAlert size={15} /> : aiStatus.kind === 'success' ? <Check size={15} /> : <Bot size={15} />}
                      <span>{aiStatus.message}</span>
                    </div>
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
                    <div><strong>从常用图表开始</strong><small>选择模板后可继续用 AI、源码或可视化表单修改</small></div>
                  </div>
                  <div className="workbench-template-grid">
                    {MERMAID_TEMPLATES.map((template) => (
                      <button key={template.id} type="button" className={selectedTemplateId === template.id ? 'active' : ''} onClick={() => selectTemplate(template.id)}>
                        <span><b>{template.name}</b><i>{template.category}</i></span>
                        <small>{template.description}</small>
                        <em>{template.visualEditable ? '支持可视化表单编辑' : '支持源码与 AI 编辑'}</em>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {tab === 'visual' ? (
                <div className="workbench-visual-panel">
                  {graph ? (
                    <>
                      <div className="visual-editor-intro">
                        <div><strong>流程图可视化编辑</strong><small>表单修改会实时同步为 Mermaid 源码</small></div>
                        <label>布局
                          <select value={graph.direction} onChange={(event) => commitGraph({ ...graph, direction: event.target.value as MermaidFlowDirection })}>
                            <option value="TD">从上到下</option>
                            <option value="LR">从左到右</option>
                            <option value="BT">从下到上</option>
                            <option value="RL">从右到左</option>
                          </select>
                        </label>
                      </div>

                      <div className="visual-editor-group">
                        <header><div><strong>节点</strong><small>{graph.nodes.length} 个</small></div><button type="button" onClick={addNode}><Plus size={13} /> 添加节点</button></header>
                        <div className="visual-node-list">
                          {graph.nodes.map((node, nodeIndex) => (
                            <div className="visual-node-card" key={`visual-node-${nodeIndex}`}>
                              <div className="visual-node-meta">
                                <label>ID<input value={node.id} onChange={(event) => renameNode(node.id, event.target.value)} aria-label={`${node.label} 节点 ID`} /></label>
                                <label>形状<select value={node.shape} onChange={(event) => commitGraph({ ...graph, nodes: graph.nodes.map((item) => item.id === node.id ? { ...item, shape: event.target.value as MermaidNodeShape } : item) })}>{NODE_SHAPES.map((shape) => <option key={shape.value} value={shape.value}>{shape.label}</option>)}</select></label>
                                <button type="button" onClick={() => removeNode(node.id)} aria-label={`删除节点 ${node.label}`} title="删除节点"><Trash2 size={14} /></button>
                              </div>
                              <label>节点名称与说明<textarea rows={2} value={node.label} onChange={(event) => commitGraph({ ...graph, nodes: graph.nodes.map((item) => item.id === node.id ? { ...item, label: event.target.value } : item) })} /></label>
                            </div>
                          ))}
                          {!graph.nodes.length ? <p className="visual-empty">还没有节点。点击“添加节点”开始绘制。</p> : null}
                        </div>
                      </div>

                      <div className="visual-editor-group edge-group">
                        <header><div><strong>连线与分支</strong><small>{graph.edges.length} 条</small></div><button type="button" onClick={addEdge}><Plus size={13} /> 添加连线</button></header>
                        <div className="visual-edge-list">
                          {graph.edges.map((edge) => (
                            <div className="visual-edge-row" key={edge.id}>
                              <select value={edge.from} onChange={(event) => commitGraph({ ...graph, edges: graph.edges.map((item) => item.id === edge.id ? { ...item, from: event.target.value } : item) })} aria-label="起点">
                                {graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.label || node.id}</option>)}
                              </select>
                              <span>→</span>
                              <select value={edge.to} onChange={(event) => commitGraph({ ...graph, edges: graph.edges.map((item) => item.id === edge.id ? { ...item, to: event.target.value } : item) })} aria-label="终点">
                                {graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.label || node.id}</option>)}
                              </select>
                              <input value={edge.label} onChange={(event) => commitGraph({ ...graph, edges: graph.edges.map((item) => item.id === edge.id ? { ...item, label: event.target.value } : item) })} placeholder="分支标签（可选）" aria-label="连线标签" />
                              <select value={edge.style} onChange={(event) => commitGraph({ ...graph, edges: graph.edges.map((item) => item.id === edge.id ? { ...item, style: event.target.value as MermaidEdgeStyle } : item) })} aria-label="连线样式">
                                {EDGE_STYLES.map((style) => <option key={style.value} value={style.value}>{style.label}</option>)}
                              </select>
                              <button type="button" onClick={() => commitGraph({ ...graph, edges: graph.edges.filter((item) => item.id !== edge.id) })} aria-label="删除连线"><Trash2 size={14} /></button>
                            </div>
                          ))}
                          {!graph.edges.length ? <p className="visual-empty">还没有连线。至少添加两个节点后即可连接。</p> : null}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="visual-unsupported">
                      <span><CircleAlert size={22} /></span>
                      <strong>此图种暂不支持表单化编辑</strong>
                      <p>时序图、类图、状态图、ER 图、思维导图和甘特图仍可通过 AI 与源码编辑。表单化节点和连线编辑目前适用于 flowchart / graph。</p>
                      <button type="button" onClick={() => { selectTemplate('basic-flowchart'); setTab('visual'); }}><Workflow size={15} /> 改用基本流程图</button>
                    </div>
                  )}
                </div>
              ) : null}

              {tab === 'source' ? (
                <div className="workbench-source-panel">
                  <div className="source-editor-heading"><div><strong>Mermaid 源码</strong><small>{sourceLines} 行 · 实时预览</small></div><button type="button" onClick={() => { setSource(startingSource); setGraph(parseFlowchartSource(startingSource)); setSelectedTemplateId(''); }}><RotateCcw size={13} /> 恢复打开时内容</button></div>
                  <textarea
                    value={source}
                    onChange={(event) => { setSource(event.target.value); setSelectedTemplateId(''); setAiUseCurrentSource(true); setFormError(''); }}
                    spellCheck={false}
                    aria-label="Mermaid 源码编辑器"
                  />
                  <p className="workbench-hint">支持 Mermaid v11 常规语法。为保证本地文档安全，保存时会拒绝 click、HTML 和初始化指令。</p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="workbench-preview" aria-label="图表草稿预览">
            <header><div><span className="live-dot" /><strong>草稿预览</strong><small>{diagramKind(source)}</small></div><span>修改实时呈现</span></header>
            <div className="workbench-preview-canvas">
              {source.trim() ? <MermaidDiagram code={source} /> : <div className="workbench-preview-empty"><Workflow size={28} /><span>输入源码后将在这里预览</span></div>}
            </div>
          </section>
        </div>

        <footer className="workbench-footer">
          <div className={formError ? 'error' : ''}>{formError ? <><CircleAlert size={14} /> {formError}</> : <><Check size={14} /> 应用前会校验语法，文档不会被静默覆盖</>}</div>
          <button type="button" className="secondary-button" onClick={onClose}>取消</button>
          <button type="button" className="confirm-button" onClick={() => void applySource()} disabled={applying || aiStatus.kind === 'running'}>{applying ? <LoaderCircle className="spinning" size={14} /> : <Check size={14} />} 应用到文档</button>
        </footer>
      </section>
    </div>
  );
}
