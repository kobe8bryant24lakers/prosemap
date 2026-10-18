import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseMermaidVisualSource, serializeMermaidVisualGraph } from '../lib/mermaid-workbench.ts';

const fixture = readFileSync(new URL('../docs/fixtures/complex-markdown.md', import.meta.url), 'utf8');
for (const newline of ['\n', '\r\n']) {
test(`all seven diagrams are editable and round-trip with ${newline === '\n' ? 'LF' : 'CRLF'} line endings`, () => {
  const text = fixture.replace(/\r?\n/g, newline);
  const diagrams = [...text.matchAll(/```mermaid\r?\n([\s\S]*?)\r?\n```/g)];
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
}
