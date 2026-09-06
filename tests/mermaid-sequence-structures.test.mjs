import assert from 'node:assert/strict';
import test from 'node:test';
import { MERMAID_TEMPLATES, parseMermaidVisualSource, serializeMermaidVisualGraph } from '../lib/mermaid-workbench.ts';

const complexSequence = `%% 中文订单交互
sequenceDiagram
  autonumber 10 5
  box 客户端
    actor 用户 as 购买者
    participant App as 应用
  end
  participant API as 接口
  用户->>+App: 提交订单
  Note over 用户,App: 确认订单
  loop 最多三次
    App->>API: 请求
    alt 成功
      API-->>App: 结果
    else 失败
      API-->>App: 重试
    end
  end
  par 保存
    App->>API: 写入
  and 通知
    App->>API: 推送
  end
  App-->>-用户: 完成`;

test('ordinary comments no longer make any built-in diagram read-only', () => {
  for (const template of MERMAID_TEMPLATES) {
    const lines = template.source.split('\n');
    lines.splice(1, 0, '  %% generated diagram');
    const graph = parseMermaidVisualSource(`%% diagram description\n${lines.join('\n')}`);
    assert.ok(graph, template.id);
    const source = serializeMermaidVisualGraph(graph);
    assert.match(source, /%% diagram description/);
    assert.match(source, /%% generated diagram/);
    assert.equal(parseMermaidVisualSource(source).kind, graph.kind);
  }
});

test('sequence canvas edits preserve Unicode participants, boxes, notes, branches and activations', () => {
  const graph = parseMermaidVisualSource(complexSequence);
  assert.ok(graph);
  assert.equal(graph.kind, 'sequence');
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 7);
  graph.nodes.find((node) => node.id === '用户').label = '会员';
  graph.edges.find((edge) => edge.label === '结果').label = '已确认结果';
  const result = serializeMermaidVisualGraph(graph);
  assert.match(result, /actor 用户 as 会员/);
  assert.match(result, /用户->>\+App: 提交订单/);
  assert.match(result, /App-->>-用户: 完成/);
  assert.match(result, /alt 成功\n\s+API-->>App: 已确认结果\n\s+else 失败/);
  assert.match(result, /box 客户端\n\s+actor 用户 as 会员\n\s+participant App as 应用\n\s+end/);
  const restored = parseMermaidVisualSource(result);
  assert.ok(restored);
  assert.deepEqual(restored.data.sequenceItems.filter((item) => item.kind === 'directive'), graph.data.sequenceItems.filter((item) => item.kind === 'directive'));
  assert.equal(serializeMermaidVisualGraph(restored), result);
});

test('explicit activation and optional, critical, break and rect frames stay editable', () => {
  const source = `sequenceDiagram
    A->>B: Request
    activate B
    rect rgb(200, 220, 240)
      opt Optional
        B-->>A: Result
      end
    end
    critical Required
      B->>B: Work
    option Unavailable
      break Abort
        B-->>A: Failed
      end
    end
    deactivate B`;
  const graph = parseMermaidVisualSource(source);
  assert.ok(graph);
  graph.edges[0].label = 'Updated request';
  const result = serializeMermaidVisualGraph(graph);
  assert.match(result, /activate B/);
  assert.match(result, /deactivate B/);
  assert.ok(parseMermaidVisualSource(result));
});

test('structural references prevent silently deleting a participant used by a note or activation', () => {
  const graph = parseMermaidVisualSource(complexSequence);
  graph.nodes = graph.nodes.filter((node) => node.id !== '用户');
  graph.edges = graph.edges.filter((edge) => edge.from !== '用户' && edge.to !== '用户');
  assert.throws(() => serializeMermaidVisualGraph(graph), /引用/);
});

test('new and deleted messages do not remove or unbalance preserved frames', () => {
  const graph = parseMermaidVisualSource(complexSequence);
  graph.edges = graph.edges.filter((edge) => edge.label !== '重试');
  graph.edges.push({ id: 'added', from: 'App', to: 'API', label: 'Audit', style: 'arrow', data: { token: '->>' } });
  const result = serializeMermaidVisualGraph(graph);
  assert.match(result, /else 失败\n\s+end/);
  assert.ok(result.endsWith('App->>API: Audit'));
  assert.ok(parseMermaidVisualSource(result));
});

test('unsupported or malformed structure is never silently discarded', () => {
  for (const body of ['alt test\nA->>B: hi', 'else test\nA->>B: hi', 'loop test\nelse nope\nend', 'Note over A,B missing colon', '%%{init: {}}%%', 'unknownDirective Foo']) {
    assert.equal(parseMermaidVisualSource(`sequenceDiagram\n${body}`), null, body);
  }
});

test('implicit participants keep their first-appearance order after a structured round trip', () => {
  for (const source of [
    'sequenceDiagram\nactor User as User\nUser->>App: Hello\nNote over App: Ready',
    'sequenceDiagram\nloop Try\n用户->>服务: 请求\nend',
  ]) {
    const graph = parseMermaidVisualSource(source);
    const restored = parseMermaidVisualSource(serializeMermaidVisualGraph(graph));
    assert.deepEqual(restored.nodes.map((node) => node.id), graph.nodes.map((node) => node.id));
  }
});

test('nested sequence edits pass the actual Mermaid grammar without browser-only box parsing', async () => {
  const { default: mermaid } = await import('mermaid');
  // Box parsing invokes DOMPurify and CSS color validation, so box rendering is
  // a browser check. Exercise control flow through the real grammar in Node.
  const graph = parseMermaidVisualSource(`sequenceDiagram
    actor 用户 as 会员
    participant App as 应用
    用户->>+App: 提交
    Note over 用户,App: 确认
    loop 重试
      alt 成功
        App-->>用户: 已确认
      else 失败
        App-->>用户: 错误
      end
    end
    App-->>-用户: 完成`);
  graph.nodes[0].label = '会员';
  graph.edges[0].label = '编辑后的请求';
  assert.equal((await mermaid.parse(serializeMermaidVisualGraph(graph))).diagramType, 'sequence');
});
