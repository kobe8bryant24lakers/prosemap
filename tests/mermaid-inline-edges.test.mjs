import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMermaidVisualSource, serializeMermaidVisualGraph } from '../lib/mermaid-workbench.ts';

for (const arrow of ['-->', '---', '-.->', '==>']) {
  test(`inline ${arrow} distinguishes quoted node text from the real edge`, () => {
    const source = `flowchart LR\n  A["入口 --> (保留)"] ${arrow}|路线| B["出口 --- [保留]"]`;
    const graph = parseMermaidVisualSource(source);
    assert.deepEqual(graph.nodes.map(n => [n.id, n.label]), [['A', '入口 --> (保留)'], ['B', '出口 --- [保留]']]);
    assert.equal(graph.edges.length, 1);
    assert.equal(graph.edges[0].label, '路线');
    assert.deepEqual(parseMermaidVisualSource(serializeMermaidVisualGraph(graph)), graph);
  });
}
test('text-style edge label remains distinct from arrow text in both endpoint labels', () => {
  const graph = parseMermaidVisualSource('flowchart LR\n  A["入口 -- 本文 -->"] -- 关系 --> B(["出口 --> 保留"])');
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges[0].label, '关系');
  assert.equal(graph.nodes[1].label, '出口 --> 保留');
});

for (const line of ['A[a] --> B[b] --> C[c]', 'A["a"] --> B["b"] --> C["c"]', 'A[a] B[b]', 'A["unclosed]', 'A[(mismatch]]']) {
  test(`unsupported or malformed endpoints never swallow syntax: ${line}`, () => {
    assert.equal(parseMermaidVisualSource(`flowchart LR\n  ${line}`), null);
  });
}
test('an apostrophe within an unquoted label does not consume its outgoing edge', () => {
  const graph = parseMermaidVisualSource("flowchart LR\n  A[don't stop] --> B[ready]");
  assert.equal(graph.nodes[0].label, "don't stop");
  assert.equal(graph.edges.length, 1);
});
test('a quoted trailing backslash does not escape Mermaid closing quotes', () => {
  const graph = parseMermaidVisualSource('flowchart LR\n  A["path\\"] --> B[ready]');
  assert.equal(graph.nodes[0].label, 'path\\');
  assert.equal(graph.edges.length, 1);
});
