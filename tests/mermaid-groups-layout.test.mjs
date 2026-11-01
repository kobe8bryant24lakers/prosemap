import assert from 'node:assert/strict';
import test from 'node:test';
import { MERMAID_TEMPLATES, parseMermaidVisualSource } from '../lib/mermaid-workbench.ts';
import { expandedMermaidCanvasStage, layoutMermaidGraph, mermaidCanvasNodeSize, mermaidGroupBounds, placeMermaidCanvasGroup, placeMermaidCanvasNode, reconcileMermaidCanvasGroups, reconcileMermaidCanvasNodes } from '../lib/mermaid-canvas-layout.ts';
import fixtures from './fixtures/canvas-group-templates.json' with { type: 'json' };

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

test('ordinary unquoted group titles stay editable and survive serialization', async () => {
  const { serializeMermaidVisualGraph } = await import('../lib/mermaid-workbench.ts');
  const graph = parseMermaidVisualSource('flowchart LR\nsubgraph Outer[外层]\nsubgraph Inner [编辑流程]\nA[输入] --> B[输出]\nend\nend');
  assert.ok(graph);
  assert.deepEqual(graph.data.groups.map(({ id, label, parentId }) => ({ id, label, parentId })), [
    { id: 'Outer', label: '外层', parentId: undefined },
    { id: 'Inner', label: '编辑流程', parentId: 'Outer' },
  ]);
  assert.deepEqual(parseMermaidVisualSource(serializeMermaidVisualGraph(graph)), graph);
  assert.equal(parseMermaidVisualSource('flowchart LR\nsubgraph X[broken[title]]\nA\nend'), null);
});

test('new empty groups avoid nested contents and retain distant anchors after node reconciliation', () => {
  const graph = parseMermaidVisualSource('flowchart LR\nsubgraph Outer["SYNTHETIC Outer"]\nsubgraph Inner["SYNTHETIC Inner"]\nA["SYNTHETIC A"]\nend\nend\nB["SYNTHETIC B"]\nA --> B');
  let layout = layoutMermaidGraph(graph);
  const originals = structuredClone(layout.positions);
  for (const id of ['New1', 'New2']) {
    const point = placeMermaidCanvasGroup(graph, layout.positions, { x: 4000, y: 3000 });
    graph.data.groups.push({ id, label: `SYNTHETIC ${id}` });
    layout.positions[id] = point;
    layout = { ...layout, ...expandedMermaidCanvasStage(graph, layout.positions, layout) };
  }
  const bounds = mermaidGroupBounds(graph, layout.positions);
  for (const id of ['New1', 'New2']) {
    const box = bounds[id];
    for (const [otherId, other] of Object.entries(bounds)) if (id !== otherId) {
      assert.ok(box.maxX <= other.minX || other.maxX <= box.minX || box.maxY <= other.minY || other.maxY <= box.minY);
    }
    assert.ok(box.maxX < layout.width && box.maxY < layout.height);
  }
  const next = reconcileMermaidCanvasNodes({ ...graph, nodes: [...graph.nodes, { id: 'Added', label: 'SYNTHETIC Added', shape: 'rectangle' }] }, layout);
  assert.deepEqual(next.positions.New1, layout.positions.New1);
  assert.deepEqual(next.positions.New2, layout.positions.New2);
  for (const node of graph.nodes) assert.deepEqual(next.positions[node.id], originals[node.id]);
});

test('outside node insertion avoids empty and populated boundaries without moving existing objects', () => {
  const graph = parseMermaidVisualSource('flowchart LR\nsubgraph Outer["SYNTHETIC Outer"]\nsubgraph Inner["SYNTHETIC Inner"]\nA["SYNTHETIC A"]\nend\nend\nsubgraph Empty["SYNTHETIC Empty"]\nend\nB["SYNTHETIC B"]');
  const { positions } = layoutMermaidGraph(graph), original = JSON.stringify(positions);
  const bounds = mermaidGroupBounds(graph, positions);
  for (const boundary of Object.values(bounds)) {
    const node = { id: 'Added', label: 'SYNTHETIC outside', shape: 'rectangle' };
    const size = mermaidCanvasNodeSize(node, graph.kind);
    const point = placeMermaidCanvasNode(graph, positions, node, { x: (boundary.minX + boundary.maxX - size.width) / 2, y: (boundary.minY + boundary.maxY - size.height) / 2 });
    const next = { ...graph, nodes: [...graph.nodes, node] };
    assertContainment(next, { ...positions, Added: point });
    assert.equal(JSON.stringify(positions), original);
  }
});

test('a group member may use free space inside its own ancestors', () => {
  const graph = parseMermaidVisualSource('flowchart LR\nsubgraph Outer["SYNTHETIC Outer"]\nsubgraph Inner["SYNTHETIC Inner"]\nA["SYNTHETIC A"]\nB["SYNTHETIC B"]\nend\nend');
  const positions = { A: { x: 200, y: 200 }, B: { x: 1000, y: 200 } };
  const node = { id: 'Added', label: 'SYNTHETIC inside', shape: 'rectangle', data: { groupId: 'Inner' } };
  const preferred = { x: 500, y: 200 };
  assert.deepEqual(placeMermaidCanvasNode(graph, positions, node, preferred), preferred);
});

test('constrained insertion avoids occupied space without reversing the requested axis', () => {
  const graph = parseMermaidVisualSource('flowchart LR\nsubgraph Busy["SYNTHETIC occupied boundary"]\nA["SYNTHETIC A"]\nB["SYNTHETIC B"]\nend');
  const positions = { A: { x: 50, y: 50 }, B: { x: 9000, y: 9000 } };
  const original = JSON.stringify(positions), node = { id: 'Added', label: 'SYNTHETIC added', shape: 'rectangle' };
  const preferred = { x: 500, y: 500 };
  // This boundary exceeds the local search radius and exercises the fallback too.
  for (const minimum of [{ x: preferred.x }, { y: preferred.y }]) {
    const point = placeMermaidCanvasNode(graph, positions, node, preferred, minimum);
    if (minimum.x !== undefined) assert.ok(point.x >= minimum.x);
    if (minimum.y !== undefined) assert.ok(point.y >= minimum.y);
    assertContainment({ ...graph, nodes: [...graph.nodes, node] }, { ...positions, Added: point });
  }
  assert.equal(JSON.stringify(positions), original);
});

for (const fixture of fixtures.templates) test(`${fixture.template}: connected group insertion honors its own direction and preserves unrelated positions`, () => {
  const graph = parseMermaidVisualSource(fixture.source), layout = layoutMermaidGraph(graph);
  for (const direction of ['LR', 'TB', 'RL', 'BT']) {
    const child = { id: 'SYNTHETIC_Child', label: 'SYNTHETIC child', shape: 'rectangle', data: { groupId: 'SyntheticInner' } };
    const next = { ...graph, nodes: [...graph.nodes, child], edges: [...graph.edges, { ...graph.edges[0], id: 'SYNTHETIC_Edge', from: 'SyntheticLeaf', to: child.id }] };
    const result = reconcileMermaidCanvasGroups(graph, next, layout, direction);
    assertContainment(next, result.positions);
    const a = result.positions.SyntheticLeaf, b = result.positions[child.id];
    const aSize = mermaidCanvasNodeSize(graph.nodes.find(n => n.id === 'SyntheticLeaf'), graph.kind), bSize = mermaidCanvasNodeSize(child, graph.kind);
    if (direction === 'LR') assert.ok(b.x >= a.x + aSize.width);
    if (direction === 'TB') assert.ok(b.y >= a.y + aSize.height);
    if (direction === 'RL') assert.ok(b.x + bSize.width <= a.x);
    if (direction === 'BT') assert.ok(b.y + bSize.height <= a.y);
    for (const node of graph.nodes.filter(n => !['SyntheticMiddle', 'SyntheticInner'].includes(n.data?.groupId))) assert.deepEqual(result.positions[node.id], layout.positions[node.id]);
    assert.equal(next.direction, graph.direction);
  }
});

function assertContainment(graph, positions) {
  const bounds = mermaidGroupBounds(graph, positions);
  const ancestors = id => { const result = new Set(); while (id) { result.add(id); id = graph.data.groups.find(g => g.id === id)?.parentId; } return result; };
  const separate = (a, b) => a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY;
  for (const node of graph.nodes) {
    const point = positions[node.id], size = mermaidCanvasNodeSize(node, graph.kind);
    const box = { minX: point.x, minY: point.y, maxX: point.x + size.width, maxY: point.y + size.height };
    for (const [id, group] of Object.entries(bounds)) {
      if (ancestors(node.data?.groupId).has(id)) assert.ok(box.minX >= group.minX && box.minY >= group.minY && box.maxX <= group.maxX && box.maxY <= group.maxY, `${node.id} inside ${id}`);
      else assert.ok(separate(box, group), `${node.id} outside ${id}`);
    }
  }
  for (const group of graph.data.groups) for (const other of graph.data.groups) {
    if (group.id !== other.id && !ancestors(group.parentId).has(other.id) && !ancestors(other.parentId).has(group.id)) assert.ok(separate(bounds[group.id], bounds[other.id]), `${group.id} separate from ${other.id}`);
  }
}

for (const fixture of fixtures.templates) test(`${fixture.template}: containment changes keep independent manual positions and correct nested boundaries`, () => {
  const original = parseMermaidVisualSource(fixture.source);
  let graph = structuredClone(original), layout = layoutMermaidGraph(graph);
  const untouched = graph.nodes[0].id;
  layout.positions[untouched].x += 30;
  const manual = structuredClone(layout.positions[untouched]);
  const change = next => {
    const result = reconcileMermaidCanvasGroups(graph, next, layout);
    assert.ok(result);
    assertContainment(next, result.positions);
    assert.deepEqual(result.positions[untouched], manual);
    graph = next; layout = result;
  };
  for (const parentId of ['SyntheticOther', undefined, 'SyntheticOuter']) change({ ...graph, data: { ...graph.data, groups: graph.data.groups.map(g => g.id === 'SyntheticMiddle' ? { ...g, parentId } : g) } });
  for (const groupId of ['SyntheticInner', undefined]) change({ ...graph, nodes: graph.nodes.map(n => n.id === 'SyntheticOutside' ? { ...n, data: { ...n.data, groupId } } : n) });
  for (const id of ['SYNTHETIC_Added', 'SYNTHETIC_Connected']) change({ ...graph, nodes: [...graph.nodes, { id, label: id, shape: 'rectangle', data: { groupId: 'SyntheticInner' } }] });
  change({ ...graph, nodes: graph.nodes.map(n => n.data?.groupId === 'SyntheticMiddle' ? { ...n, data: { ...n.data, groupId: 'SyntheticOuter' } } : n), data: { ...graph.data, groups: graph.data.groups.filter(g => g.id !== 'SyntheticMiddle').map(g => g.parentId === 'SyntheticMiddle' ? { ...g, parentId: 'SyntheticOuter' } : g) } });
  const beforeRename = JSON.stringify(layout);
  assert.equal(reconcileMermaidCanvasGroups(graph, { ...graph, data: { ...graph.data, groups: graph.data.groups.map(g => ({ ...g, label: g.label + ' renamed' })) } }, layout), null);
  assert.equal(JSON.stringify(layout), beforeRename);
});
