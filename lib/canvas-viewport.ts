import { mermaidCanvasFitZoom, type MermaidCanvasBounds } from './mermaid-canvas-layout.ts';

/** Start at a readable scale; fitting an overview remains an explicit command. */
export function initialCanvasView(bounds: MermaidCanvasBounds, width: number, height: number) {
  const zoom = Math.max(0.75, mermaidCanvasFitZoom(bounds, width, height, 0.9));
  return {
    zoom,
    x: bounds.minX + Math.min(bounds.maxX - bounds.minX, width / zoom) / 2,
    y: bounds.minY + Math.min(bounds.maxY - bounds.minY, height / zoom) / 2,
  };
}

/** Edge scrolling uses screen pixels, so speed is independent of diagram zoom. */
export function canvasEdgeScroll(point: { x: number; y: number }, viewport: { width: number; height: number }, elapsedMs = 16.67) {
  const velocity = (position: number, extent: number) => {
    const margin = Math.min(40, extent / 4);
    if (position < margin) return -Math.min(1, (margin - position) / margin);
    if (position > extent - margin) return Math.min(1, (position - extent + margin) / margin);
    return 0;
  };
  const distance = 660 * Math.max(0, Math.min(32, elapsedMs)) / 1000;
  return { x: velocity(point.x, viewport.width) * distance, y: velocity(point.y, viewport.height) * distance };
}
