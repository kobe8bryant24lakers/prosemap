import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileCanvasHistorySelection as reconcile } from '../lib/canvas-history-selection.ts';

const graph = { nodes: [{ id: 'A' }, { id: 'B' }], edges: [{ id: 'edge-1' }] };

test('history keeps a selected node when only its properties change', () => {
  const selection = { kind: 'node', id: 'A' };
  assert.deepEqual(reconcile(selection, graph), selection);
});

test('history does not select a restored object when current selection is empty', () => {
  assert.equal(reconcile(null, graph), null);
});

test('history keeps an existing selected edge and clears a missing edge even if a node has that ID', () => {
  const selection = { kind: 'edge', id: 'edge-1' };
  assert.equal(reconcile(selection, graph), selection);
  assert.equal(reconcile(selection, { nodes: [{ id: 'edge-1' }], edges: [] }), null);
});

test('history filters a multi-selection without mutating its IDs or changing a valid primary', () => {
  const ids = Object.freeze(['B', 'missing', 'A', 'B']);
  const selection = Object.freeze({ kind: 'node', id: 'A', ids });
  assert.deepEqual(reconcile(selection, graph), { kind: 'node', id: 'A', ids: ['B', 'A'] });
  assert.deepEqual(ids, ['B', 'missing', 'A', 'B']);
});

test('history promotes the first surviving selected node when the primary disappears', () => {
  assert.deepEqual(reconcile({ kind: 'node', id: 'removed', ids: ['removed', 'B', 'A'] }, graph),
    { kind: 'node', id: 'B', ids: ['B', 'A'] });
  assert.deepEqual(reconcile({ kind: 'node', id: 'removed', ids: ['removed', 'B'] }, graph),
    { kind: 'node', id: 'B' });
});

test('history clears a selection when none of its nodes survive', () => {
  assert.equal(reconcile({ kind: 'node', id: 'removed', ids: ['removed', 'missing'] }, graph), null);
  assert.equal(reconcile({ kind: 'node', id: 'removed' }, graph), null);
});
