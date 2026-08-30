'use client';

import DOMPurify from 'dompurify';
import { Check, Copy, PencilRuler, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { renderMermaid } from '@/lib/mermaid-runtime';

type MermaidDiagramProps = {
  code: string;
  onEdit?: () => void;
};

type MermaidRenderState = {
  code: string;
  error: string;
  svg: string;
};

export default function MermaidDiagram({ code, onEdit }: MermaidDiagramProps) {
  const reactId = useId();
  const [renderState, setRenderState] = useState<MermaidRenderState>({ code: '', error: '', svg: '' });
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);
  const currentRender = renderState.code === code ? renderState : null;

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const id = `prosemap-mermaid-${reactId.replace(/:/g, '')}-${Date.now()}`;
        const rendered = await renderMermaid(id, code);
        if (!active) return;
        const clean = DOMPurify.sanitize(rendered.svg, {
          USE_PROFILES: { html: true, svg: true, svgFilters: true },
          // Mermaid renders rich node and edge labels inside SVG foreignObject
          // elements. Keep that integration point while DOMPurify continues to
          // sanitize the nested XHTML and its attributes.
          ADD_TAGS: ['foreignObject'],
          ADD_ATTR: ['dominant-baseline'],
          HTML_INTEGRATION_POINTS: { foreignobject: true },
        });
        setRenderState({ code, error: '', svg: clean });
      } catch (reason) {
        if (!active) return;
        const message = reason instanceof Error ? reason.message : '图表语法无法解析';
        setRenderState({ code, error: message.replace(/^Error:\s*/i, '').split('\n')[0], svg: '' });
      }
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [code, reactId]);

  async function copySource() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <span className="mermaid-diagram" role="figure" aria-label="Mermaid 图表">
      <span className="mermaid-toolbar">
        <span className="diagram-label"><span className="live-dot" />Mermaid</span>
        <span className="diagram-actions">
          {onEdit ? (
            <button type="button" className="diagram-edit-action" onClick={onEdit} aria-label="在可视化画布中编辑图表" title="在可视化画布中编辑">
              <PencilRuler size={13} /><span>画布编辑</span>
            </button>
          ) : null}
          <button type="button" onClick={() => setZoom((value) => Math.max(0.65, value - 0.15))} aria-label="缩小图表" title="缩小">
            <ZoomOut size={14} />
          </button>
          <button type="button" className="diagram-zoom-value" onClick={() => setZoom(1)} aria-label={`重置图表缩放，当前 ${Math.round(zoom * 100)}%`} title="重置为 100%">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={() => setZoom((value) => Math.min(1.8, value + 0.15))} aria-label="放大图表" title="放大">
            <ZoomIn size={14} />
          </button>
          <button type="button" onClick={copySource} aria-label="复制 Mermaid 源码" title="复制源码">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </span>
      </span>
      {currentRender?.error ? (
        <span className="mermaid-error">
          <strong>图表暂时无法渲染</strong>
          <span>{currentRender.error}</span>
          <code>{code}</code>
        </span>
      ) : currentRender?.svg ? (
        <span className={`mermaid-canvas${onEdit ? ' editable' : ''}`} onDoubleClick={onEdit} title={onEdit ? '双击进入可视化画布编辑' : undefined}>
          <span className="mermaid-svg" style={{ transform: `scale(${zoom})` }} dangerouslySetInnerHTML={{ __html: currentRender.svg }} />
        </span>
      ) : (
        <span className="mermaid-loading"><i /><span>正在绘制图表…</span></span>
      )}
    </span>
  );
}
