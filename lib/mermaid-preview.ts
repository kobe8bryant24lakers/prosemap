export const MERMAID_PREVIEW_MIN_ZOOM = 0.65;
export const MERMAID_PREVIEW_MAX_ZOOM = 1.8;
export const MERMAID_FULLSCREEN_MIN_ZOOM = 0.5;
export const MERMAID_FULLSCREEN_MAX_ZOOM = 3;

const WHEEL_LINE_HEIGHT = 18;
const MAX_WHEEL_DELTA = 180;
const WHEEL_ZOOM_SENSITIVITY = 0.0017;

export function mermaidPreviewZoomFromWheel(
  currentZoom: number,
  deltaY: number,
  deltaMode = 0,
  pageHeight = 1,
) {
  return mermaidZoomFromWheel(
    currentZoom,
    deltaY,
    deltaMode,
    pageHeight,
    MERMAID_PREVIEW_MIN_ZOOM,
    MERMAID_PREVIEW_MAX_ZOOM,
  );
}

export function mermaidFullscreenZoomFromWheel(
  currentZoom: number,
  deltaY: number,
  deltaMode = 0,
  pageHeight = 1,
) {
  return mermaidZoomFromWheel(
    currentZoom,
    deltaY,
    deltaMode,
    pageHeight,
    MERMAID_FULLSCREEN_MIN_ZOOM,
    MERMAID_FULLSCREEN_MAX_ZOOM,
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
