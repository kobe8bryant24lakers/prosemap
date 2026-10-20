import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANVAS_CONNECTION_MESSAGES,
  canvasConnectionIssue,
  connectionWouldCycle,
  validCanvasConnectionTarget,
} from '../lib/canvas-connection.ts';
import { translate } from '../lib/i18n.ts';

const node = (id, data) => ({ id, label: id, shape: 'rectangle', ...(data ? { data } : {}) });
const edge = (from, to) => ({ id: `${from}-${to}`, from, to, label: '', style: 'arrow' });
const graph = (kind, nodes = ['A', 'B', 'C', 'D'].map((id) => node(id)), edges = []) => ({ kind, direction: 'LR', nodes, edges });

test('state pseudo-nodes explain direction and occupied-connection restrictions separately', () => {
  const states = graph('state', [
    node('Start', { stateRole: 'start' }),
    node('End', { stateRole: 'end' }),
    node('A', { stateRole: 'state' }),
    node('B', { stateRole: 'state' }),
  ]);
  assert.equal(canvasConnectionIssue(states, 'A', 'Start'), 'state-start-target');
  assert.equal(canvasConnectionIssue(states, 'End', 'A'), 'state-end-source');
  assert.equal(canvasConnectionIssue(states, 'Start', 'A'), null);
  assert.equal(canvasConnectionIssue(states, 'A', 'End'), null);
  assert.equal(canvasConnectionIssue(states, 'A', 'A'), null);

  states.edges = [edge('Start', 'A'), edge('A', 'End')];
  assert.equal(canvasConnectionIssue(states, 'Start', 'B'), 'state-start-connected');
  assert.equal(canvasConnectionIssue(states, 'B', 'End'), 'state-end-connected');
  assert.equal(canvasConnectionIssue(states, 'B', 'A'), null);
});

test('mind-map branches can be reparented but cannot attach to themselves or descendants', () => {
  const mindmap = graph('mindmap', undefined, [edge('A', 'B'), edge('B', 'C'), edge('A', 'D')]);
  const snapshot = structuredClone(mindmap);
  assert.equal(canvasConnectionIssue(mindmap, 'B', 'B'), 'mindmap-self');
  assert.equal(canvasConnectionIssue(mindmap, 'C', 'A'), 'mindmap-cycle');
  assert.equal(canvasConnectionIssue(mindmap, 'C', 'B'), 'mindmap-cycle');
  assert.equal(canvasConnectionIssue(mindmap, 'D', 'B'), null);
  // Reconnecting to the same parent remains a permitted reparent operation.
  assert.equal(canvasConnectionIssue(mindmap, 'A', 'B'), null);
  assert.deepEqual(mindmap, snapshot);
});

test('Gantt dependencies reject self, indirect cycles and existing dependency independently', () => {
  const gantt = graph('gantt', undefined, [edge('A', 'B'), edge('B', 'C')]);
  assert.equal(canvasConnectionIssue(gantt, 'A', 'A'), 'gantt-self');
  assert.equal(canvasConnectionIssue(gantt, 'C', 'A'), 'gantt-cycle');
  assert.equal(canvasConnectionIssue(gantt, 'A', 'B'), 'gantt-duplicate');
  assert.equal(canvasConnectionIssue(gantt, 'C', 'D'), null);
});

test('other diagram types preserve self-connection and parallel-connection support', () => {
  for (const kind of ['flowchart', 'sequence', 'state', 'class', 'er']) {
    const diagram = graph(kind, undefined, [edge('A', 'B')]);
    assert.equal(canvasConnectionIssue(diagram, 'A', 'A'), null, kind);
    assert.equal(canvasConnectionIssue(diagram, 'A', 'B'), null, kind);
    assert.equal(canvasConnectionIssue(diagram, 'B', 'A'), null, kind);
  }
});

test('hover highlighting rejects invalid targets without losing the reason used on drop', () => {
  const gantt = graph('gantt', undefined, [edge('A', 'B'), edge('B', 'C')]);
  for (const [from, target, reason] of [
    ['A', 'A', 'gantt-self'],
    ['C', 'A', 'gantt-cycle'],
    ['A', 'B', 'gantt-duplicate'],
    ['A', 'Deleted', 'missing-node'],
  ]) {
    assert.equal(validCanvasConnectionTarget(gantt, from, target), null);
    assert.equal(canvasConnectionIssue(gantt, from, target), reason);
  }
  assert.equal(validCanvasConnectionTarget(gantt, 'C', 'D'), 'D');
  assert.equal(validCanvasConnectionTarget(gantt, 'C', null), null);
  assert.equal(canvasConnectionIssue(gantt, 'Deleted', 'A'), 'missing-node');
});

test('cycle traversal terminates with an unrelated existing cycle', () => {
  const edges = [edge('A', 'B'), edge('B', 'A'), edge('C', 'D')];
  assert.equal(connectionWouldCycle(edges, 'D', 'C'), true);
  assert.equal(connectionWouldCycle(edges, 'C', 'A'), false);
});

test('every connection rejection has concise Chinese and translated English feedback', () => {
  for (const message of Object.values(CANVAS_CONNECTION_MESSAGES)) {
    assert.equal(translate(message, 'zh-CN'), message);
    assert.notEqual(translate(message, 'en'), message, message);
    assert.ok(message.length <= 30, message);
  }
});
