import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseMermaidVisualSource, serializeMermaidVisualGraph } from '../lib/mermaid-workbench.ts';

test('all seven diagrams in the complex Markdown fixture are editable and round-trip', () => {
  const text = readFileSync(new URL('../docs/fixtures/complex-markdown.md', import.meta.url), 'utf8');
  const diagrams = [...text.matchAll(/```mermaid\n([\s\S]*?)\n```/g)];
  assert.equal(diagrams.length, 7);
  for (const [, source] of diagrams) {
    const graph = parseMermaidVisualSource(source);
    assert.ok(graph, source.split('\n')[0]);
    const serialized = serializeMermaidVisualGraph(graph);
    const restored = parseMermaidVisualSource(serialized);
    assert.ok(restored);
    assert.equal(serializeMermaidVisualGraph(restored), serialized);
    assert.equal(restored.nodes.length, graph.nodes.length);
    assert.equal(restored.edges.length, graph.edges.length);
  }
});
