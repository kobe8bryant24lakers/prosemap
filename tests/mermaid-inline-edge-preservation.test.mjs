import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMermaidVisualSource, serializeMermaidVisualGraph } from '../lib/mermaid-workbench.ts';
import { MermaidSourceHistory, preserveMermaidSource } from '../lib/mermaid-source-preservation.ts';

function relabel(source, label = 'Synthetic replacement') {
  const before = parseMermaidVisualSource(source);
  assert.ok(before);
  const after = { ...before, edges: before.edges.map((edge, index) => index === 0 ? { ...edge, label } : edge) };
  return { before, after, actual: preserveMermaidSource(source, before, after) };
}

for (const [ending, eols] of [['LF', ['\n']], ['CRLF', ['\r\n']], ['CR', ['\r']], ['mixed', ['\r\n', '\n', '\r']]]) {
  for (const connector of ['-->|Synthetic edge|', '---|Synthetic edge|', '-.->|Synthetic edge|', '==>|Synthetic edge|', '-- Synthetic edge -->']) {
    test(`${ending} ${connector}: edge text changes without rewriting inline node declarations or unrelated bytes`, () => {
      const source = ['graph LR', '  %% SYNTHETIC: Synthetic edge stays in this comment',
        '\tsubgraph Box["Synthetic edge"]', `    A(["Synthetic --> node"])  ${connector} B[("Synthetic edge")]  `,
        '\tend', '  B --> A', ''].map((line, index, lines) => line + (index === lines.length - 1 ? '' : eols[index % eols.length])).join('');
      const { before, after, actual } = relabel(source);
      const expected = source.replace(connector, connector.replace('Synthetic edge', 'Synthetic replacement'));
      assert.equal(actual, expected);
      assert.equal(serializeMermaidVisualGraph(parseMermaidVisualSource(actual)), serializeMermaidVisualGraph(after));
      const history = new MermaidSourceHistory();
      history.reset(before, source);
      assert.equal(history.commit(source, before, after), expected);
      assert.equal(history.commit(expected, after, before), source);
      assert.equal(history.commit(source, before, after), expected);
    });
  }
}

for (const quoted of ['"Synthetic edge"', "'Synthetic edge'", '  Synthetic edge  ']) {
  test(`pipe labels retain their original quoting and padding: ${quoted}`, () => {
    const source = `flowchart LR\n A["Synthetic A"] -->|${quoted}| B["Synthetic B"]\n`;
    assert.equal(relabel(source).actual, source.replace('Synthetic edge', 'Synthetic replacement'));
  });
}

for (const connector of ['-->', '---', '-.->', '==>']) {
  test(`${connector}: adding and removing an inline label preserves endpoints and whitespace`, () => {
    const source = `graph LR\r\n\tA("Synthetic A")\t${connector} B{"Synthetic B"}  \r\n`;
    const labelled = relabel(source);
    assert.equal(labelled.actual, source.replace(connector, `${connector}|Synthetic replacement|`));
    assert.equal(relabel(labelled.actual, '').actual, source);
  });
}

test('an empty padded pipe label keeps each original space only once', () => {
  const source = 'flowchart LR\n A["Synthetic A"] -->|   | B["Synthetic B"]\n';
  assert.equal(relabel(source).actual, source.replace('|   |', '|   Synthetic replacement|'));
});

test('removing text-form labels changes only their connector into an unlabelled arrow', () => {
  const source = 'graph LR\n  A(["Synthetic A"])\t-- Synthetic edge -->   B[("Synthetic B")]\n';
  assert.equal(relabel(source, '').actual, source.replace('-- Synthetic edge -->', '-->'));
});

test('distinct repeated endpoints target the requested edge, leaving lookalike labels alone', () => {
  const source = 'flowchart LR\n A["Synthetic edge"] -->|Synthetic edge| B["Synthetic B"]\n A -->|Synthetic second| B\n';
  assert.equal(relabel(source).actual, source.replace('|Synthetic edge|', '|Synthetic replacement|'));
});

test('identical parallel edge spellings retain the explicit canonical fallback', () => {
  const source = 'graph LR\n  A["Synthetic A"] -->|Synthetic edge| B["Synthetic B"]\n  %% SYNTHETIC separate context\n  A -->|Synthetic edge| B\n';
  const { after, actual } = relabel(source);
  assert.equal(actual, serializeMermaidVisualGraph(after));
});

test('several uniquely mapped labels can change together without shifting later offsets', () => {
  const source = 'graph LR\n A["Synthetic A"] -->|Synthetic one| B["Synthetic B"]\n B -->|Synthetic two| C["Synthetic C"]\n';
  const before = parseMermaidVisualSource(source);
  const after = { ...before, edges: before.edges.map((edge, index) => ({ ...edge, label: index ? 'Synthetic much longer second' : 'Short' })) };
  assert.equal(preserveMermaidSource(source, before, after), source.replace('Synthetic one', 'Short').replace('Synthetic two', 'Synthetic much longer second'));
});
