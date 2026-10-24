import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMermaidVisualSource, serializeMermaidVisualGraph } from '../lib/mermaid-workbench.ts';
import { MermaidSourceHistory, preserveMermaidSource } from '../lib/mermaid-source-preservation.ts';

function requireGraph(source) {
  const graph = parseMermaidVisualSource(source);
  assert.ok(graph, source);
  return graph;
}

function withDetails(graph, id, details) {
  return { ...graph, nodes: graph.nodes.map(node => node.id === id ? { ...node, data: { ...node.data, details } } : node) };
}

for (const kind of ['class', 'er']) for (const eol of ['\n', '\r\n']) {
  test(`${kind} ${JSON.stringify(eol)}: duplicate member edits preserve noncanonical declaration order, comments, whitespace and history`, () => {
    const declaration = id => kind === 'class' ? `class ${id}` : id;
    const member = value => kind === 'class' ? `+String ${value}` : `string ${value}`;
    const head = [kind === 'class' ? 'classDiagram' : 'erDiagram', '  direction LR',
      kind === 'class' ? '  CUSTOMER --> ORDER : places' : '  CUSTOMER ||--o{ ORDER : places',
      kind === 'class' ? '  CUSTOMER --> ADDRESS : stores' : '  CUSTOMER ||--o{ ADDRESS : stores',
      '', '  %% Keep customer before address before order', `  ${declaration('CUSTOMER')} {`];
    const tail = ['  }', '', '  %% Do not swap ADDRESS and ORDER',
      `  ${declaration('ADDRESS')} {`, `    ${member('id')}`, '  }',
      `  ${declaration('ORDER')} {`, `    ${member('id')}`, '  }', ''];
    const render = values => [...head, `    ${values[0]}`, '    %% Member comment stays at this boundary', '',
      ...values.slice(1).map(value => `    ${value}`), ...tail].join(eol);
    let members = ['id', 'email', 'name', 'created'].map(member);
    const original = render(members);
    let source = original;
    let graph = requireGraph(source);
    const originalGraph = graph;
    assert.deepEqual(graph.nodes.map(node => node.id), ['CUSTOMER', 'ORDER', 'ADDRESS']);
    const history = new MermaidSourceHistory();
    for (let index = 0; index < 8; index++) {
      members = [...members, member('new_field')];
      const next = withDetails(graph, 'CUSTOMER', members);
      source = history.commit(source, graph, next);
      assert.equal(source, render(members), `addition ${index + 1} must not canonicalize unrelated declarations`);
      graph = next;
    }
    for (const [index, value] of [[0, member('客户编号')], [5, member('balance_amount')], [11, member('备注')]]) {
      members = members.map((detail, at) => at === index ? value : detail);
      const next = withDetails(graph, 'CUSTOMER', members);
      source = history.commit(source, graph, next);
      assert.equal(source, render(members), `editing duplicate row ${index + 1} must remain localized`);
      assert.equal(serializeMermaidVisualGraph(requireGraph(source)), serializeMermaidVisualGraph(next));
      graph = next;
    }
    assert.equal(history.commit(source, graph, originalGraph), original);
    assert.equal(history.commit(original, originalGraph, graph), source);
    const fewer = [...members.slice(0, 6), ...members.slice(7)];
    assert.equal(preserveMermaidSource(source, graph, withDetails(graph, 'CUSTOMER', fewer)), render(fewer));
  });
}

test('members in two unique blocks can change together without moving declarations or their comments', () => {
  const source = 'erDiagram\n A ||--o{ B : owns\n B {\n   string id\n   %% keep here\n   string repeated\n   string repeated\n }\n\n A {\n   string id\n }\n';
  const before = requireGraph(source);
  const after = withDetails(withDetails(before, 'B', ['string id', 'string changed', 'string repeated']), 'A', ['string id', 'string added']);
  const expected = source.replace('string repeated', 'string changed').replace(' A {\n   string id\n', ' A {\n   string id\n   string added\n');
  assert.equal(preserveMermaidSource(source, before, after), expected);
});

test('removing every member preserves the unique empty block and comments', () => {
  const source = 'classDiagram\n class A {\n   %% still belongs to A\n   +String value\n\n }\n class B\n';
  const before = requireGraph(source);
  const empty = withDetails(before, 'A', []);
  const expected = source.replace('   +String value\n', '');
  assert.equal(preserveMermaidSource(source, before, empty), expected);
  const refilled = withDetails(empty, 'A', ['+String newValue']);
  assert.equal(preserveMermaidSource(expected, empty, refilled), expected.replace('\n }\n class B', '\n   +String newValue\n }\n class B'));
});

test('split class member declarations are not guessed by the unique-block optimization', () => {
  const source = 'classDiagram\n class A {\n   +String first\n }\n A : +String second\n class B\n';
  const before = requireGraph(source);
  const after = withDetails(before, 'A', ['+String first', '+String changed', '+String added']);
  const result = preserveMermaidSource(source, before, after);
  assert.equal(serializeMermaidVisualGraph(requireGraph(result)), serializeMermaidVisualGraph(after));
});
