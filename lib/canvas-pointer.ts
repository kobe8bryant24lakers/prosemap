export type CanvasPointerDrag = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
};

type CanvasPointerSample = {
  pointerId: number;
  clientX: number;
  clientY: number;
  buttons: number;
};

/** A release can finish a drag, but cannot turn a click into a snapped move. */
export function canvasPointerDragMoved(drag: CanvasPointerDrag, pointer: CanvasPointerSample, threshold: number): boolean {
  if (drag.pointerId !== pointer.pointerId) return false;
  return drag.moved || ((pointer.buttons & 1) !== 0
    && Math.hypot(pointer.clientX - drag.startClientX, pointer.clientY - drag.startClientY) > threshold);
}
