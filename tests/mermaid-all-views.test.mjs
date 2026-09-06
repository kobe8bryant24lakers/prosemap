import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MERMAID_TEMPLATES, parseMermaidVisualSource, serializeMermaidVisualGraph } from '../lib/mermaid-workbench.ts';

const cases = [
  ...MERMAID_TEMPLATES.map((template) => ({ name: template.id, source: `%% imported document\n${template.source}` })),
  { name: 'class-import', source: 'classDiagram\ndirection TB\nclass 用户\n用户 : +String name\n用户 : +login()\n用户 --> 订单 : creates' },
  { name: 'er-import', source: 'erDiagram\ndirection TB\n用户 ||--o{ 订单 : 拥有\n用户 {\nint id PK\n}\n订单 {\nint id PK\n}' },
  { name: 'state-import', source: 'stateDiagram-v2\n空闲\n空闲 : 等待请求\n空闲 --> 运行 : 开始\n运行 --> 空闲 : 完成\n未连接状态' },
  { name: 'mindmap-import', source: 'mindmap\n  项目计划\n    需求\n      访谈\n    发布' },
];

test('all existing views and common imported variants remain editable after a label change', () => {
  for (const { name, source } of cases) {
    const graph = parseMermaidVisualSource(source);
    assert.ok(graph, `${name}: import must enter canvas`);
    const node = graph.nodes.find((entry) => !entry.data?.stateRole || entry.data.stateRole === 'state');
    node.label = '已编辑对象';
    const result = serializeMermaidVisualGraph(graph);
    const restored = parseMermaidVisualSource(result);
    assert.ok(restored, `${name}: edited source must reopen in canvas`);
    assert.equal(restored.kind, graph.kind, name);
    assert.equal(restored.nodes.length, graph.nodes.length, `${name}: node loss`);
    assert.equal(restored.edges.length, graph.edges.length, `${name}: relation loss`);
    assert.ok(restored.nodes.some((entry) => entry.label === '已编辑对象'), `${name}: edit lost`);
    assert.equal(restored.direction, graph.direction, `${name}: direction lost`);
  }
});

test('the workbench renders actual canvas controls for every view, before and after editing', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({
    configFile: resolve(root, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
  });
  try {
    const { default: Workbench } = await server.ssrLoadModule(resolve(root, 'components/MermaidWorkbench.tsx'));
    for (const { name, source } of cases) {
      const graph = parseMermaidVisualSource(source);
      for (const initialSource of [source, serializeMermaidVisualGraph(graph)]) {
        const html = renderToString(React.createElement(Workbench, {
          sessionId: 1, initialSource, config: {}, contextDocuments: [], mode: 'edit',
          onApply() {}, onClose() {}, onOpenSettings() {}, onPickContext() {}, onRemoveContext() {},
          onRequestConfirmation: async () => false,
        }));
        assert.ok(html.includes('Mermaid 可视化画布编辑器'), `${name}: no canvas`);
        assert.ok(html.includes('canvas-editor-toolbar'), `${name}: no editing controls`);
        assert.ok(html.includes('mermaid-canvas-node'), `${name}: no editable objects`);
        assert.ok(!html.includes('只读图表预览'), `${name}: fell back to read-only`);
      }
    }
  } finally {
    await server.close();
  }
});
