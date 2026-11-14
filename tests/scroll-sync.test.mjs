import assert from 'node:assert/strict';
import test from 'node:test';

import { synchronizedScrollTop, anchoredScrollTop } from '../lib/scroll-sync.ts';

test('scroll synchronization maps top, midpoint, and bottom by progress', () => {
  assert.equal(synchronizedScrollTop(0, 1_000, 200, 2_000, 400), 0);
  assert.equal(synchronizedScrollTop(400, 1_000, 200, 2_000, 400), 800);
  assert.equal(synchronizedScrollTop(800, 1_000, 200, 2_000, 400), 1_600);
});

test('block mapping aligns unequal-height sections in both directions', () => {
  const anchors = [{ source: 100, target: 300 }, { source: 200, target: 900 }, { source: 800, target: 1100 }];
  assert.equal(anchoredScrollTop(200, 1000, 1500, anchors), 900);
  assert.equal(anchoredScrollTop(500, 1000, 1500, anchors), 1000);
  const reverse = anchors.map(({ source, target }) => ({ source: target, target: source }));
  assert.equal(anchoredScrollTop(1000, 1500, 1000, reverse), 500);
  assert.equal(anchoredScrollTop(1000, 1000, 1500, anchors), 1500);
  assert.equal(anchoredScrollTop(-30, 1000, 1500, anchors), 0);
  assert.equal(anchoredScrollTop(100, 0, 1500, anchors), 0);
  assert.equal(anchoredScrollTop(NaN, 1000, 1500, anchors), 0);
});

test('folded or non-monotonic blocks cannot reverse scroll direction', () => {
  const anchors = [{ source: 100, target: 100 }, { source: 100, target: 200 }, { source: 300, target: 50 }, { source: NaN, target: 400 }, { source: 500, target: 400 }, { source: 900, target: 2000 }];
  const positions = Array.from({ length: 101 }, (_, i) => anchoredScrollTop(i * 10, 1000, 1000, anchors));
  assert.equal(positions[0], 0);
  assert.equal(positions.at(-1), 1000);
  assert.ok(positions.every((top, i) => i === 0 || top >= positions[i - 1]));
});

test('scroll synchronization clamps positions outside the source range', () => {
  assert.equal(synchronizedScrollTop(-100, 1_000, 200, 2_000, 400), 0);
  assert.equal(synchronizedScrollTop(2_000, 1_000, 200, 2_000, 400), 1_600);
});

test('scroll synchronization handles short and invalid dimensions safely', () => {
  assert.equal(synchronizedScrollTop(50, 100, 200, 2_000, 400), 0);
  assert.equal(synchronizedScrollTop(50, 1_000, 200, 100, 200), 0);
  assert.equal(synchronizedScrollTop(Number.NaN, 1_000, 200, 2_000, 400), 0);
  assert.equal(synchronizedScrollTop(50, Number.POSITIVE_INFINITY, 200, 2_000, 400), 0);
});
