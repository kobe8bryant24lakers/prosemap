export const MERMAID_PREVIEW_MIN_ZOOM = 0.65;
export const MERMAID_PREVIEW_MAX_ZOOM = 1.8;
export const MERMAID_FULLSCREEN_MIN_ZOOM = 0.5;
export const MERMAID_FULLSCREEN_MAX_ZOOM = 3;
export const MERMAID_FULLSCREEN_MIN_FONT_PX = 12;

/** Fit-relative limits measured from the smallest visible diagram label. */
export function mermaidFullscreenZoomLimits(fontSizeAtFit: number) {
  const readable = Number.isFinite(fontSizeAtFit) && fontSizeAtFit > 0
    ? Math.ceil(MERMAID_FULLSCREEN_MIN_FONT_PX / fontSizeAtFit * 100 - 1e-7) / 100
    : MERMAID_FULLSCREEN_MIN_ZOOM;
  const min = Math.max(MERMAID_FULLSCREEN_MIN_ZOOM, readable);
  // A small window or a large diagram can need more than the normal 300%
  // ceiling just to reach readable text. Never put the ceiling below the floor.
  return { min, max: Math.max(MERMAID_FULLSCREEN_MAX_ZOOM, min) };
}

const WHEEL_LINE_HEIGHT = 18;
const MAX_WHEEL_DELTA = 180;
const WHEEL_ZOOM_SENSITIVITY = 0.0017;

/** Keep the diagram point under the pointer stationary while zooming. */
export function zoomMermaidViewport(
  pan: { x: number; y: number },
  currentZoom: number,
  nextZoom: number,
  pointer: { x: number; y: number },
) {
  const ratio = nextZoom / currentZoom;
  return { x: pointer.x - (pointer.x - pan.x) * ratio, y: pointer.y - (pointer.y - pan.y) * ratio };
}

export function mermaidFullscreenZoomFromWheel(
  currentZoom: number,
  deltaY: number,
  deltaMode = 0,
  pageHeight = 1,
  limits = { min: MERMAID_FULLSCREEN_MIN_ZOOM, max: MERMAID_FULLSCREEN_MAX_ZOOM },
) {
  return mermaidZoomFromWheel(
    currentZoom,
    deltaY,
    deltaMode,
    pageHeight,
    limits.min,
    limits.max,
  );
}

function mermaidZoomFromWheel(
  currentZoom: number,
  deltaY: number,
  deltaMode: number,
  pageHeight: number,
  minZoom: number,
  maxZoom: number,
) {
  const normalizedCurrentZoom = clampZoom(currentZoom, minZoom, maxZoom);
  if (!Number.isFinite(deltaY) || deltaY === 0) return normalizedCurrentZoom;

  const unit = deltaMode === 1
    ? WHEEL_LINE_HEIGHT
    : deltaMode === 2 ? Math.max(1, Number.isFinite(pageHeight) ? pageHeight : 1) : 1;
  const normalizedDelta = Math.max(-MAX_WHEEL_DELTA, Math.min(MAX_WHEEL_DELTA, deltaY * unit));
  return clampZoom(
    normalizedCurrentZoom * Math.exp(-normalizedDelta * WHEEL_ZOOM_SENSITIVITY),
    minZoom,
    maxZoom,
  );
}

function clampZoom(value: number, minZoom: number, maxZoom: number) {
  const normalized = Number.isFinite(value) ? value : 1;
  return Math.max(minZoom, Math.min(maxZoom, normalized));
}
