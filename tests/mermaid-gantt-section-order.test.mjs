import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMermaidVisualSource, serializeMermaidVisualGraph } from '../lib/mermaid-workbench.ts';
import { MermaidSourceHistory, preserveMermaidSource } from '../lib/mermaid-source-preservation.ts';

const source = `gantt
  title SYNTHETIC grouped tasks
  dateFormat YYYY-MM-DD
  section Synthetic Alpha
  Alpha one :done, a1, 2026-01-01, 1d
  Alpha two :a2, after a1, 1d
  section Synthetic Beta
  Beta one :b1, 2026-01-01, 2d
  Beta two :b2, after b1, 1d`;
const copiedLine = '  Alpha one copy :done, Task5, 2026-01-01, 1d';
const secondLine = '  Alpha two :a2, after a1, 1d';
function duplicate(graph) {
  const node = graph.nodes[0];
  return { ...graph, nodes: [...graph.nodes, { ...node, id: 'Task5', label: 'Alpha one copy', data: { ...node.data, ref: 'Task5' } }] };
}
const semantics = graph => ({
  nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
  dependencies: graph.edges.map(edge => [edge.from, edge.to]).sort(),
});

test('a duplicated task serializes beside its section without changing scheduling or the input graph', () => {
  const before = parseMermaidVisualSource(source), after = duplicate(before);
  const snapshot = JSON.stringify(after);
  const result = serializeMermaidVisualGraph(after);
  assert.equal(result, source.replace(secondLine, `${secondLine}\n${copiedLine}`));
  assert.deepEqual(semantics(parseMermaidVisualSource(result)), semantics(after));
  assert.equal(JSON.stringify(after), snapshot);
});

for (const eol of ['\n', '\r\n', '\r']) {
  test(`duplicating into an earlier section preserves unrelated bytes and history for ${JSON.stringify(eol)}`, () => {
    const original = source.replace('  section Synthetic Beta', '  %% SYNTHETIC boundary comment\n  section Synthetic Beta').split('\n').join(eol) + eol;
    const before = parseMermaidVisualSource(original), after = duplicate(before);
    const expected = original.replace(secondLine, `${secondLine}${eol}${copiedLine}`);
    assert.equal(preserveMermaidSource(original, before, after), expected);
    const history = new MermaidSourceHistory();
    assert.equal(history.commit(original, before, after), expected);
    assert.equal(history.commit(expected, after, before), original);
    assert.equal(history.commit(original, before, after), expected);
  });
}

test('moving a task to an existing section keeps both groups contiguous and dependencies unchanged', () => {
  const before = parseMermaidVisualSource(source);
  const after = { ...before, nodes: before.nodes.map(node => node.id === 'b2' ? { ...node, data: { ...node.data, ganttSection: 'Synthetic Alpha' } } : node) };
  const result = preserveMermaidSource(source, before, after);
  const reparsed = parseMermaidVisualSource(result);
  assert.deepEqual(reparsed.nodes.map(node => node.id), ['a1', 'a2', 'b2', 'b1']);
  assert.deepEqual(semantics(reparsed), semantics(after));
  assert.equal(result.match(/section Synthetic Alpha/g).length, 1);
});

test('ungrouped tasks remain before named sections and prototype-like names are distinct groups', () => {
  const before = parseMermaidVisualSource(source);
  const sections = ['__proto__', '', 'constructor', '__proto__'];
  const after = { ...before, nodes: before.nodes.map((node, index) => ({ ...node, data: { ...node.data, ganttSection: sections[index] } })) };
  const result = serializeMermaidVisualGraph(after), reparsed = parseMermaidVisualSource(result);
  assert.deepEqual(reparsed.nodes.map(node => node.id), ['a2', 'a1', 'b2', 'b1']);
  assert.deepEqual(semantics(reparsed), semantics(after));
  assert.equal(result.match(/section __proto__/g).length, 1);
  assert.ok(!result.includes('section \n'));
});

for (const eol of ['\n', '\r\n', '\r']) {
  for (const finalNewline of [false, true]) {
    test(`moving the last task preserves exact source and final newline for ${JSON.stringify(eol)} / ${finalNewline}`, () => {
      const original = source.split('\n').join(eol) + (finalNewline ? eol : '');
      const before = parseMermaidVisualSource(original);
      const after = { ...before, nodes: before.nodes.map(node => node.id === 'b2' ? { ...node, data: { ...node.data, ganttSection: 'Synthetic Alpha' } } : node) };
      const task = '  Beta two :b2, after b1, 1d';
      const expected = original.replace(eol + task, '').replace('  section Synthetic Beta', task + eol + '  section Synthetic Beta');
      assert.equal(preserveMermaidSource(original, before, after), expected);
      const history = new MermaidSourceHistory();
      assert.equal(history.commit(original, before, after), expected);
      assert.equal(history.commit(expected, after, before), original);
      assert.equal(history.commit(original, before, after), expected);
    });
  }
}
