'use client';

import DOMPurify from 'dompurify';
import { Check, Copy, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

type MermaidDiagramProps = {
  code: string;
};

export default function MermaidDiagram({ code }: MermaidDiagramProps) {
  const reactId = useId();
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          fontFamily: 'Inter, PingFang SC, Microsoft YaHei, sans-serif',
          themeVariables: {
            primaryColor: '#e6f3ec',
            primaryTextColor: '#183b2e',
            primaryBorderColor: '#76a590',
            lineColor: '#527463',
            secondaryColor: '#f7f4ec',
            tertiaryColor: '#eef7f2',
            clusterBkg: '#f7faf8',
            clusterBorder: '#cbd8d1',
            fontSize: '14px',
          },
          flowchart: { curve: 'basis', htmlLabels: true, padding: 16 },
        });
        const id = `prosemap-mermaid-${reactId.replace(/:/g, '')}-${Date.now()}`;
        const rendered = await mermaid.render(id, code);
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
        setSvg(clean);
        setError('');
      } catch (reason) {
        if (!active) return;
        const message = reason instanceof Error ? reason.message : '图表语法无法解析';
        setError(message.replace(/^Error:\s*/i, '').split('\n')[0]);
        setSvg('');
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
          <button type="button" onClick={() => setZoom((value) => Math.max(0.65, value - 0.15))} aria-label="缩小图表" title="缩小">
            <ZoomOut size={14} />
          </button>
          <button type="button" onClick={() => setZoom((value) => Math.min(1.8, value + 0.15))} aria-label="放大图表" title="放大">
            <ZoomIn size={14} />
          </button>
          <button type="button" onClick={() => setZoom(1)} aria-label="重置图表缩放" title="重置缩放">
            <RotateCcw size={14} />
          </button>
          <button type="button" onClick={copySource} aria-label="复制 Mermaid 源码" title="复制源码">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </span>
      </span>
      {error ? (
        <span className="mermaid-error">
          <strong>图表暂时无法渲染</strong>
          <span>{error}</span>
          <code>{code}</code>
        </span>
      ) : svg ? (
        <span className="mermaid-canvas">
          <span className="mermaid-svg" style={{ transform: `scale(${zoom})` }} dangerouslySetInnerHTML={{ __html: svg }} />
        </span>
      ) : (
        <span className="mermaid-loading"><i /><span>正在绘制图表…</span></span>
      )}
    </span>
  );
}
