import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMermaidVisualSource, serializeMermaidVisualGraph } from '../lib/mermaid-workbench.ts';
import { preserveMermaidSource } from '../lib/mermaid-source-preservation.ts';

const shapes = [
  ['rectangle', 'A["A"]'], ['rounded', 'A("A")'], ['terminal', 'A(["A"])'],
  ['decision', 'A{"A"}'], ['circle', 'A(("A"))'], ['database', 'A[("A")]'],
];

for (const [shape, declaration] of shapes) {
  for (const inline of [false, true]) {
    test(`${shape}: bare references preserve an ID-matching ${inline ? 'inline' : 'standalone'} declaration`, () => {
      const source = `flowchart LR\n  ${declaration}${inline ? ' --> B["Synthetic control"]' : '\n  A --> B["Synthetic control"]'}\n  B --> A\n  A`;
      const graph = parseMermaidVisualSource(source);
      assert.ok(graph);
      assert.deepEqual(graph.nodes.find(node => node.id === 'A'), { id: 'A', label: 'A', shape });
      assert.equal(parseMermaidVisualSource(serializeMermaidVisualGraph(graph)).nodes[0].shape, shape);
    });
  }
  test(`${shape}: the last explicit declaration may replace text with its own ID`, () => {
    const graph = parseMermaidVisualSource(`flowchart LR\n  A["Synthetic previous text"]\n  A --> B\n  ${declaration}\n  B --> A`);
    assert.deepEqual(graph.nodes.find(node => node.id === 'A'), { id: 'A', label: 'A', shape });
  });
}

test('a bare reference can assign a group without erasing the explicit shape', () => {
  const graph = parseMermaidVisualSource('flowchart LR\n  A(("A"))\n  subgraph Package["Synthetic group"]\n    A\n    B["Synthetic control"]\n  end\n  A --> B');
  assert.deepEqual(graph.nodes.find(node => node.id === 'A'), { id: 'A', label: 'A', shape: 'circle', data: { groupId: 'Package' } });
});

for (const newline of ['\n', '\r\n']) for (const target of ['node', 'edge']) {
  test(`${JSON.stringify(newline)} ${target} edit retains unrelated ID-matching shapes and bytes`, () => {
    const source = ['flowchart LR', '  A(["A"])', '  B[("B")]', '  A -->|Synthetic edge| B', '  B --> A'].join(newline);
    const before = parseMermaidVisualSource(source);
    const after = structuredClone(before);
    if (target === 'node') after.nodes[0].label = 'Synthetic replacement';
    else after.edges[0].label = 'Synthetic replacement';
    const expected = target === 'node' ? source.replace('A(["A"])', 'A(["Synthetic replacement"])') : source.replace('Synthetic edge', 'Synthetic replacement');
    assert.equal(preserveMermaidSource(source, before, after), expected);
  });
}
