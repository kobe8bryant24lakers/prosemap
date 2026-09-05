import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MERMAID_FULLSCREEN_MAX_ZOOM,
  MERMAID_FULLSCREEN_MIN_ZOOM,
  mermaidFullscreenZoomFromWheel,
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
