import assert from 'node:assert/strict';
import test from 'node:test';
import { mermaidSafetyError } from '../lib/mermaid-workbench.ts';

for (const br of ['<br>', '<br/>', '<br />', '<BR/>']) {
  test(`Mermaid line break ${br} is accepted without rewriting the source`, () => {
    assert.equal(mermaidSafetyError(`flowchart LR\n  A["SYNTHETIC first${br}second"] --> B["SYNTHETIC end"]`), null);
    assert.equal(mermaidSafetyError(`sequenceDiagram\n  A->>B: SYNTHETIC first${br}second`), null);
  });
}

for (const annotation of ['interface', 'Abstract', 'Service', 'enumeration']) {
  test(`class annotation ${annotation} is Mermaid syntax in all three declaration forms`, () => {
    for (const body of [
      `class Synthetic <<${annotation}>>`,
      `class Synthetic\n<<${annotation}>> Synthetic`,
      `class Synthetic {\n  <<${annotation}>>\n  +run()\n}`,
    ]) {
      for (const eol of ['\n', '\r\n', '\r']) {
        assert.equal(mermaidSafetyError(`classDiagram\n${body}`.replaceAll('\n', eol)), null);
      }
    }
  });
}

for (const marker of ['choice', 'fork', 'join']) {
  test(`state ${marker} declaration is not HTML`, () => {
    assert.equal(mermaidSafetyError(`stateDiagram-v2\n  state Synthetic <<${marker}>>\n  [*] --> Synthetic`), null);
  });
}

for (const tag of [
  '<br onmouseover=alert(123456)>', '<br style="color:red">', '<br href="https://example.invalid">',
  '<br/onload=alert(123456)>', '<br\nonclick=alert(123456)>', '</br>', '<break>',
  '<script>alert(123456)</script>', '<svg onload=alert(123456)>', '<a href="https://example.invalid">link</a>',
  '<br/><img src=x onerror=alert(123456)>', '<<script>>', '<<img src=x onerror=alert(123456)>>',
  '<<interface>>', '<<choice>>',
]) {
  test(`HTML restrictions retain rejection of ${JSON.stringify(tag)}`, () => {
    assert.match(mermaidSafetyError(`flowchart LR\n  A["SYNTHETIC ${tag}"]`), /HTML/);
  });
}

test('annotation exceptions cannot hide HTML in declarations or other diagram contexts', () => {
  for (const source of [
    'classDiagram\n  class Synthetic <<script>>',
    'classDiagram\n  class Synthetic <<interface onload=alert(123456)>>',
    'classDiagram\n  class Synthetic <<interface>><script>alert(123456)</script>',
    'classDiagram\n  class Synthetic["<<interface>>"]',
    'stateDiagram-v2\n  state Synthetic <<choice>><img src=x>',
    'stateDiagram-v2\n  state Synthetic <<script>>',
    'flowchart LR\n  A["class Synthetic <<interface>>"]',
    'classDiagram\n  class Synthetic <<interface>>\n  A["<img src=x>"]',
    'classDiagram\n  class Synthetic <<interface>>\n  <script>alert(123456)</script>',
    'flowchart LR\n  A["SYNTHETIC multiline\n%% <script>alert(123456)</script>\nend"]',
  ]) assert.match(mermaidSafetyError(source), /HTML/);
});

test('declarations with Chinese identifiers, leading comments and CR line endings remain valid', () => {
  assert.equal(mermaidSafetyError('%% SYNTHETIC\rclassDiagram\r class 合成接口 <<interface>>'), null);
  assert.equal(mermaidSafetyError('%% SYNTHETIC\rstateDiagram-v2\r state 合成判定 <<choice>>'), null);
});

test('line-break support does not relax initialization, click, JavaScript or empty-source checks', () => {
  assert.equal(mermaidSafetyError('  \n'), '图表源码不能为空');
  assert.equal(mermaidSafetyError('%%{init: {}}%%\nflowchart LR\nA["SYNTHETIC<br/>text"]'), '不支持 Mermaid 初始化指令');
  assert.equal(mermaidSafetyError('flowchart LR\nA["SYNTHETIC<br/>text"]\nclick A "https://example.invalid"'), '不支持可点击链接指令');
  assert.equal(mermaidSafetyError('flowchart LR\nA["SYNTHETIC<br/>javascript:alert(123456)"]'), '不支持 JavaScript 链接');
});
