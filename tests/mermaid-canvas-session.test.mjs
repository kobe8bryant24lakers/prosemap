import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMermaidVisualSource } from '../lib/mermaid-workbench.ts';
import {
  activateMermaidCanvasDraft,
  commitMermaidCanvasGraph,
  createMermaidCanvasSession,
  updateMermaidCanvasDraft,
} from '../lib/mermaid-canvas-session.ts';

const source = 'flowchart LR\n A[Start] --> B[End]';

test('temporarily invalid source retains the same mounted canvas graph', () => {
  const graph = parseMermaidVisualSource(source);
  const original = createMermaidCanvasSession(graph);
  const invalid = updateMermaidCanvasDraft(original, null);
  assert.equal(invalid.graph, null);
  assert.equal(invalid.canvasGraph, graph);
  assert.equal(activateMermaidCanvasDraft(invalid), invalid);
  const restored = activateMermaidCanvasDraft(updateMermaidCanvasDraft(invalid, parseMermaidVisualSource(source)));
  assert.equal(restored.canvasGraph, graph);
  assert.equal(restored.externalRevision, 0);
});

test('temporarily valid partial source does not remove nodes from the mounted canvas', () => {
  const graph = parseMermaidVisualSource(source);
  let session = createMermaidCanvasSession(graph);
  session = updateMermaidCanvasDraft(session, parseMermaidVisualSource('flowchart LR\n A[Start]'));
  assert.equal(session.graph.nodes.length, 1);
  assert.equal(session.canvasGraph, graph);
  assert.equal(session.canvasGraph.nodes.length, 2);
  session = updateMermaidCanvasDraft(session, parseMermaidVisualSource(source));
  assert.equal(activateMermaidCanvasDraft(session).canvasGraph, graph);
});

test('returning to a changed valid source creates exactly one external history boundary', () => {
  const graph = parseMermaidVisualSource(source);
  let session = createMermaidCanvasSession(graph);
  session = updateMermaidCanvasDraft(session, parseMermaidVisualSource(source.replace('Start', 'Sta')));
  session = updateMermaidCanvasDraft(session, parseMermaidVisualSource(source.replace('Start', 'Started')));
  assert.equal(session.externalRevision, 0);
  assert.equal(session.canvasGraph, graph);
  session = activateMermaidCanvasDraft(session);
  assert.equal(session.canvasGraph.nodes[0].label, 'Started');
  assert.equal(session.externalRevision, 1);
  assert.equal(activateMermaidCanvasDraft(session), session);
});

test('canvas edits and repeated tab visits preserve the canvas history boundary', () => {
  let session = createMermaidCanvasSession(parseMermaidVisualSource(source));
  session = activateMermaidCanvasDraft(updateMermaidCanvasDraft(session, parseMermaidVisualSource(source.replace('Start', 'External'))));
  const edited = { ...session.canvasGraph, nodes: session.canvasGraph.nodes.map((node, index) => index ? node : { ...node, label: 'Canvas edit' }) };
  session = commitMermaidCanvasGraph(session, edited);
  assert.equal(session.graph, edited);
  assert.equal(session.canvasGraph, edited);
  assert.equal(session.externalRevision, 1);
  assert.equal(activateMermaidCanvasDraft(session), session);
});

test('an initially unsupported source can acquire a canvas once valid', () => {
  let session = createMermaidCanvasSession(null);
  session = updateMermaidCanvasDraft(session, parseMermaidVisualSource(source));
  assert.equal(session.canvasGraph, null);
  session = activateMermaidCanvasDraft(session);
  assert.equal(session.canvasGraph.nodes.length, 2);
  assert.equal(session.externalRevision, 1);
});

test('choosing a new template replaces the retained graph and resets its session', () => {
  let session = createMermaidCanvasSession(parseMermaidVisualSource(source));
  session = activateMermaidCanvasDraft(updateMermaidCanvasDraft(session, parseMermaidVisualSource(source.replace('Start', 'External'))));
  const template = parseMermaidVisualSource('sequenceDiagram\nparticipant A\nparticipant B\nA->>B: Hello');
  session = createMermaidCanvasSession(template);
  assert.equal(session.graph, template);
  assert.equal(session.canvasGraph, template);
  assert.equal(session.externalRevision, 0);
});
