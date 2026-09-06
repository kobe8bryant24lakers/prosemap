import assert from 'node:assert/strict';
import test from 'node:test';
import { MERMAID_TEMPLATES, parseMermaidVisualSource } from '../lib/mermaid-workbench.ts';
import { layoutMermaidGraph, mermaidCanvasNodeSize, mermaidGroupBounds } from '../lib/mermaid-canvas-layout.ts';

test('package and system boundaries enclose members without swallowing unrelated nodes', () => {
  for (const id of ['usecase', 'package']) {
    const graph = parseMermaidVisualSource(MERMAID_TEMPLATES.find((entry) => entry.id === id).source);
    const layout = layoutMermaidGraph(graph);
    const bounds = mermaidGroupBounds(graph, layout.positions);
    for (const node of graph.nodes) {
      const point = layout.positions[node.id];
      const size = mermaidCanvasNodeSize(node, graph.kind);
      assert.ok(point && Number.isFinite(point.x) && Number.isFinite(point.y));
      const ancestors = new Set();
      let parent = node.data?.groupId;
      while (parent) {
        ancestors.add(parent);
        parent = graph.data.groups.find((group) => group.id === parent)?.parentId;
      }
      for (const [groupId, box] of Object.entries(bounds)) {
        if (ancestors.has(groupId)) {
          assert.ok(point.x >= box.minX && point.y >= box.minY && point.x + size.width <= box.maxX && point.y + size.height <= box.maxY, `${id}: ${node.id} inside ${groupId}`);
        } else {
          assert.ok(point.x + size.width <= box.minX || point.x >= box.maxX || point.y + size.height <= box.minY || point.y >= box.maxY, `${id}: ${node.id} outside ${groupId}`);
        }
      }
    }
  }
});

test('empty nested packages remain visible and boundaries follow dragged nodes', () => {
  const graph = parseMermaidVisualSource('flowchart TB\nsubgraph App["应用"]\nsubgraph Empty["空包"]\nend\nN["模块"]\nend');
  const layout = layoutMermaidGraph(graph);
  const before = mermaidGroupBounds(graph, layout.positions);
  assert.ok(before.Empty.maxX > before.Empty.minX);
  assert.ok(before.App.minX < before.Empty.minX && before.App.maxX > before.Empty.maxX);
  layout.positions.N.x += 300;
  const after = mermaidGroupBounds(graph, layout.positions);
  assert.ok(after.App.maxX > before.App.maxX);
});
