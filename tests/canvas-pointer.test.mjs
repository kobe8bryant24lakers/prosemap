import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasPointerDragMoved } from '../lib/canvas-pointer.ts';

const press = { pointerId: 1, startClientX: 720, startClientY: 522, moved: false };
const sample = (x, y, buttons = 1, pointerId = 1) => ({ pointerId, clientX: x, clientY: y, buttons });

test('a release coordinate change cannot turn selection into a snapped drag', () => {
  for (const threshold of [2, 3, 4]) {
    assert.equal(canvasPointerDragMoved(press, sample(730, 532, 0), threshold), false);
  }
});

test('drag thresholds use held primary movement in screen pixels', () => {
  assert.equal(canvasPointerDragMoved(press, sample(723, 522), 3), false);
  assert.equal(canvasPointerDragMoved(press, sample(722, 524), 3), false);
  assert.equal(canvasPointerDragMoved(press, sample(723, 523), 3), true);
  assert.equal(canvasPointerDragMoved(press, sample(730, 532, 2), 3), false);
  assert.equal(canvasPointerDragMoved(press, sample(730, 532, 4), 3), false);
  assert.equal(canvasPointerDragMoved(press, sample(730, 532, 3), 3), true);
});

test('a queued pressed move starts a fast drag and its release still supplies the final point', () => {
  const moved = canvasPointerDragMoved(press, sample(750, 540), 3);
  assert.equal(moved, true);
  const active = { ...press, moved };
  assert.equal(canvasPointerDragMoved(active, sample(775, 560, 0), 3), true);
  assert.equal(canvasPointerDragMoved(active, sample(720, 522, 0), 3), true);
});

test('unrelated pointer activity cannot start or finish the current drag', () => {
  assert.equal(canvasPointerDragMoved(press, sample(800, 600, 1, 2), 3), false);
  assert.equal(canvasPointerDragMoved({ ...press, moved: true }, sample(800, 600, 0, 2), 3), false);
});
