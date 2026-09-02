import assert from 'node:assert/strict';
import test from 'node:test';

import { synchronizedScrollTop } from '../lib/scroll-sync.ts';

test('scroll synchronization maps top, midpoint, and bottom by progress', () => {
  assert.equal(synchronizedScrollTop(0, 1_000, 200, 2_000, 400), 0);
  assert.equal(synchronizedScrollTop(400, 1_000, 200, 2_000, 400), 800);
  assert.equal(synchronizedScrollTop(800, 1_000, 200, 2_000, 400), 1_600);
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
