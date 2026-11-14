import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parseMermaidVisualSource, serializeMermaidVisualGraph } from '../lib/mermaid-workbench.ts';
import { MermaidSourceHistory, preserveMermaidSource } from '../lib/mermaid-source-preservation.ts';

const manifest = JSON.parse(readFileSync(new URL('./fixtures/manifest.json', import.meta.url), 'utf8'));

for (const kind of ['class', 'er']) {
  for (const ending of ['LF', 'CRLF', 'CR', 'mixed']) {
    for (const removedId of ['Original', '副本_2']) {
      test(`${kind}: reopened aliased blocks with repeated members preserve ${ending} bytes when deleting ${removedId}`, () => {
        const keyword = kind === 'class' ? 'class ' : '';
        const member = kind === 'class' ? '+String id' : 'string id PK';
        const lines = ['', kind === 'class' ? 'classDiagram' : 'erDiagram',
          '   %% SYNTHETIC header stays here', '   direction TB',
          `   ${keyword}Original["SYNTHETIC original"] {`, `      ${member}`, '   }',
          '   %% SYNTHETIC between declarations',
          `   ${keyword}副本_2["SYNTHETIC original copy"] {`, `      ${member}`, '   }',
          '   %% SYNTHETIC tail stays here', '', ''];
        const endings = ending === 'mixed' ? ['\r\n', '\r', '\n']
          : [ending === 'LF' ? '\n' : ending === 'CRLF' ? '\r\n' : '\r'];
        const rawLines = lines.map((line, index) => line + (index === lines.length - 1 ? '' : endings[index % endings.length]));
        const source = rawLines.join('');
        // Parsing starts a fresh graph, as reopening a saved diagram does;
        // no MermaidSourceHistory snapshot can restore the old spelling.
        const before = parseMermaidVisualSource(source);
        assert.ok(before);
        assert.equal(before.nodes.length, 2);
        const after = { ...before, nodes: before.nodes.filter(node => node.id !== removedId) };
        const start = removedId === 'Original' ? 4 : 8;
        const expected = rawLines.filter((_line, index) => index < start || index >= start + 3).join('');
        const actual = preserveMermaidSource(source, before, after);
        assertGraph(actual, after);
        assert.equal(actual, expected, 'only the selected declaration block may be removed');
      });
    }
  }
}

for (const entry of manifest.files.filter(f => f.category === 'editable-diagram')) {
  test(`${entry.template}: rename preserves all unrelated source and history restores exact bytes`, () => {
    const markdown = readFileSync(new URL(`./fixtures/${entry.path}`, import.meta.url), 'utf8');
    const source = markdown.match(/```mermaid\n([\s\S]*?)\n```/)[1];
    const graph = parseMermaidVisualSource(source);
    const node = graph.nodes.find(n => !n.data?.stateRole || n.data.stateRole === 'state');
    const renamed = { ...graph, nodes: graph.nodes.map(n => n === node ? { ...n, label: '验收_中文🧭' } : n) };
    const actual = preserveMermaidSource(source, graph, renamed);
    assert.equal(serializeMermaidVisualGraph(parseMermaidVisualSource(actual)), serializeMermaidVisualGraph(renamed));
    // Identifier-based ER/class aliases may need a declaration; all other
    // labels already appear literally in these complex fixtures.
    if (entry.kind !== 'er' && entry.kind !== 'class') assert.equal(actual, source.replace(node.label, '验收_中文🧭'));
    const history = new MermaidSourceHistory();
    assert.equal(history.commit(source, graph, renamed), actual);
    assert.equal(history.commit(actual, renamed, graph), source);
    assert.equal(history.commit(source, graph, renamed), actual);
  });
}

test('CRLF, blank lines, comments and quoted lookalikes survive a label edit', () => {
  const source = 'flowchart TD\r\n\r\n  %% 用户注释\r\n  A["旧名称"]\r\n  B["不动"]\r\n  A --> B\r\n';
  const before = parseMermaidVisualSource(source);
  const after = { ...before, nodes: before.nodes.map(n => n.id === 'A' ? { ...n, label: '新名称' } : n) };
  assert.equal(preserveMermaidSource(source, before, after), source.replace('旧名称', '新名称'));
});

const deletions = {
  'basic-flowchart': ['  End(["结束"])', '  Result --> End', '  Error --> End'],
  'four-plus-one': ['  Storage[("共享数据存储")]', '  ZoneA --> Storage', '  ZoneB --> Storage'],
  architecture: ['  External["外部支付系统"]', '  Billing --> External', '  External -.->|支付回调| Billing'],
  sequence: ['  participant Audit as 审计服务', '      API->>Audit: 记录操作', '      Audit-->>API: 已归档'],
  state: ['  state "已归档" as Archived', '  Published --> Archived: 到期归档', '  Archived --> [*]'],
  class: ['  class PaymentGateway {\n    +charge(amount) bool\n  }', '  Payment ..> PaymentGateway : 调用'],
  er: ['  ORDER ||--o| PAYMENT : receives', '  PAYMENT {\n    string id PK\n    string order_id FK\n    string provider_ref UK\n    decimal amount\n  }'],
  mindmap: ['      accept["验收阶段"]'],
  gantt: ['  交付里程碑 :milestone, launch, after release, 0d'],
  usecase: ['    Audit(["审查交易"])', '  Admin --- Audit'],
  package: ['      Events["事件发布"]', '  Orders -.->|依赖| Events', '  Events -.->|依赖| Gateway'],
};

function assertGraph(actual, expected) {
  const parsed = parseMermaidVisualSource(actual);
  assert.ok(parsed, 'patched source must parse as a complete editable graph');
  assert.equal(serializeMermaidVisualGraph(parsed), serializeMermaidVisualGraph(expected));
}

function assertLinesRetained(original, actual) {
  const remaining = actual.split(/\r?\n/);
  let at = 0;
  for (const line of original.split(/\r?\n/)) {
    const found = remaining.indexOf(line, at);
    assert.ok(found >= 0, `unrelated source line was changed or reordered: ${line}`);
    at = found + 1;
  }
}

for (const entry of manifest.files.filter(f => f.category === 'editable-diagram')) {
  const markdown = readFileSync(new URL(`./fixtures/${entry.path}`, import.meta.url), 'utf8');
  const fixture = markdown.match(/```mermaid\n([\s\S]*?)\n```/)[1];
  for (const eol of ['\n', '\r\n']) {
    const decorate = value => {
      const lines = value.split('\n');
      lines.splice(1, 0, '', '   %% header comment remains here');
      lines.push('', '   %% final comment remains here', '');
      return lines.map(line => line.replace(/^ +/, spaces => ' '.repeat(spaces.length * 2))).join(eol);
    };
    const source = decorate(fixture);
    const before = parseMermaidVisualSource(source);
    assert.ok(before);
    test(`${entry.template}: structural addition retains unrelated ${eol === '\n' ? 'LF' : 'CRLF'} bytes and declaration order`, () => {
      const statement = {
        flowchart: '  AddedNode["新节点 🧭"]', sequence: '  participant AddedNode as 新参与者',
        state: '  state "新状态" as AddedNode', class: '  class AddedNode {\n    +String id\n    +run() void\n  }',
        er: '  AddedNode {\n    string id PK\n    string title\n  }', mindmap: '    AddedNode["新主题"]',
        gantt: '  新任务 :AddedNode, 2026-11-01, 2d',
      }[entry.kind];
      const lines = fixture.split('\n');
      if (['flowchart', 'sequence', 'state'].includes(entry.kind)) lines.splice(1, 0, statement);
      else lines.push(statement);
      const after = parseMermaidVisualSource(decorate(lines.join('\n')));
      assert.ok(after);
      const actual = preserveMermaidSource(source, before, after);
      assertGraph(actual, after);
      assertLinesRetained(source, actual);
      if (eol === '\r\n') assert.ok(!actual.replaceAll('\r\n', '').includes('\n'));
      assert.equal(preserveMermaidSource(actual, after, before), source, 'deleting the added object restores the original bytes without history assistance');
    });
    test(`${entry.template}: deleting an existing object patches only its ${eol === '\n' ? 'LF' : 'CRLF'} source and related edges`, () => {
      let expected = fixture;
      for (const snippet of deletions[entry.template]) {
        assert.ok(expected.includes(snippet), snippet);
        expected = expected.replace(`${snippet}\n`, '').replace(new RegExp(`${snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
      }
      // Removing a final statement removes its line, not the document's final blank line.
      expected = decorate(expected.replace(/\n$/, ''));
      const after = parseMermaidVisualSource(expected);
      assert.ok(after);
      const actual = preserveMermaidSource(source, before, after);
      assertGraph(actual, after);
      assert.equal(actual, expected);
    });
  }
}

for (const kind of ['class', 'er']) {
  test(`${kind}: multi-line members are scoped to their owning declaration`, () => {
    const classMode = kind === 'class';
    const source = [classMode ? 'classDiagram' : 'erDiagram', '  direction LR',
      `   ${classMode ? 'class ' : ''}First {`, '      string id', '      string keep', '   }',
      '   %% do not move this comment',
      `   ${classMode ? 'class ' : ''}Second {`, '      string id', '      string keep', '   }', ''].join('\r\n');
    const before = parseMermaidVisualSource(source);
    const after = { ...before, nodes: before.nodes.map(n => n.id === 'Second'
      ? { ...n, data: { ...n.data, details: ['string id', 'string changed', 'int added'] } } : n) };
    const expected = source.replace('Second {\r\n      string id\r\n      string keep', 'Second {\r\n      string id\r\n      string changed\r\n      int added');
    assert.equal(preserveMermaidSource(source, before, after), expected);
  });
}

test('structural changes preserve interleaved declarations, comments and mixed line endings', () => {
  const source = 'flowchart LR\r\n A["A"]\n B["B"]\r\n A --> B\n %% Keep between edges and declaration\r\n C["C"]\n B --> C';
  const before = parseMermaidVisualSource(source);
  const after = { ...before, nodes: [...before.nodes, { id: 'D', label: 'D', shape: 'rectangle' }] };
  const actual = preserveMermaidSource(source, before, after);
  assertGraph(actual, after);
  assert.equal(actual.replace(/\r?\n[ ]*D\["D"\]/, ''), source);
});

test('ambiguous identical edges fall back without silently editing the wrong occurrence', () => {
  const source = 'flowchart LR\n  A["A"]\n  B["B"]\n  A --> B\n  %% distinct context\n  A --> B';
  const before = parseMermaidVisualSource(source);
  const after = { ...before, edges: before.edges.slice(1) };
  const actual = preserveMermaidSource(source, before, after);
  assertGraph(actual, after);
  assert.equal(actual, serializeMermaidVisualGraph(after));
});

test('a stale source/model pair cannot return or patch unrelated source', () => {
  const before = parseMermaidVisualSource('flowchart LR\n  A["A"]');
  const unrelated = 'flowchart TD\n  Foreign["foreign"]';
  assert.equal(preserveMermaidSource(unrelated, before, before), serializeMermaidVisualGraph(before));
});

for (const eol of ['\n', '\r\n', '\r']) {
  for (const id of ['A', 'B']) {
    test(`inline flowchart ${id} rename preserves ${JSON.stringify(eol)} layout and edge notation`, () => {
      const source = ['graph LR', '', '  %% Keep position and spelling', '    A[入口]  -->|路线| B([处理])  ', '  B --> C{结束?}', ''].join(eol);
      const before = parseMermaidVisualSource(source);
      const oldLabel = before.nodes.find(node => node.id === id).label;
      const after = { ...before, nodes: before.nodes.map(node => node.id === id ? { ...node, label: '新名称🧭' } : node) };
      const actual = preserveMermaidSource(source, before, after);
      assert.equal(actual, source.replace(oldLabel, '新名称🧭'));
      assertGraph(actual, after);
      const history = new MermaidSourceHistory();
      assert.equal(history.commit(source, before, after), actual);
      assert.equal(history.commit(actual, after, before), source);
    });
  }
}

for (const notation of ['["旧名称"]', '("旧名称")', '(["旧名称"])', '{"旧名称"}', '(("旧名称"))', '[("旧名称")]']) {
  test(`inline declaration ${notation} preserves shape and its surrounding edge`, () => {
    const source = `flowchart TD\n\tSource${notation}\t-.->|不动| Target[保持]\n`;
    const before = parseMermaidVisualSource(source);
    const after = { ...before, nodes: before.nodes.map(node => node.id === 'Source' ? { ...node, label: '新名称' } : node) };
    const actual = preserveMermaidSource(source, before, after);
    assert.equal(actual, source.replace('旧名称', '新名称'));
    assertGraph(actual, after);
  });
}

for (const arrow of ['-->', '---', '-.->|关系|', '==>|关系|', '-- 关系 -->']) {
  test(`inline declarations retain ${arrow} spelling when both endpoints change`, () => {
    const source = `graph TB\n    Left["旧左"]   ${arrow}   Right('旧右')\n\n`;
    const before = parseMermaidVisualSource(source);
    const after = { ...before, nodes: before.nodes.map(node => ({ ...node, label: node.id === 'Left' ? '新左' : '新右' })) };
    const actual = preserveMermaidSource(source, before, after);
    assert.equal(actual, source.replace('旧左', '新左').replace('旧右', '新右'));
    assertGraph(actual, after);
  });
}

test('inline node rename preserves group position, mixed endings and label lookalikes', () => {
  const source = 'graph LR\r\n  %% 旧名称 must remain\n  subgraph Box["旧名称"]\r\n    A["旧名称"] -->|旧名称| B["旧名称"]\n  end\r\n  B --> A';
  const before = parseMermaidVisualSource(source);
  const after = { ...before, nodes: before.nodes.map(node => node.id === 'A' ? { ...node, label: '唯一改动' } : node) };
  const actual = preserveMermaidSource(source, before, after);
  assert.equal(actual, source.replace('A["旧名称"]', 'A["唯一改动"]'));
  assertGraph(actual, after);
});

test('a unique explicit inline declaration is used without rewriting its bare references', () => {
  const source = 'flowchart LR\n A --> B["旧标签"]\n B --> C\n C --> B\n';
  const before = parseMermaidVisualSource(source);
  const after = { ...before, nodes: before.nodes.map(node => node.id === 'B' ? { ...node, label: '新标签' } : node) };
  const actual = preserveMermaidSource(source, before, after);
  assert.equal(actual, source.replace('旧标签', '新标签'));
  assertGraph(actual, after);
});

test('a single implicit endpoint can receive its new declaration inline', () => {
  const source = 'graph LR\r\n  A   -->   B\r\n';
  const before = parseMermaidVisualSource(source);
  const after = { ...before, nodes: before.nodes.map(node => node.id === 'A' ? { ...node, label: '新标签' } : node) };
  const actual = preserveMermaidSource(source, before, after);
  assert.equal(actual, source.replace('  A   -->', '  A["新标签"]   -->'));
  assertGraph(actual, after);
});

test('inline shape changes replace only the node token', () => {
  const source = 'graph LR\n  A["节点"] --> B["保留"]\n';
  const before = parseMermaidVisualSource(source);
  const after = { ...before, nodes: before.nodes.map(node => node.id === 'A' ? { ...node, shape: 'decision' } : node) };
  const actual = preserveMermaidSource(source, before, after);
  assert.equal(actual, source.replace('A["节点"]', 'A{"节点"}'));
  assertGraph(actual, after);
});

for (const label of ['包含]括号', '分支 --> 下一步', '引号"与|分隔']) {
  test(`inline rename safely quotes Mermaid punctuation: ${label}`, () => {
    const source = 'graph LR\n  A[旧名称]  -->  B[保持]\n';
    const before = parseMermaidVisualSource(source);
    const after = { ...before, nodes: before.nodes.map(node => node.id === 'A' ? { ...node, label } : node) };
    const actual = preserveMermaidSource(source, before, after);
    const declaration = serializeMermaidVisualGraph({ ...after, nodes: [after.nodes[0]], edges: [] }).split('\n')[1].trim();
    assert.equal(actual, source.replace('A[旧名称]', declaration));
    assertGraph(actual, after);
  });
}

for (const declarations of [' A["旧"] --> B\n A["旧"] --> C', ' A["先前"] --> B\n A["旧"] --> C', ' A --> B\n A --> C']) {
  test(`ambiguous inline declarations remain an explicit canonical fallback: ${declarations}`, () => {
    const source = `graph LR\n\n${declarations}\n`;
    const before = parseMermaidVisualSource(source);
    const after = { ...before, nodes: before.nodes.map(node => node.id === 'A' ? { ...node, label: '新标签' } : node) };
    const actual = preserveMermaidSource(source, before, after);
    assert.equal(actual, serializeMermaidVisualGraph(after));
    assertGraph(actual, after);
  });
}

test('combined inline node and edge edits keep semantic equality when minimal mapping is unavailable', () => {
  const source = 'graph LR\n  A["旧"] -->|旧关系| B["保留"]\n';
  const before = parseMermaidVisualSource(source);
  const after = { ...before, nodes: before.nodes.map(node => node.id === 'A' ? { ...node, label: '新标签' } : node), edges: before.edges.map(edge => ({ ...edge, label: '新关系' })) };
  const actual = preserveMermaidSource(source, before, after);
  assert.equal(actual, serializeMermaidVisualGraph(after));
  assertGraph(actual, after);
});

for (const reuseSnapshot of [false, true]) {
  test(`external source epoch discards ${reuseSnapshot ? 'object snapshots' : 'equivalent graph spellings'} from before the edit`, () => {
    const original = 'flowchart LR\n  A["Old"] --> B["Keep"]';
    const before = parseMermaidVisualSource(original);
    const renamed = { ...before, nodes: before.nodes.map(node => node.id === 'A' ? { ...node, label: 'New' } : node) };
    const history = new MermaidSourceHistory();
    history.commit(original, before, renamed);

    const externalSource = 'graph LR\r\n\tA["New"] --> B["Keep"]\r\n\r\n';
    const externalGraph = parseMermaidVisualSource(externalSource);
    history.reset(externalGraph, externalSource);
    const target = reuseSnapshot ? before : structuredClone(before);
    const expected = externalSource.replace('New', 'Old');
    assert.equal(history.commit(externalSource, externalGraph, target), expected);
    assert.equal(history.commit(expected, target, externalGraph), externalSource, 'undo remains exact within the new epoch');
    assert.equal(history.commit(externalSource, externalGraph, target), expected, 'redo retains the edited spelling');
  });
}

for (const scenario of [
  { name: 'impossible start date', start: '2026-02-30', timing: '3d', repair: { ganttStart: '2026-02-28' } },
  { name: 'invalid duration', start: '2026-02-28', timing: 'nonsense', repair: { ganttTiming: ['3d'] } },
]) {
  test(`imported Gantt ${scenario.name} can be repaired, undone byte-for-byte and redone`, () => {
    const source = `gantt\r\n\r\n\tdateFormat YYYY-MM-DD\r\n\t%% Keep the imported source for undo\r\n\tA :a, ${scenario.start}, ${scenario.timing}\r\n\tB :b, after a, 2d\r\n`;
    const before = parseMermaidVisualSource(source);
    assert.ok(before, 'the existing parser accepts the imported graph');
    assert.throws(() => serializeMermaidVisualGraph(before), /格式无效/);
    const after = { ...before, nodes: before.nodes.map(node => node.id === 'a' ? { ...node, data: { ...node.data, ...scenario.repair } } : node) };
    const history = new MermaidSourceHistory();
    assert.doesNotThrow(() => history.reset(before, source), 'returning from source to canvas can retain an invalid imported snapshot');
    assert.doesNotThrow(() => history.remember(before, source));
    // Invalid originals have no canonical line mapping. Repair deliberately
    // falls back to a valid canonical source, while history retains raw bytes.
    const repaired = serializeMermaidVisualGraph(after);
    assert.equal(preserveMermaidSource(source, before, after), repaired);
    assert.equal(history.commit(source, before, after), repaired);
    assert.equal(history.commit(repaired, after, before), source, 'undo restores CRLF, indentation, comments and the old invalid value');
    assert.equal(history.commit(source, before, after), repaired, 'redo restores the validated repair');
    assert.deepEqual(parseMermaidVisualSource(repaired).nodes.find(node => node.id === 'b'), before.nodes.find(node => node.id === 'b'));

    const newlyInvalid = structuredClone(before);
    assert.throws(() => history.commit(repaired, after, newlyInvalid), /格式无效/, 'new invalid edits do not inherit the trusted snapshot exception');
    assert.throws(() => history.commit(repaired, after, newlyInvalid), /格式无效/, 'a rejected edit never enters the snapshot cache');
    assert.equal(history.commit(repaired, after, before), source);
  });
}
