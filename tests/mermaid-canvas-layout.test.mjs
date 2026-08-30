import assert from 'node:assert/strict';
import test from 'node:test';

import {
  graphLayoutSignature,
  graphNodeGeometrySignature,
  layoutMermaidGraph,
  mermaidCanvasFitZoom,
  mermaidCanvasLayoutBounds,
  mermaidCanvasNodeSize,
  mermaidSequenceMessageVisual,
  MIN_MERMAID_SEQUENCE_STAGE_HEIGHT,
} from '../lib/mermaid-canvas-layout.ts';

function node(id, shape = 'rectangle', data) {
  return { id, label: id, shape, ...(data ? { data } : {}) };
}

function edge(id, from, to) {
  return { id, from, to, label: '', style: 'arrow' };
}

function centerOf(graph, layout, nodeId) {
  const current = graph.nodes.find((candidate) => candidate.id === nodeId);
  assert.ok(current, `missing fixture node ${nodeId}`);
  const position = layout.positions[nodeId];
  assert.ok(position, `missing position for ${nodeId}`);
  const size = mermaidCanvasNodeSize(current, graph.kind);
  return { x: position.x + size.width / 2, y: position.y + size.height / 2 };
}

function assertFiniteLayout(graph, layout) {
  assert.ok(Number.isFinite(layout.width) && layout.width > 0, 'canvas width must be finite and positive');
  assert.ok(Number.isFinite(layout.height) && layout.height > 0, 'canvas height must be finite and positive');
  assert.deepEqual(
    new Set(Object.keys(layout.positions)),
    new Set(graph.nodes.map((current) => current.id)),
    'every node, including nodes in cycles, must receive exactly one position',
  );

  for (const current of graph.nodes) {
    const position = layout.positions[current.id];
    const size = mermaidCanvasNodeSize(current, graph.kind);
    assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y), `${current.id} must have finite coordinates`);
    assert.ok(position.x >= 0 && position.y >= 0, `${current.id} must stay inside the top and left canvas edges`);
    assert.ok(
      position.x + size.width <= layout.width + 0.001,
      `${current.id} must stay inside the right canvas edge`,
    );
    assert.ok(
      position.y + size.height <= layout.height + 0.001,
      `${current.id} must stay inside the bottom canvas edge`,
    );
  }
}

function assertNodesDoNotOverlap(graph, layout) {
  for (let leftIndex = 0; leftIndex < graph.nodes.length; leftIndex += 1) {
    const left = graph.nodes[leftIndex];
    const leftPosition = layout.positions[left.id];
    const leftSize = mermaidCanvasNodeSize(left, graph.kind);
    for (let rightIndex = leftIndex + 1; rightIndex < graph.nodes.length; rightIndex += 1) {
      const right = graph.nodes[rightIndex];
      const rightPosition = layout.positions[right.id];
      const rightSize = mermaidCanvasNodeSize(right, graph.kind);
      const overlapWidth = Math.min(leftPosition.x + leftSize.width, rightPosition.x + rightSize.width)
        - Math.max(leftPosition.x, rightPosition.x);
      const overlapHeight = Math.min(leftPosition.y + leftSize.height, rightPosition.y + rightSize.height)
        - Math.max(leftPosition.y, rightPosition.y);
      assert.ok(
        overlapWidth <= 0.001 || overlapHeight <= 0.001,
        `${left.id} and ${right.id} overlap by ${overlapWidth.toFixed(2)} × ${overlapHeight.toFixed(2)}`,
      );
    }
  }
}

const WELCOME_CYCLE = {
  kind: 'flowchart',
  direction: 'LR',
  nodes: [
    node('A'),
    node('B'),
    node('C', 'decision'),
    node('D'),
    node('E'),
    node('F'),
    node('G', 'decision'),
    node('H', 'terminal'),
  ],
  edges: [
    edge('A-B', 'A', 'B'),
    edge('B-C', 'B', 'C'),
    edge('C-D', 'C', 'D'),
    edge('C-E', 'C', 'E'),
    edge('D-F', 'D', 'F'),
    edge('E-F', 'E', 'F'),
    edge('F-G', 'F', 'G'),
    edge('G-H', 'G', 'H'),
    edge('G-B', 'G', 'B'),
  ],
};

test('a workflow with a rejection cycle keeps every node usable and separated', () => {
  const first = layoutMermaidGraph(WELCOME_CYCLE);
  const second = layoutMermaidGraph(structuredClone(WELCOME_CYCLE));

  assert.deepEqual(second, first, 'the same graph must produce a deterministic initial layout');
  assertFiniteLayout(WELCOME_CYCLE, first);
  assertNodesDoNotOverlap(WELCOME_CYCLE, first);

  const start = centerOf(WELCOME_CYCLE, first, 'A');
  const editor = centerOf(WELCOME_CYCLE, first, 'B');
  const decision = centerOf(WELCOME_CYCLE, first, 'C');
  const textBranch = centerOf(WELCOME_CYCLE, first, 'D');
  const diagramBranch = centerOf(WELCOME_CYCLE, first, 'E');
  const preview = centerOf(WELCOME_CYCLE, first, 'F');
  const acceptance = centerOf(WELCOME_CYCLE, first, 'G');
  const exportNode = centerOf(WELCOME_CYCLE, first, 'H');
  assert.ok(start.x < editor.x, 'the entry node should precede the cyclic workflow in LR layout');
  assert.ok(editor.x < decision.x, 'the main B → C edge must not be chosen as the cycle feedback edge');
  assert.ok(decision.x < textBranch.x && decision.x < diagramBranch.x, 'both branches should follow the decision');
  assert.ok(textBranch.x < preview.x && diagramBranch.x < preview.x, 'parallel branches should merge into the preview');
  assert.ok(preview.x < acceptance.x, 'the preview should precede acceptance');
  assert.ok(acceptance.x < exportNode.x, 'the cycle exit should precede the export node in LR layout');
  assert.equal(Object.keys(first.routes).length, WELCOME_CYCLE.edges.length, 'every initial edge should receive a routed path');

  const rejectionRoute = first.routes['G-B'];
  assert.ok(rejectionRoute.points.length >= 6, 'the rejection edge should use an outer feedback lane');
  const intermediateTop = Math.min(...WELCOME_CYCLE.nodes
    .filter((current) => current.id !== 'B' && current.id !== 'G')
    .map((current) => first.positions[current.id].y));
  assert.ok(rejectionRoute.label.y < intermediateTop, 'the feedback lane should pass above, not through, the main nodes');
});

test('a wide layer of large nodes expands the canvas instead of compressing nodes into overlaps', () => {
  const details = ['+field1', '+field2', '+field3', '+field4', '+field5', '+field6'];
  const leaves = Array.from({ length: 7 }, (_, index) => node(
    `LargeClass${index + 1}`,
    'rectangle',
    { ref: `LargeClass${index + 1}`, details },
  ));
  const graph = {
    kind: 'class',
    direction: 'LR',
    nodes: [node('Root', 'rectangle', { ref: 'Root', details: ['+dispatch()'] }), ...leaves],
    edges: leaves.map((leaf, index) => edge(`root-${index + 1}`, 'Root', leaf.id)),
  };

  const layout = layoutMermaidGraph(graph);
  assertFiniteLayout(graph, layout);
  assertNodesDoNotOverlap(graph, layout);
  assert.ok(layout.height > 780, 'large same-rank nodes should grow beyond the legacy fixed canvas height');

  const leafCenters = leaves.map((leaf) => centerOf(graph, layout, leaf.id));
  const minLeafX = Math.min(...leafCenters.map((point) => point.x));
  const maxLeafX = Math.max(...leafCenters.map((point) => point.x));
  assert.ok(maxLeafX - minLeafX <= 0.001, 'siblings should remain in one LR rank');
});

test('changing only edge endpoints invalidates and changes the initial layout', () => {
  const nodes = ['A', 'B', 'C', 'D'].map((id) => node(id));
  const diamond = {
    kind: 'flowchart',
    direction: 'TD',
    nodes,
    edges: [
      edge('edge-1', 'A', 'B'),
      edge('edge-2', 'A', 'C'),
      edge('edge-3', 'B', 'D'),
      edge('edge-4', 'C', 'D'),
    ],
  };
  const chain = {
    ...diamond,
    edges: [
      edge('edge-1', 'A', 'B'),
      edge('edge-2', 'B', 'C'),
      edge('edge-3', 'C', 'D'),
      edge('edge-4', 'A', 'D'),
    ],
  };

  assert.deepEqual(chain.nodes.map((current) => current.id), diamond.nodes.map((current) => current.id));
  assert.notEqual(
    graphLayoutSignature(diamond),
    graphLayoutSignature(chain),
    'edge-only graph edits must change the layout dependency signature',
  );

  const diamondLayout = layoutMermaidGraph(diamond);
  const chainLayout = layoutMermaidGraph(chain);
  assert.notDeepEqual(chainLayout.positions, diamondLayout.positions, 'edge-only edits must be able to produce a fresh layout');
  assertFiniteLayout(diamond, diamondLayout);
  assertFiniteLayout(chain, chainLayout);
  assertNodesDoNotOverlap(diamond, diamondLayout);
  assertNodesDoNotOverlap(chain, chainLayout);

  const diamondB = centerOf(diamond, diamondLayout, 'B');
  const diamondC = centerOf(diamond, diamondLayout, 'C');
  const chainB = centerOf(chain, chainLayout, 'B');
  const chainC = centerOf(chain, chainLayout, 'C');
  assert.ok(Math.abs(diamondB.y - diamondC.y) <= 0.001, 'diamond siblings should share a TD rank');
  assert.ok(chainB.y < chainC.y, 'the changed B → C edge should place C after B');
});

test('many sequence participants expand, fit below the old zoom floor, and shrink after deletion', () => {
  const participants = Array.from({ length: 150 }, (_, index) => node(
    `Participant${index + 1}`,
    'rectangle',
    { ref: `P${index + 1}`, sequenceType: 'participant' },
  ));
  const graph = {
    kind: 'sequence',
    direction: 'LR',
    nodes: participants,
    edges: participants.slice(1).map((participant, index) => edge(
      `message-${index + 1}`,
      participants[index].id,
      participant.id,
    )),
  };
  const layout = layoutMermaidGraph(graph);
  assertFiniteLayout(graph, layout);
  assertNodesDoNotOverlap(graph, layout);
  assert.ok(layout.width > 37000, 'participant spacing should expand well beyond the legacy fixed width');

  const bounds = mermaidCanvasLayoutBounds(graph, layout);
  const fitZoom = mermaidCanvasFitZoom(bounds, 1058, 464, 0.9);
  assert.ok(fitZoom < 0.03, 'very large valid diagrams should fit below the old 10% zoom floor');
  assert.ok(fitZoom >= 0.02, 'fit zoom should remain within the usable canvas range');
  assert.ok(
    (bounds.maxX - bounds.minX) * fitZoom <= 1058 - 34,
    'fit quantization must never round upward and clip the diagram horizontally',
  );
  assert.ok(
    (bounds.maxY - bounds.minY) * fitZoom <= 464 - 34,
    'fit quantization must never round upward and clip the diagram vertically',
  );

  const reducedGraph = {
    ...graph,
    nodes: graph.nodes.slice(0, 5),
    edges: graph.edges.slice(0, 4),
  };
  const reducedLayout = layoutMermaidGraph(reducedGraph);
  assert.ok(reducedLayout.width < layout.width, 'removing sequence participants should shrink the generated stage');
  assertFiniteLayout(reducedGraph, reducedLayout);
  assertNodesDoNotOverlap(reducedGraph, reducedLayout);
});

test('an ordinary sequence diagram starts at a readable fit while retaining room for messages', () => {
  const participants = ['Client', 'API', 'Worker'].map((id) => node(
    id,
    'rectangle',
    { ref: id, sequenceType: 'participant' },
  ));
  const graph = {
    kind: 'sequence',
    direction: 'LR',
    nodes: participants,
    edges: [
      edge('request', 'Client', 'API'),
      edge('dispatch', 'API', 'Worker'),
      edge('result', 'Worker', 'API'),
      edge('response', 'API', 'Client'),
    ],
  };

  const layout = layoutMermaidGraph(graph);
  assertFiniteLayout(graph, layout);
  assertNodesDoNotOverlap(graph, layout);
  assert.equal(layout.height, MIN_MERMAID_SEQUENCE_STAGE_HEIGHT);

  const bounds = mermaidCanvasLayoutBounds(graph, layout);
  const fitZoom = mermaidCanvasFitZoom(bounds, 1058, 464, 0.9);
  assert.ok(fitZoom >= 0.7, `ordinary sequence diagrams should remain readable, received ${fitZoom}`);
  assert.ok((bounds.maxX - bounds.minX) * fitZoom <= 1058 - 34);
  assert.ok((bounds.maxY - bounds.minY) * fitZoom <= 464 - 34);
});

test('sequence message tokens expose their line and endpoint marker semantics', async (t) => {
  const fixtures = [
    ['->', { dashed: false, startMarker: 'none', endMarker: 'none' }],
    ['-->', { dashed: true, startMarker: 'none', endMarker: 'none' }],
    ['->>', { dashed: false, startMarker: 'none', endMarker: 'arrow' }],
    ['-->>', { dashed: true, startMarker: 'none', endMarker: 'arrow' }],
    ['-x', { dashed: false, startMarker: 'none', endMarker: 'cross' }],
    ['--x', { dashed: true, startMarker: 'none', endMarker: 'cross' }],
    ['-)', { dashed: false, startMarker: 'none', endMarker: 'async' }],
    ['--)', { dashed: true, startMarker: 'none', endMarker: 'async' }],
    ['<<->>', { dashed: false, startMarker: 'arrow', endMarker: 'arrow' }],
    ['<<-->>', { dashed: true, startMarker: 'arrow', endMarker: 'arrow' }],
  ];

  for (const [token, expected] of fixtures) {
    await t.test(token, () => {
      assert.deepEqual(mermaidSequenceMessageVisual(token), expected);
    });
  }
});

test('node geometry changes are distinguishable from edge-only edits', () => {
  const compact = {
    kind: 'class',
    direction: 'LR',
    nodes: [
      node('Root', 'rectangle', { ref: 'Root', details: ['+one'] }),
      node('Leaf', 'rectangle', { ref: 'Leaf', details: ['+one'] }),
    ],
    edges: [edge('root-leaf', 'Root', 'Leaf')],
  };
  const expanded = {
    ...compact,
    nodes: compact.nodes.map((current) => ({
      ...current,
      data: { ...current.data, details: ['+one', '+two', '+three', '+four', '+five', '+six'] },
    })),
  };
  assert.notEqual(
    graphNodeGeometrySignature(compact),
    graphNodeGeometrySignature(expanded),
    'detail rows that change node height must invalidate preserved geometry',
  );
  const expandedLayout = layoutMermaidGraph(expanded);
  assertFiniteLayout(expanded, expandedLayout);
  assertNodesDoNotOverlap(expanded, expandedLayout);
});

test('sequence message-only edits resize the stage with unchanged participants', () => {
  const participants = ['Client', 'API', 'Worker'].map((id) => node(
    id,
    'rectangle',
    { ref: id, sequenceType: 'participant' },
  ));
  const shortGraph = {
    kind: 'sequence',
    direction: 'LR',
    nodes: participants,
    edges: [edge('request', 'Client', 'API'), edge('dispatch', 'API', 'Worker')],
  };
  const longGraph = {
    ...shortGraph,
    edges: Array.from({ length: 18 }, (_, index) => edge(
      `message-${index + 1}`,
      participants[index % participants.length].id,
      participants[(index + 1) % participants.length].id,
    )),
  };
  assert.deepEqual(longGraph.nodes, shortGraph.nodes, 'the participant set should stay unchanged');
  assert.notEqual(graphLayoutSignature(shortGraph), graphLayoutSignature(longGraph));
  const shortLayout = layoutMermaidGraph(shortGraph);
  const longLayout = layoutMermaidGraph(longGraph);
  assert.ok(longLayout.height > shortLayout.height, 'additional messages should expand sequence stage height');
  assert.equal(longLayout.width, shortLayout.width, 'message-only edits should not change participant width');
});

test('simple chains respect every canvas direction', () => {
  for (const direction of ['TD', 'BT', 'LR', 'RL']) {
    const graph = {
      kind: 'flowchart',
      direction,
      nodes: ['A', 'B', 'C'].map((id) => node(id)),
      edges: [edge('A-B', 'A', 'B'), edge('B-C', 'B', 'C')],
    };
    const layout = layoutMermaidGraph(graph);
    assertFiniteLayout(graph, layout);
    assertNodesDoNotOverlap(graph, layout);
    const a = centerOf(graph, layout, 'A');
    const b = centerOf(graph, layout, 'B');
    const c = centerOf(graph, layout, 'C');
    if (direction === 'TD') assert.ok(a.y < b.y && b.y < c.y);
    if (direction === 'BT') assert.ok(a.y > b.y && b.y > c.y);
    if (direction === 'LR') assert.ok(a.x < b.x && b.x < c.x);
    if (direction === 'RL') assert.ok(a.x > b.x && b.x > c.x);
  }
});

test('reserved object property names remain valid Dagre node and edge IDs', () => {
  const reservedNodeIds = ['__proto__', 'constructor', 'prototype', 'toString'];
  const reservedEdgeIds = ['__proto__', 'constructor', 'prototype'];
  const graph = {
    kind: 'flowchart',
    direction: 'LR',
    nodes: reservedNodeIds.map((id) => node(id)),
    edges: reservedEdgeIds.map((id, index) => edge(id, reservedNodeIds[index], reservedNodeIds[index + 1])),
  };

  const layout = layoutMermaidGraph(graph);
  assertFiniteLayout(graph, layout);
  assertNodesDoNotOverlap(graph, layout);
  assert.equal(Object.getPrototypeOf(layout.positions), null, 'positions must not inherit reserved object keys');
  assert.equal(Object.getPrototypeOf(layout.routes), null, 'routes must not inherit reserved object keys');
  assert.deepEqual(Object.keys(layout.positions), reservedNodeIds, 'returned positions must preserve original node IDs');
  assert.deepEqual(Object.keys(layout.routes), reservedEdgeIds, 'returned routes must preserve original edge IDs');
  for (const id of reservedNodeIds) {
    assert.ok(Object.hasOwn(layout.positions, id), `${id} must be stored as an own position key`);
  }
  for (const id of reservedEdgeIds) {
    assert.ok(Object.hasOwn(layout.routes, id), `${id} must be stored as an own route key`);
    assert.ok(layout.routes[id].points.length >= 2, `${id} must retain its routed path`);
  }
});
