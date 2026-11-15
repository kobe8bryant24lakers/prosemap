import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { history, isolateHistory, undo, redo } from '@codemirror/commands';
import { minimalDocumentChanges } from '../lib/document-changes.ts';
import { documentLineEndings, normalizeDocumentText, serializeDocument } from '../lib/document-line-endings.ts';
import semanticFixtures from './fixtures/synthetic-semantic-persistence.json' with { type: 'json' };

function harness(raw) {
  let state = EditorState.create({ doc: normalizeDocumentText(raw), extensions: [history(), documentLineEndings(raw)] });
  const target = { get state() { return state; }, dispatch(transaction) { state = transaction.state; } };
  return {
    text: () => state.doc.toString(),
    raw: () => serializeDocument(state),
    apply(replacement, from = 0, to = state.doc.length) {
      const changes = minimalDocumentChanges(state.sliceDoc(from, to), replacement, from);
      assert.notEqual(changes, null, 'this bounded fixture must yield a complete edit plan');
      state = state.update({ changes, annotations: isolateHistory.of('full'), userEvent: 'input.apply' }).state;
      return changes;
    },
    undo: () => undo(target), redo: () => redo(target),
  };
}

test('unchanged input returns no changes at any valid document offset', () => {
  for (const previous of ['', '内容🧭', 'first\nsecond\n']) {
    assert.deepEqual(minimalDocumentChanges(previous, previous, 0), []);
    assert.deepEqual(minimalDocumentChanges(previous, previous, 27), []);
  }
});

test('pure insertions and deletions bypass diff search, including inside an existing string', (t) => {
  t.mock.method(Date, 'now', () => { throw new Error('pure changes must not start a diff search'); });
  assert.deepEqual(minimalDocumentChanges('', '新增\n🧭', 7), [{ from: 7, to: 7, insert: '新增\n🧭' }]);
  assert.deepEqual(minimalDocumentChanges('删除🧭', '', 7), [{ from: 7, to: 11, insert: '' }]);
  assert.deepEqual(minimalDocumentChanges('ab', 'a\nnew\nb', 10), [{ from: 11, to: 11, insert: '\nnew\n' }]);
  assert.deepEqual(minimalDocumentChanges('a\nold\nb', 'ab', 10), [{ from: 11, to: 16, insert: '' }]);
  assert.deepEqual(minimalDocumentChanges('😀', '😁😀', 4), [{ from: 4, to: 4, insert: '😁' }]);
  assert.deepEqual(minimalDocumentChanges('😁😀', '😀', 4), [{ from: 4, to: 6, insert: '' }]);
});

test('separate replacements leave all intervening equal characters outside the changes', () => {
  assert.deepEqual(minimalDocumentChanges('first\nmiddle\nthird', 'FIRST\nmiddle\nTHIRD', 12), [
    { from: 12, to: 17, insert: 'FIRST' },
    { from: 25, to: 30, insert: 'THIRD' },
  ]);
});

test('emoji edits use UTF-16 offsets and never split their surrogate pairs', () => {
  const before = '前🧭中😀后\n尾';
  const after = '前🧠中😃后\n尾追加🧩';
  const changes = minimalDocumentChanges(before, after, 5);
  assert.deepEqual(changes, [
    { from: 6, to: 8, insert: '🧠' },
    { from: 9, to: 11, insert: '😃' },
    { from: 5 + before.length, to: 5 + before.length, insert: '追加🧩' },
  ]);
  const state = EditorState.create({ doc: `12345${before}suffix` }).update({ changes }).state;
  assert.equal(state.doc.toString(), `12345${after}suffix`);
});

test('separated document replacements retain CRLF/LF/CR bytes through real undo and redo', () => {
  const original = 'first\r\nmiddle\nthird\rend\r\n';
  const h = harness(original);
  const first = original.replace('first', 'FIRST').replace('third', 'THIRD');
  assert.equal(h.apply(normalizeDocumentText(first)).length, 2);
  assert.equal(h.raw(), first);
  const second = first.replace('middle', '中间🧭').replace('end', '尾部');
  h.apply(normalizeDocumentText(second));
  assert.equal(h.raw(), second);
  assert.equal(h.undo(), true); assert.equal(h.raw(), first);
  assert.equal(h.undo(), true); assert.equal(h.raw(), original);
  assert.equal(h.redo(), true); assert.equal(h.raw(), first);
  assert.equal(h.redo(), true); assert.equal(h.raw(), second);
});

test('a subrange after emoji preserves outside bytes and mixed line endings within the range', () => {
  const original = '前缀🧭\r\nfirst\nmiddle\rthird\r\n后缀';
  const h = harness(original);
  const from = h.text().indexOf('first');
  const to = h.text().indexOf('\n后缀');
  h.apply('FIRST\nmiddle\nTHIRD', from, to);
  const expected = original.replace('first', 'FIRST').replace('third', 'THIRD');
  assert.equal(h.raw(), expected);
  h.undo(); assert.equal(h.raw(), original);
  h.redo(); assert.equal(h.raw(), expected);
});

test('line deletion and insertion only remove replaced breaks, and new lines use the original dominant style', () => {
  const original = 'start\r\nalpha\nmiddle\rthird\r\nend';
  const h = harness(original);
  h.apply(h.text().replace('alpha\n', '').replace('third', 'third\nnew'));
  assert.equal(h.raw(), 'start\r\nmiddle\rthird\r\nnew\r\nend');
  h.undo(); assert.equal(h.raw(), original);
  h.redo(); assert.equal(h.raw(), 'start\r\nmiddle\rthird\r\nnew\r\nend');
});

test('repeated line text does not turn the surrounding line breaks into replacements', () => {
  const h = harness('same\r\nsame\nsame\r');
  h.apply('same\nNEW\nsame\n');
  assert.equal(h.raw(), 'same\r\nNEW\nsame\r');
});

test('invalid offsets refuse an edit plan', () => {
  for (const from of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.equal(minimalDocumentChanges('old', 'new', from), null);
  }
});

test('large diff timeout returns null with no whole-range replacement fallback', (t) => {
  let clock = 1000;
  t.mock.method(Date, 'now', () => clock += 81);
  assert.equal(minimalDocumentChanges('old\nkeep\nlast'.repeat(200), 'NEW\nkeep\nTAIL'.repeat(200), 6), null);
  assert.equal(minimalDocumentChanges('a'.repeat(1000), 'b'.repeat(1000), 6), null);
});

test('small exact fallback preserves mixed line endings and history after the fast diff times out', (t) => {
  let clock = 1000;
  t.mock.method(Date, 'now', () => clock += 81);
  const original = 'old🧭\r\nkeep\nlast😀\rtail';
  const changed = 'NEW🧠\r\nkeep\nTAIL😃\rtail';
  const h = harness(original);
  h.apply(normalizeDocumentText(changed));
  assert.equal(h.raw(), changed);
  h.undo(); assert.equal(h.raw(), original);
  h.redo(); assert.equal(h.raw(), changed);
});

test('all synthetic semantic replacements complete exactly even when the fast diff times out', (t) => {
  let clock = 1000;
  t.mock.method(Date, 'now', () => clock += 81);
  for (const item of semanticFixtures.templates) {
    const h = harness(`SYNTHETIC prefix🧭\n${item.before}\nSYNTHETIC suffix`);
    const from = h.text().indexOf(item.before);
    h.apply(item.after, from, from + item.before.length);
    assert.equal(h.text(), `SYNTHETIC prefix🧭\n${item.after}\nSYNTHETIC suffix`, item.template);
    h.undo(); assert.equal(h.text(), `SYNTHETIC prefix🧭\n${item.before}\nSYNTHETIC suffix`);
  }
});

test('the bounded diff still completes when its clock remains at the 80 ms limit', (t) => {
  let reads = 0;
  t.mock.method(Date, 'now', () => reads++ === 0 ? 1000 : 1080);
  assert.deepEqual(minimalDocumentChanges('a', 'b', 2), [{ from: 2, to: 3, insert: 'b' }]);
});

test('small varied Unicode edit plans replay exactly through CodeMirror', () => {
  const samples = ['', '🧭', 'a\nb\nc', '甲🧭乙\n丙', 'repeat repeat\nrepeat', '\n\n尾\n'];
  for (const previous of samples) for (const replacement of samples) {
    const changes = minimalDocumentChanges(previous, replacement, 2);
    assert.notEqual(changes, null);
    const state = EditorState.create({ doc: `🧭${previous}尾部` }).update({ changes }).state;
    assert.equal(state.doc.toString(), `🧭${replacement}尾部`);
    for (let index = 1; index < changes.length; index++) assert.ok(changes[index - 1].to <= changes[index].from);
  }
});
