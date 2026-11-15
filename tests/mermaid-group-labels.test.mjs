import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseMermaidVisualSource, serializeMermaidVisualGraph } from '../lib/mermaid-workbench.ts';
import { MermaidSourceHistory } from '../lib/mermaid-source-preservation.ts';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/canvas-group-templates.json', import.meta.url), 'utf8'));
for (const item of fixtures.templates) {
  for (const newline of ['\n', '\r\n']) {
    test(`${item.template} ${JSON.stringify(newline)}: quoted group titles round-trip with exact source history`, () => {
      const source = item.source.replaceAll('\n', newline) + newline;
      const before = parseMermaidVisualSource(source);
      const label = 'SYNTHETIC 中文 "订购" & 履约 | 服务';
      const after = { ...before, data: { ...before.data, groups: before.data.groups.map(group => group.id === 'SyntheticMiddle' ? { ...group, label } : group) } };
      const history = new MermaidSourceHistory();
      const changed = history.commit(source, before, after);
      assert.equal(changed, source.replace('SYNTHETIC Middle"', 'SYNTHETIC 中文 #quot;订购#quot; #38; 履约 #124; 服务"'));
      assert.deepEqual(parseMermaidVisualSource(changed), after);
      assert.equal(history.commit(changed, after, before), source);
      assert.equal(history.commit(source, before, after), changed);
    });
  }
}

test('group names reject empty and syntax-breaking input before committing source', () => {
  const graph = parseMermaidVisualSource(fixtures.templates[0].source);
  for (const label of ['', '   ', '\t']) {
    const edited = structuredClone(graph);
    edited.data.groups[0].label = label;
    assert.throws(() => serializeMermaidVisualGraph(edited), /名称不能为空/);
  }
  for (const label of ['SYNTHETIC\nend', 'SYNTHETIC; end', 'SYNTHETIC #quot;']) {
    const edited = structuredClone(graph);
    edited.data.groups[0].label = label;
    assert.throws(() => serializeMermaidVisualGraph(edited), /换行、分号或 #/);
  }
});
