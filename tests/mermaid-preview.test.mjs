import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MERMAID_FULLSCREEN_MAX_ZOOM,
  MERMAID_FULLSCREEN_MIN_ZOOM,
  MERMAID_PREVIEW_MAX_ZOOM,
  MERMAID_PREVIEW_MIN_ZOOM,
  mermaidFullscreenZoomFromWheel,
  mermaidPreviewZoomFromWheel,
} from '../lib/mermaid-preview.ts';

test('preview wheel direction zooms Mermaid diagrams in and out', () => {
  assert.ok(mermaidPreviewZoomFromWheel(1, -100) > 1);
  assert.ok(mermaidPreviewZoomFromWheel(1, 100) < 1);
  assert.notEqual(mermaidPreviewZoomFromWheel(1, 0.1), 1, 'fine trackpad deltas must not be discarded');
  assert.equal(mermaidPreviewZoomFromWheel(1, 0), 1);
});

test('preview wheel zoom normalizes line and page deltas', () => {
  assert.ok(mermaidPreviewZoomFromWheel(1, -1, 1) > 1);
  assert.ok(mermaidPreviewZoomFromWheel(1, 1, 1) < 1);
  assert.ok(mermaidPreviewZoomFromWheel(1, -1, 2, 600) > 1);
  assert.ok(mermaidPreviewZoomFromWheel(1, 1, 2, 600) < 1);
});

test('preview wheel zoom stays inside the toolbar zoom limits', () => {
  assert.equal(
    mermaidPreviewZoomFromWheel(MERMAID_PREVIEW_MAX_ZOOM, -10_000),
    MERMAID_PREVIEW_MAX_ZOOM,
  );
  assert.equal(
    mermaidPreviewZoomFromWheel(MERMAID_PREVIEW_MIN_ZOOM, 10_000),
    MERMAID_PREVIEW_MIN_ZOOM,
  );
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
