import assert from 'node:assert/strict';
import test from 'node:test';
import { beginCanvasLabelEdit, cancelCanvasLabelEdit, canvasLabelKeyAction } from '../lib/canvas-label-edit.ts';

function snapshot(label, x = 0) {
  return { graph: { nodes: [{ id: 'A', label }], edges: [] }, layout: { positions: { A: { x, y: 20 } } } };
}

test('canceling a label edit preserves the previous redo operation and its layout', () => {
  const earlier = snapshot('Start', 10);
  const current = snapshot('Start', 40);
  const undone = snapshot('Start', 100);
  const undo = [earlier];
  const redo = [undone];
  const edit = beginCanvasLabelEdit('node:A', current, undo, redo);

  // The live edit records its starting state and clears redo on the first change.
  undo.push(current);
  redo.length = 0;
  const abandoned = snapshot('Abandoned label', 40);
  const restored = cancelCanvasLabelEdit(edit);

  assert.strictEqual(restored.snapshot, current);
  assert.deepEqual(restored.undo, [earlier]);
  assert.deepEqual(restored.redo, [undone]);
  assert.equal(restored.redo.includes(abandoned), false);
  const redone = restored.redo.pop();
  assert.equal(redone.graph.nodes[0].label, 'Start');
  assert.equal(redone.layout.positions.A.x, 100);
});

test('canceling a new label edit leaves no undo or redo item for the canceled text', () => {
  const current = snapshot('Original');
  const edit = beginCanvasLabelEdit('edge:E', current, [], []);
  const restored = cancelCanvasLabelEdit(edit);
  assert.equal(restored.snapshot.graph.nodes[0].label, 'Original');
  assert.deepEqual(restored.undo, []);
  assert.deepEqual(restored.redo, []);
});

test('cancel restores the full history even if the live edit exceeded its history limit', () => {
  const undo = Array.from({ length: 80 }, (_, index) => snapshot(`History ${index}`));
  const originals = [...undo];
  const current = snapshot('Current');
  const edit = beginCanvasLabelEdit('node:A', current, undo, []);
  undo.push(current);
  undo.shift();
  const restored = cancelCanvasLabelEdit(edit);
  assert.deepEqual(restored.undo, originals);
  assert.strictEqual(restored.undo[0], originals[0]);
  assert.equal(restored.undo.length, 80);

  // Subsequent undo/redo mutations must not mutate the saved transaction.
  restored.undo.pop();
  restored.redo.push(snapshot('Next'));
  assert.equal(edit.undo.length, 80);
  assert.equal(edit.redo.length, 0);
});

test('Enter and Escape finish editing only outside an input-method composition', () => {
  for (const key of ['Enter', 'Escape']) {
    assert.equal(canvasLabelKeyAction({ key, isComposing: true }), null);
    assert.equal(canvasLabelKeyAction({ key, isComposing: false, keyCode: 229 }), null);
    assert.equal(canvasLabelKeyAction({ key, isComposing: true, keyCode: 229 }), null);
  }
  assert.equal(canvasLabelKeyAction({ key: 'Enter', isComposing: false, keyCode: 13 }), 'commit');
  assert.equal(canvasLabelKeyAction({ key: 'Escape', isComposing: false, keyCode: 27 }), 'cancel');
  assert.equal(canvasLabelKeyAction({ key: 'a' }), null);
  assert.equal(canvasLabelKeyAction({ key: 'Tab' }), null);
});
