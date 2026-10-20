import assert from 'node:assert/strict';
import test from 'node:test';
import { sequenceCanvasResizeUpdate } from '../lib/canvas-resize.ts';
import { expandedMermaidCanvasStage, mermaidSequenceLifelineHeight } from '../lib/mermaid-canvas-layout.ts';

const participant = { id: 'A', label: 'A', shape: 'rectangle', data: { sequenceType: 'participant' } };
const stage = { width: 1440, height: 460 };
const position = { x: 600, y: 58 };
const implicitHeight = mermaidSequenceLifelineHeight(participant, stage.height, position.y);

test('horizontal handles leave implicit lifelines implicit and keep stage height unchanged', () => {
  for (const handle of ['west', 'east']) {
    const updated = sequenceCanvasResizeUpdate(participant, handle, { position, size: { width: 234, height: implicitHeight } }, stage);
    assert.equal(updated.node.data.canvasWidth, 234);
    assert.equal(updated.node.data.canvasLifelineHeight, undefined);
    assert.equal(updated.height, stage.height);
    const graph = { kind: 'sequence', direction: 'LR', nodes: [updated.node], edges: [] };
    assert.equal(expandedMermaidCanvasStage(graph, { A: position }, updated).height, stage.height);
    assert.equal(mermaidSequenceLifelineHeight(updated.node, 800, position.y), 800 - position.y - 25);
  }
});

test('horizontal resizing preserves an explicitly customized lifeline length', () => {
  const node = { ...participant, data: { ...participant.data, canvasLifelineHeight: 250 } };
  const updated = sequenceCanvasResizeUpdate(node, 'east', { position, size: { width: 250, height: 250 } }, stage);
  assert.equal(updated.node.data.canvasLifelineHeight, 250);
  assert.equal(updated.height, stage.height);
});

test('bottom handle changes lifeline length without making the participant width explicit', () => {
  const updated = sequenceCanvasResizeUpdate(participant, 'south', { position, size: { width: 174, height: 700 } }, stage);
  assert.equal(updated.node.data.canvasWidth, undefined);
  assert.equal(updated.node.data.canvasLifelineHeight, 700);
  assert.equal(updated.width, stage.width);
  assert.ok(updated.height >= position.y + 700);
});

test('corner handles update both dimensions and grow only as required', () => {
  for (const handle of ['south-west', 'south-east']) {
    const updated = sequenceCanvasResizeUpdate(participant, handle,
      { position: { x: 1400, y: 58 }, size: { width: 400, height: 800 } }, stage);
    assert.equal(updated.node.data.canvasWidth, 400);
    assert.equal(updated.node.data.canvasLifelineHeight, 800);
    assert.ok(updated.width >= 1800);
    assert.ok(updated.height >= 858);
  }
});

test('horizontal changes to multiple implicit participants do not ratchet the stage height', () => {
  let currentStage = stage;
  for (let index = 0; index < 10; index++) {
    const node = { ...participant, id: `A${index}` };
    const result = sequenceCanvasResizeUpdate(node, 'east', {
      position,
      size: { width: 200, height: mermaidSequenceLifelineHeight(node, currentStage.height, position.y) },
    }, currentStage);
    currentStage = { width: result.width, height: result.height };
  }
  assert.deepEqual(currentStage, stage);
});
