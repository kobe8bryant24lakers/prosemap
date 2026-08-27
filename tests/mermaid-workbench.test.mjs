import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MERMAID_TEMPLATES,
  parseMermaidVisualSource,
  serializeMermaidVisualGraph,
} from '../lib/mermaid-workbench.ts';

const EXPECTED_TEMPLATE_KINDS = new Map([
  ['basic-flowchart', 'flowchart'],
  ['four-plus-one', 'flowchart'],
  ['architecture', 'flowchart'],
  ['sequence', 'sequence'],
  ['state', 'state'],
  ['class', 'class'],
  ['er', 'er'],
  ['mindmap', 'mindmap'],
  ['gantt', 'gantt'],
]);

function requireTemplate(templateId) {
  const template = MERMAID_TEMPLATES.find((candidate) => candidate.id === templateId);
  assert.ok(template, `missing Mermaid template: ${templateId}`);
  return template;
}

function requireParsed(source, context) {
  const graph = parseMermaidVisualSource(source);
  assert.ok(graph, `${context} should be visually editable`);
  return graph;
}

test('all nine Mermaid templates survive a parse and serialize round trip', async (t) => {
  assert.equal(MERMAID_TEMPLATES.length, EXPECTED_TEMPLATE_KINDS.size);
  assert.deepEqual(
    new Set(MERMAID_TEMPLATES.map((template) => template.id)),
    new Set(EXPECTED_TEMPLATE_KINDS.keys()),
  );

  for (const template of MERMAID_TEMPLATES) {
    await t.test(template.id, () => {
      const expectedKind = EXPECTED_TEMPLATE_KINDS.get(template.id);
      const graph = requireParsed(template.source, template.id);

      assert.equal(graph.kind, expectedKind);
      assert.ok(graph.nodes.length > 0, `${template.id} should contain nodes`);
      assert.ok(graph.edges.length > 0, `${template.id} should contain edges`);

      const serialized = serializeMermaidVisualGraph(graph);
      assert.ok(serialized.trim(), `${template.id} should serialize to non-empty source`);
      const reparsed = requireParsed(serialized, `${template.id} round trip`);

      assert.equal(reparsed.kind, expectedKind);
      assert.equal(reparsed.nodes.length, graph.nodes.length);
      assert.equal(reparsed.edges.length, graph.edges.length);
    });
  }
});

const UNSUPPORTED_FLOWCHARTS = [
  {
    name: 'subroutine node shape',
    source: 'flowchart TD\n  Worker[["后台任务"]]',
  },
  {
    name: 'hexagon node shape',
    source: 'flowchart TD\n  Prepare{{"准备数据"}}',
  },
  {
    name: 'triple-circle node shape',
    source: 'flowchart TD\n  Stop((("停止")))',
  },
  {
    name: 'subgraph',
    source: 'flowchart TD\n  subgraph Cluster\n    A["服务 A"]\n  end',
  },
  {
    name: 'style directive',
    source: 'flowchart TD\n  A["服务 A"]\n  style A fill:#fff',
  },
];

test('advanced flowchart syntax stays in source mode', async (t) => {
  for (const fixture of UNSUPPORTED_FLOWCHARTS) {
    await t.test(fixture.name, () => {
      assert.equal(parseMermaidVisualSource(fixture.source), null);
    });
  }
});

test('strict visual parsers reject syntax they cannot safely round trip', () => {
  assert.equal(
    parseMermaidVisualSource('erDiagram\n  USER oo--oo ORDER : invalid'),
    null,
    'invalid ER cardinalities must stay in source mode',
  );
  assert.equal(
    parseMermaidVisualSource('gantt\n  displayMode compact\n  Task :task, 2026-01-01, 1d'),
    null,
    'frontmatter-only Gantt displayMode must stay in source mode',
  );
  assert.equal(
    parseMermaidVisualSource('gantt\n  weekday someday\n  Task :task, 2026-01-01, 1d'),
    null,
    'unknown Gantt weekdays must stay in source mode',
  );

  const supportedDirectives = requireParsed(
    'gantt\n  weekday monday\n  weekend friday\n  Task :task, 2026-01-01, 1d',
    'supported Gantt weekday and weekend directives',
  );
  assert.deepEqual(supportedDirectives.data?.directives, ['weekday monday', 'weekend friday']);
});

test('Gantt visual conversion preserves Mermaid task field semantics', () => {
  assert.equal(
    parseMermaidVisualSource('gantt\n  First task :1d'),
    null,
    'a first task without a start cannot enter the canvas',
  );
  assert.equal(
    parseMermaidVisualSource('gantt\n  Task :task, 2026-01-01, 1d, 2026-01-03'),
    null,
    'four task fields are not supported by Mermaid',
  );

  const implicitSchedule = requireParsed(
    'gantt\n  dateFormat YYYY-MM-DD\n  First :first, 2026-01-01, 1d\n  Second :2d',
    'implicit Gantt continuation',
  );
  assert.equal(implicitSchedule.edges.length, 1);
  assert.equal(implicitSchedule.edges[0].from, implicitSchedule.nodes[0].id);
  assert.equal(implicitSchedule.edges[0].to, implicitSchedule.nodes[1].id);
  const serialized = serializeMermaidVisualGraph(implicitSchedule);
  assert.match(serialized, /Second\s+:Task\d+, after first, 2d/);
  assert.ok(parseMermaidVisualSource(serialized));
});

test('strict serializers protect canvas graph invariants', () => {
  const mindmap = structuredClone(requireParsed(requireTemplate('mindmap').source, 'mindmap invariant'));
  mindmap.edges.pop();
  assert.throws(() => serializeMermaidVisualGraph(mindmap), /完整树结构|连接到根主题/);

  const state = structuredClone(requireParsed(requireTemplate('state').source, 'state refs'));
  for (const node of state.nodes) {
    if (node.data?.stateRole === 'start' || node.data?.stateRole === 'end') {
      node.data.stateRole = 'state';
      node.data.ref = '[*]';
      node.shape = 'rounded';
    }
  }
  const stateRoundTrip = requireParsed(serializeMermaidVisualGraph(state), 'state unique refs');
  assert.equal(stateRoundTrip.nodes.length, state.nodes.length);
  assert.equal(new Set(stateRoundTrip.nodes.map((node) => node.data?.ref)).size, state.nodes.length);

  const gantt = structuredClone(requireParsed(requireTemplate('gantt').source, 'Gantt DAG'));
  gantt.edges.push({
    id: 'cycle',
    from: gantt.nodes.at(-1).id,
    to: gantt.nodes[0].id,
    label: '',
    style: 'arrow',
    data: { token: 'after' },
  });
  assert.throws(() => serializeMermaidVisualGraph(gantt), /不能形成循环/);
});

test('class and ER details tolerate blank editor lines', () => {
  for (const templateId of ['class', 'er']) {
    const graph = structuredClone(requireParsed(requireTemplate(templateId).source, `${templateId} blank details`));
    graph.nodes[0].data.details.push('', '   ');
    const reparsed = requireParsed(serializeMermaidVisualGraph(graph), `${templateId} blank details round trip`);
    assert.ok(reparsed.nodes[0].data.details.every((detail) => detail.trim()));
  }
});

test('repeated class and ER blocks merge without losing details', () => {
  const repeatedClass = requireParsed(
    'classDiagram\n  class A {\n    +first()\n  }\n  class A {\n    +second()\n  }',
    'repeated class blocks',
  );
  assert.deepEqual(repeatedClass.nodes[0].data.details, ['+first()', '+second()']);
  assert.deepEqual(
    requireParsed(serializeMermaidVisualGraph(repeatedClass), 'repeated class round trip').nodes[0].data.details,
    ['+first()', '+second()'],
  );

  const repeatedEr = requireParsed(
    'erDiagram\n  USER {\n    string id PK\n  }\n  USER {\n    string name\n  }',
    'repeated ER blocks',
  );
  assert.deepEqual(repeatedEr.nodes[0].data.details, ['string id PK', 'string name']);
  assert.deepEqual(
    requireParsed(serializeMermaidVisualGraph(repeatedEr), 'repeated ER round trip').nodes[0].data.details,
    ['string id PK', 'string name'],
  );
});

test('canvas serializers reject Mermaid statement delimiters in free text', () => {
  const sequence = structuredClone(requireParsed(requireTemplate('sequence').source, 'sequence text safety'));
  sequence.nodes[0].label = 'Alice; participant Injected as Extra';
  assert.throws(() => serializeMermaidVisualGraph(sequence), /分号/);

  const state = structuredClone(requireParsed(requireTemplate('state').source, 'state text safety'));
  state.edges[0].label = 'ready # hidden';
  assert.throws(() => serializeMermaidVisualGraph(state), /#/);

  const classGraph = structuredClone(requireParsed(requireTemplate('class').source, 'class detail safety'));
  classGraph.nodes[0].data.details.push('}');
  assert.throws(() => serializeMermaidVisualGraph(classGraph), /花括号/);

  const gantt = structuredClone(requireParsed(requireTemplate('gantt').source, 'Gantt text safety'));
  gantt.nodes[0].label = '需求:确认';
  assert.throws(() => serializeMermaidVisualGraph(gantt), /冒号/);
  gantt.nodes[0].label = '需求确认';
  gantt.nodes[0].data.ganttStart = '2026-01-01, extra';
  assert.throws(() => serializeMermaidVisualGraph(gantt), /开始时间格式无效/);
  gantt.nodes[0].data.ganttStart = '2026-01-01';
  gantt.nodes[0].data.ganttTiming = ['3d, 2026-01-10'];
  assert.throws(() => serializeMermaidVisualGraph(gantt), /工期或结束日期格式无效/);
});

test('class relations use class-specific canvas line styles', () => {
  const graph = requireParsed(requireTemplate('class').source, 'class relation style');
  assert.equal(graph.edges[0].style, 'arrow');
  const dotted = requireParsed('classDiagram\n  A ..> B', 'class dotted relation style');
  assert.equal(dotted.edges[0].style, 'dotted');
});

const STRUCTURAL_MUTATIONS = [
  {
    kind: 'flowchart',
    templateId: 'basic-flowchart',
    addedLabel: '人工复核',
    mutate(graph) {
      graph.nodes.push({ id: 'ManualReview', label: this.addedLabel, shape: 'rectangle' });
      graph.edges.push({
        id: 'regression-flow-edge',
        from: graph.nodes[0].id,
        to: 'ManualReview',
        label: '转人工',
        style: 'arrow',
      });
    },
  },
  {
    kind: 'sequence',
    templateId: 'sequence',
    addedLabel: '审计员',
    mutate(graph) {
      graph.nodes.push({
        id: 'Auditor',
        label: this.addedLabel,
        shape: 'terminal',
        data: { ref: 'Auditor', sequenceType: 'actor' },
      });
      graph.edges.push({
        id: 'regression-sequence-edge',
        from: graph.nodes[0].id,
        to: 'Auditor',
        label: '记录审计',
        style: 'arrow',
        data: { token: '->>' },
      });
    },
  },
  {
    kind: 'state',
    templateId: 'state',
    addedLabel: '已归档',
    mutate(graph) {
      const previousState = graph.nodes.find((node) => node.data?.stateRole === 'state');
      assert.ok(previousState);
      graph.nodes.push({
        id: 'Archived',
        label: this.addedLabel,
        shape: 'rounded',
        data: { ref: 'Archived', stateRole: 'state' },
      });
      graph.edges.push({
        id: 'regression-state-edge',
        from: previousState.id,
        to: 'Archived',
        label: '归档',
        style: 'arrow',
        data: { token: '-->' },
      });
    },
  },
  {
    kind: 'class',
    templateId: 'class',
    addedLabel: 'Invoice',
    mutate(graph) {
      graph.nodes.push({
        id: 'Invoice',
        label: this.addedLabel,
        shape: 'rectangle',
        data: { ref: 'Invoice', details: ['+String id', '+issue()'] },
      });
      graph.edges.push({
        id: 'regression-class-edge',
        from: graph.nodes[0].id,
        to: 'Invoice',
        label: '开具',
        style: 'arrow',
        data: { token: '-->' },
      });
    },
  },
  {
    kind: 'er',
    templateId: 'er',
    addedLabel: 'ITEM',
    mutate(graph) {
      graph.nodes.push({
        id: 'ITEM',
        label: this.addedLabel,
        shape: 'database',
        data: { ref: 'ITEM', details: ['string id PK', 'string order_id FK'] },
      });
      graph.edges.push({
        id: 'regression-er-edge',
        from: 'ORDER',
        to: 'ITEM',
        label: 'contains',
        style: 'line',
        data: { token: '||--o{' },
      });
    },
  },
  {
    kind: 'mindmap',
    templateId: 'mindmap',
    addedLabel: '回归验证',
    mutate(graph) {
      const root = graph.nodes.find((node) => node.data?.mindRoot);
      assert.ok(root);
      graph.nodes.push({
        id: 'RegressionCheck',
        label: this.addedLabel,
        shape: 'rounded',
        data: { ref: 'RegressionCheck', mindRoot: false },
      });
      graph.edges.push({
        id: 'regression-mindmap-edge',
        from: root.id,
        to: 'RegressionCheck',
        label: '',
        style: 'line',
        data: { token: 'child' },
      });
    },
  },
  {
    kind: 'gantt',
    templateId: 'gantt',
    addedLabel: '生产部署',
    mutate(graph) {
      const dependency = graph.nodes.at(-1);
      assert.ok(dependency);
      graph.nodes.push({
        id: 'Deploy',
        label: this.addedLabel,
        shape: 'rounded',
        data: {
          ref: 'Deploy',
          ganttSection: '发布',
          ganttStatuses: [],
          ganttTiming: ['2d'],
        },
      });
      graph.edges.push({
        id: 'regression-gantt-edge',
        from: dependency.id,
        to: 'Deploy',
        label: '',
        style: 'arrow',
        data: { token: 'after' },
      });
    },
  },
];

test('every visual diagram kind preserves structural edits', async (t) => {
  for (const fixture of STRUCTURAL_MUTATIONS) {
    await t.test(fixture.kind, () => {
      const template = requireTemplate(fixture.templateId);
      const graph = structuredClone(requireParsed(template.source, fixture.templateId));
      assert.equal(graph.kind, fixture.kind);

      const previousNodeCount = graph.nodes.length;
      const previousEdgeCount = graph.edges.length;
      fixture.mutate(graph);

      assert.equal(graph.nodes.length, previousNodeCount + 1);
      assert.equal(graph.edges.length, previousEdgeCount + 1);

      const reparsed = requireParsed(
        serializeMermaidVisualGraph(graph),
        `${fixture.kind} structural edit`,
      );
      assert.equal(reparsed.kind, fixture.kind);
      assert.equal(reparsed.nodes.length, graph.nodes.length);
      assert.equal(reparsed.edges.length, graph.edges.length);
      assert.ok(
        reparsed.nodes.some((node) => node.label === fixture.addedLabel),
        `${fixture.kind} should preserve the added node`,
      );
    });
  }
});
