'use client';

import DOMPurify from 'dompurify';
import { Check, Copy, Maximize2, PencilRuler, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MERMAID_FULLSCREEN_MAX_ZOOM,
  MERMAID_FULLSCREEN_MIN_ZOOM,
  MERMAID_PREVIEW_MAX_ZOOM,
  MERMAID_PREVIEW_MIN_ZOOM,
  mermaidFullscreenZoomFromWheel,
  zoomMermaidViewport,
} from '@/lib/mermaid-preview';
import { renderMermaid } from '@/lib/mermaid-runtime';

type MermaidDiagramProps = {
  code: string;
  onEdit?: () => void;
};

type MermaidRenderState = {
  code: string;
  error: string;
  intrinsicHeight: number;
  intrinsicWidth: number;
  svg: string;
};

const EMPTY_RENDER_STATE: MermaidRenderState = {
  code: '',
  error: '',
  intrinsicHeight: 0,
  intrinsicWidth: 0,
  svg: '',
};

export default function MermaidDiagram({ code, onEdit }: MermaidDiagramProps) {
  const reactId = useId();
  const fullscreenTitleId = `mermaid-fullscreen-${reactId.replace(/:/g, '')}`;
  const fullscreenBackdropRef = useRef<HTMLDivElement>(null);
  const fullscreenDialogRef = useRef<HTMLElement>(null);
  const fullscreenStageRef = useRef<HTMLDivElement>(null);
  const fullscreenCloseRef = useRef<HTMLButtonElement>(null);
  const fullscreenRenderSequenceRef = useRef(0);
  const [renderState, setRenderState] = useState<MermaidRenderState>(EMPTY_RENDER_STATE);
  const [fullscreenRenderState, setFullscreenRenderState] = useState<MermaidRenderState>(EMPTY_RENDER_STATE);
  const [zoom, setZoom] = useState(1);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [fullscreenZoom, setFullscreenZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [copied, setCopied] = useState(false);
  const fullscreenZoomRef = useRef(fullscreenZoom);
  const currentRender = renderState.code === code ? renderState : null;
  const currentFullscreenRender = fullscreenRenderState.code === code ? fullscreenRenderState : null;
  const fullscreenSvg = currentFullscreenRender?.svg;

  useEffect(() => {
    fullscreenZoomRef.current = fullscreenZoom;
  }, [fullscreenZoom]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const id = `prosemap-mermaid-${reactId.replace(/:/g, '')}-${Date.now()}`;
        const rendered = await renderMermaid(id, code);
        if (!active) return;
        const clean = sanitizeMermaidSvg(rendered.svg);
        const dimensions = readMermaidSvgDimensions(clean);
        setRenderState({ code, error: '', intrinsicHeight: dimensions.height, intrinsicWidth: dimensions.width, svg: clean });
      } catch (reason) {
        if (!active) return;
        const message = reason instanceof Error ? reason.message : '图表语法无法解析';
        setRenderState({ code, error: message.replace(/^Error:\s*/i, '').split('\n')[0], intrinsicHeight: 0, intrinsicWidth: 0, svg: '' });
      }
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [code, reactId]);

  useEffect(() => {
    if (!fullscreenOpen) return;

    let active = true;
    const renderSequence = ++fullscreenRenderSequenceRef.current;
    const timer = window.setTimeout(async () => {
      try {
        const id = `prosemap-mermaid-fullscreen-${reactId.replace(/:/g, '')}-${Date.now()}-${renderSequence}`;
        const rendered = await renderMermaid(id, code);
        if (!active || fullscreenRenderSequenceRef.current !== renderSequence) return;
        const clean = sanitizeMermaidSvg(rendered.svg);
        const dimensions = readMermaidSvgDimensions(clean);
        setFullscreenRenderState({ code, error: '', intrinsicHeight: dimensions.height, intrinsicWidth: dimensions.width, svg: clean });
      } catch (reason) {
        if (!active || fullscreenRenderSequenceRef.current !== renderSequence) return;
        const message = reason instanceof Error ? reason.message : '图表语法无法解析';
        setFullscreenRenderState({ code, error: message.replace(/^Error:\s*/i, '').split('\n')[0], intrinsicHeight: 0, intrinsicWidth: 0, svg: '' });
      }
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [code, fullscreenOpen, reactId]);

  useEffect(() => {
    if (!fullscreenOpen) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fullscreenRoot = fullscreenBackdropRef.current;
    const inertRootSnapshots = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== fullscreenRoot)
      .map((element) => ({
        element,
        hadAttribute: element.hasAttribute('inert'),
        attributeValue: element.getAttribute('inert'),
      }));

    inertRootSnapshots.forEach(({ element }) => element.setAttribute('inert', ''));
    fullscreenCloseRef.current?.focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setFullscreenOpen(false);
        return;
      }

      if (event.key !== 'Tab') return;
      const dialog = fullscreenDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>([
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(','))).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (!first || !last) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
      } else if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      inertRootSnapshots.forEach(({ element, hadAttribute, attributeValue }) => {
        if (hadAttribute) element.setAttribute('inert', attributeValue ?? '');
        else element.removeAttribute('inert');
      });
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [fullscreenOpen]);

  useEffect(() => {
    const stage = fullscreenStageRef.current;
    if (!fullscreenOpen || !stage || !fullscreenSvg) return;
    const activeStage = stage;

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const nextZoom = mermaidFullscreenZoomFromWheel(
        fullscreenZoomRef.current,
        event.deltaY,
        event.deltaMode,
        activeStage.clientHeight,
      );
      if (nextZoom === fullscreenZoomRef.current) return;

      const bounds = activeStage.getBoundingClientRect();
      const nextPan = zoomMermaidViewport(panRef.current, fullscreenZoomRef.current, nextZoom, {
        x: event.clientX - bounds.left - bounds.width / 2,
        y: event.clientY - bounds.top - bounds.height / 2,
      });
      panRef.current = nextPan;
      setPan(nextPan);
      fullscreenZoomRef.current = nextZoom;
      setFullscreenZoom(nextZoom);
    }

    activeStage.addEventListener('wheel', handleWheel, { passive: false });
    return () => activeStage.removeEventListener('wheel', handleWheel);
  }, [fullscreenOpen, fullscreenSvg]);

  async function copySource() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function openFullscreen() {
    fullscreenZoomRef.current = 1;
    setFullscreenZoom(1);
    panRef.current = { x: 0, y: 0 };
    setPan(panRef.current);
    dragRef.current = null;
    setPanning(false);
    setFullscreenRenderState(EMPTY_RENDER_STATE);
    setFullscreenOpen(true);
  }

  function changeFullscreenZoom(delta: number) {
    const nextZoom = Math.max(
      MERMAID_FULLSCREEN_MIN_ZOOM,
      Math.min(MERMAID_FULLSCREEN_MAX_ZOOM, fullscreenZoomRef.current + delta),
    );
    panRef.current = zoomMermaidViewport(panRef.current, fullscreenZoomRef.current, nextZoom, { x: 0, y: 0 });
    setPan(panRef.current);
    fullscreenZoomRef.current = nextZoom;
    setFullscreenZoom(nextZoom);
  }

  function resetFullscreenZoom() {
    fullscreenZoomRef.current = 1;
    setFullscreenZoom(1);
    panRef.current = { x: 0, y: 0 };
    setPan(panRef.current);
  }

  const diagramSvg = currentRender?.svg;
  const portrait = Boolean(currentRender
    && currentRender.intrinsicHeight > currentRender.intrinsicWidth * 1.15);
  const inlineWidth = mermaidInlineWidth(currentRender, zoom, portrait);

  return (
    <>
      <span className="mermaid-diagram" role="figure" aria-label="Mermaid 图表">
        <span className="mermaid-toolbar">
          <span className="diagram-label"><span className="live-dot" />Mermaid</span>
          <span className="diagram-actions">
            {onEdit ? (
              <button type="button" className="diagram-edit-action" onClick={onEdit} aria-label="在可视化画布中编辑图表" title="在可视化画布中编辑">
                <PencilRuler size={13} /><span>画布编辑</span>
              </button>
            ) : null}
            <button type="button" onClick={() => setZoom((value) => Math.max(MERMAID_PREVIEW_MIN_ZOOM, value - 0.15))} aria-label="缩小图表" title="缩小">
              <ZoomOut size={14} />
            </button>
            <button type="button" className="diagram-zoom-value" onClick={() => setZoom(1)} aria-label={`重置图表缩放，当前 ${Math.round(zoom * 100)}%`} title="重置为 100%">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={() => setZoom((value) => Math.min(MERMAID_PREVIEW_MAX_ZOOM, value + 0.15))} aria-label="放大图表" title="放大">
              <ZoomIn size={14} />
            </button>
            <button type="button" onClick={openFullscreen} disabled={!diagramSvg} aria-label="全屏查看图表" title="全屏查看">
              <Maximize2 size={14} />
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
        ) : diagramSvg ? (
          <span
            className={`mermaid-canvas${onEdit ? ' editable' : ''}`}
            onDoubleClick={onEdit}
            title={onEdit ? '双击进入可视化画布编辑' : undefined}
          >
            <span className={`mermaid-svg${portrait ? ' is-portrait' : ''}`} style={{ width: inlineWidth }} dangerouslySetInnerHTML={{ __html: diagramSvg }} />
          </span>
        ) : (
          <span className="mermaid-loading"><i /><span>正在绘制图表…</span></span>
        )}
      </span>

      {fullscreenOpen && typeof document !== 'undefined' ? createPortal(
        <div
          ref={fullscreenBackdropRef}
          className="mermaid-fullscreen-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFullscreenOpen(false);
          }}
        >
          <section ref={fullscreenDialogRef} className="mermaid-fullscreen-dialog" role="dialog" aria-modal="true" aria-labelledby={fullscreenTitleId} tabIndex={-1}>
            <header className="mermaid-fullscreen-header">
              <div>
                <span className="live-dot" />
                <strong id={fullscreenTitleId}>Mermaid 单图查看</strong>
                <small>鼠标滚轮缩放 · 拖动画布平移 · 点击百分比复位</small>
              </div>
              <div className="mermaid-fullscreen-actions">
                <button type="button" onClick={() => changeFullscreenZoom(-0.15)} disabled={!fullscreenSvg} aria-label="缩小全屏图表" title="缩小">
                  <ZoomOut size={16} />
                </button>
                <button type="button" className="diagram-zoom-value" onClick={resetFullscreenZoom} disabled={!fullscreenSvg} aria-label={`重置全屏图表为适配视图，当前 ${Math.round(fullscreenZoom * 100)}%`} title="适配窗口">
                  {Math.round(fullscreenZoom * 100)}%
                </button>
                <button type="button" onClick={() => changeFullscreenZoom(0.15)} disabled={!fullscreenSvg} aria-label="放大全屏图表" title="放大">
                  <ZoomIn size={16} />
                </button>
                <button ref={fullscreenCloseRef} type="button" className="mermaid-fullscreen-close" onClick={() => setFullscreenOpen(false)} aria-label="关闭全屏图表" title="关闭（Esc）">
                  <X size={18} />
                </button>
              </div>
            </header>
            <div ref={fullscreenStageRef} className={`mermaid-fullscreen-stage${panning ? ' is-panning' : ''}`} title="滚动鼠标缩放，按住鼠标拖动画布"
              onPointerDown={(event) => {
                if (event.button !== 0 || !fullscreenSvg) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
                setPanning(true);
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.id !== event.pointerId) return;
                panRef.current = { x: panRef.current.x + event.clientX - drag.x, y: panRef.current.y + event.clientY - drag.y };
                dragRef.current = { id: drag.id, x: event.clientX, y: event.clientY };
                setPan(panRef.current);
              }}
              onPointerUp={(event) => {
                if (dragRef.current?.id !== event.pointerId) return;
                dragRef.current = null;
                setPanning(false);
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => { dragRef.current = null; setPanning(false); }}
              onLostPointerCapture={() => { dragRef.current = null; setPanning(false); }}
            >
              <div className="mermaid-fullscreen-stage-inner">
                {currentFullscreenRender?.error ? (
                  <span className="mermaid-error mermaid-fullscreen-error" role="alert">
                    <strong>图表暂时无法渲染</strong>
                    <span>{currentFullscreenRender.error}</span>
                    <code>{code}</code>
                  </span>
                ) : fullscreenSvg ? (
                  <span
                    className="mermaid-fullscreen-svg"
                    style={{
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${fullscreenZoom})`,
                    }}
                    dangerouslySetInnerHTML={{ __html: fullscreenSvg }}
                  />
                ) : (
                  <span className="mermaid-loading mermaid-fullscreen-loading" role="status" aria-live="polite"><i aria-hidden="true" /><span>正在准备全屏图表…</span></span>
                )}
              </div>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

function readMermaidSvgDimensions(svg: string) {
  const openingTag = svg.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const viewBox = openingTag.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: viewBox[2], height: viewBox[3] };
  }

  const width = Number.parseFloat(openingTag.match(/\bwidth\s*=\s*["']([\d.]+)/i)?.[1] ?? '0');
  const height = Number.parseFloat(openingTag.match(/\bheight\s*=\s*["']([\d.]+)/i)?.[1] ?? '0');
  return {
    width: Number.isFinite(width) && width > 0 ? width : 0,
    height: Number.isFinite(height) && height > 0 ? height : 0,
  };
}

function mermaidInlineWidth(render: MermaidRenderState | null, zoom: number, portrait: boolean) {
  const zoomedPercent = Math.round(zoom * 10000) / 100;
  if (!render?.intrinsicWidth) return `${zoomedPercent}%`;
  const zoomedNaturalWidth = Math.round(render.intrinsicWidth * zoom * 100) / 100;
  if (!portrait) return `min(${zoomedPercent}%, ${zoomedNaturalWidth}px)`;

  const portraitPercent = Math.round(76 * zoom * 100) / 100;
  const portraitFloor = Math.round(320 * zoom * 100) / 100;
  const portraitCeiling = Math.round(560 * zoom * 100) / 100;
  return `min(${zoomedPercent}%, ${zoomedNaturalWidth}px, ${portraitCeiling}px, max(${portraitFloor}px, ${portraitPercent}%))`;
}

function sanitizeMermaidSvg(svg: string) {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    // Mermaid renders rich node and edge labels inside SVG foreignObject
    // elements. Keep that integration point while DOMPurify continues to
    // sanitize the nested XHTML and its attributes.
    ADD_TAGS: ['foreignObject'],
    ADD_ATTR: ['dominant-baseline'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
  });
}
