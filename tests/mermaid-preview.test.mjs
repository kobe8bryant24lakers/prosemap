import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MERMAID_FULLSCREEN_MAX_ZOOM,
  MERMAID_FULLSCREEN_MIN_ZOOM,
  mermaidFullscreenZoomFromWheel,
  mermaidFullscreenZoomLimits,
  zoomMermaidViewport,
} from '../lib/mermaid-preview.ts';

test('fullscreen zoom anchors the same diagram point after panning', () => {
  const pan = { x: 70, y: -35 };
  const pointer = { x: 210, y: 145 };
  const next = zoomMermaidViewport(pan, 1.2, 2.4, pointer);
  assert.equal((pointer.x - next.x) / 2.4, (pointer.x - pan.x) / 1.2);
  assert.equal((pointer.y - next.y) / 2.4, (pointer.y - pan.y) / 1.2);
  assert.deepEqual(zoomMermaidViewport(next, 2.4, 1.2, pointer), pan);
});

test('fullscreen wheel zoom uses the wider fullscreen limits', () => {
  assert.ok(mermaidFullscreenZoomFromWheel(1, -100) > 1);
  assert.ok(mermaidFullscreenZoomFromWheel(1, 100) < 1);
  assert.equal(
    mermaidFullscreenZoomFromWheel(MERMAID_FULLSCREEN_MAX_ZOOM, -10_000),
    MERMAID_FULLSCREEN_MAX_ZOOM,
  );
  assert.equal(
    mermaidFullscreenZoomFromWheel(MERMAID_FULLSCREEN_MIN_ZOOM, 10_000),
    MERMAID_FULLSCREEN_MIN_ZOOM,
  );
});

test('fullscreen wheel zoom normalizes line and page deltas', () => {
  assert.ok(mermaidFullscreenZoomFromWheel(1, -1, 1) > 1);
  assert.ok(mermaidFullscreenZoomFromWheel(1, 1, 1) < 1);
  assert.ok(mermaidFullscreenZoomFromWheel(1, -1, 2, 600) > 1);
  assert.ok(mermaidFullscreenZoomFromWheel(1, 1, 2, 600) < 1);
});

test('fullscreen limits retain readable text for measured small labels', () => {
  assert.deepEqual(mermaidFullscreenZoomLimits(8.963975694), { min: 1.34, max: 3 });
  assert.deepEqual(mermaidFullscreenZoomLimits(12.414323129), { min: .97, max: 3 });
  assert.deepEqual(mermaidFullscreenZoomLimits(32), { min: .5, max: 3 });
  assert.deepEqual(mermaidFullscreenZoomLimits(2), { min: 6, max: 6 });
  for (const size of [2, 5.2, 8.963975694, 12.414323129, 16, 24, 32]) {
    assert.ok(size * mermaidFullscreenZoomLimits(size).min >= 12);
  }
});

test('diagrams without measurable labels keep ordinary zoom limits', () => {
  for (const size of [Infinity, NaN, 0, -1]) {
    assert.deepEqual(mermaidFullscreenZoomLimits(size), { min: .5, max: 3 });
  }
});

test('wheel deltas cannot bypass the readable lower bound', () => {
  const limits = { min: 1.34, max: 3 };
  for (const mode of [0, 1, 2]) {
    assert.equal(mermaidFullscreenZoomFromWheel(1.34, 10000, mode, 600, limits), 1.34);
    assert.equal(mermaidFullscreenZoomFromWheel(3, -10000, mode, 600, limits), 3);
    assert.ok(mermaidFullscreenZoomFromWheel(1.5, 1, mode, 600, limits) >= 1.34);
  }
});
