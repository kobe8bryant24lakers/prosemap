import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState, StateEffect, Transaction } from '@codemirror/state';
import { history, isolateHistory, undo, redo } from '@codemirror/commands';
import { documentLineEndings, normalizeDocumentText, serializeDocument } from '../lib/document-line-endings.ts';

function harness(raw) {
  let state = EditorState.create({ doc: normalizeDocumentText(raw), extensions: [history(), documentLineEndings(raw)] });
  const target = { get state() { return state; }, dispatch(transaction) { state = transaction.state; } };
  return {
    text: () => state.doc.toString(), raw: () => serializeDocument(state),
    edit: (changes, group = false) => { state = state.update({ changes, annotations: group ? [] : isolateHistory.of('full'), userEvent: 'input.type' }).state; },
    undo: () => undo(target), redo: () => redo(target),
    reconfigure: () => { state = state.update({ effects: StateEffect.reconfigure.of([history(), documentLineEndings(raw), EditorState.phrases.of({ Find: '查找' })]) }).state; },
  };
}

for (const raw of ['', '无换行🧭', 'a\nb\n', 'a\r\nb\r\n', 'a\rb\r', 'a\r\nb\nc\rd\r\n尾']) {
  test(`untouched document and selection retain exact endings: ${JSON.stringify(raw)}`, () => {
    const h = harness(raw);
    assert.equal(h.text(), normalizeDocumentText(raw));
    h.reconfigure();
    assert.equal(h.raw(), raw);
  });
}

test('edits retain untouched mixed endings; newly entered lines use predominant original ending', () => {
  const h = harness('a\r\nb\nc\rd\r\n尾');
  h.edit({ from: 2, to: 3, insert: '中文🧭' });
  assert.equal(h.raw(), 'a\r\n中文🧭\nc\rd\r\n尾');
  h.edit({ from: h.text().length, insert: '\n新增' });
  assert.equal(h.raw(), 'a\r\n中文🧭\nc\rd\r\n尾\r\n新增');
  h.undo(); h.undo();
  assert.equal(h.raw(), 'a\r\nb\nc\rd\r\n尾');
  h.redo(); h.redo();
  assert.equal(h.raw(), 'a\r\n中文🧭\nc\rd\r\n尾\r\n新增');
});

test('deleting across mixed line boundaries and undo restores original bytes', () => {
  const raw = 'a\r\nb\nc\rd';
  const h = harness(raw);
  h.edit({ from: 1, to: 6, insert: '' });
  assert.equal(h.raw(), 'ad');
  assert.equal(h.undo(), true);
  assert.equal(h.raw(), raw);
  assert.equal(h.redo(), true);
  assert.equal(h.raw(), 'ad');
});

test('multiple changes in one transaction map remaining breaks and inserted breaks', () => {
  const raw = 'a\r\nb\nc\rd';
  const h = harness(raw);
  h.edit([{ from: 0, insert: '新\n' }, { from: 2, to: 3, insert: 'B' }, { from: 7, insert: '\n末' }]);
  assert.equal(h.raw(), '新\r\na\r\nB\nc\rd\r\n末');
  h.undo(); assert.equal(h.raw(), raw);
  h.redo(); assert.equal(h.raw(), '新\r\na\r\nB\nc\rd\r\n末');
});

test('grouped typing history restores the earliest line-ending metadata and redoes all edits', () => {
  const raw = 'a\r\nb\nc';
  const h = harness(raw);
  h.edit({ from: 0, insert: 'X' }, true);
  h.edit({ from: 1, insert: 'Y' }, true);
  assert.equal(h.raw(), 'XYa\r\nb\nc');
  h.undo(); assert.equal(h.raw(), raw);
  h.redo(); assert.equal(h.raw(), 'XYa\r\nb\nc');
});

test('a new document starts with its own endings and empty history', () => {
  const a = harness('a\r\nb');
  a.edit({ from: 0, insert: '改' });
  const b = harness('other\nfile');
  assert.equal(b.undo(), false);
  b.edit({ from: 10, insert: '\nend' });
  assert.equal(b.raw(), 'other\nfile\nend');
});

test('reconfiguring extensions after edits keeps mapped endings and undo/redo metadata', () => {
  const raw = 'a\r\nb\nc';
  const h = harness(raw);
  h.edit({ from: 0, insert: 'XYZ' });
  h.reconfigure();
  assert.equal(h.raw(), 'XYZa\r\nb\nc');
  h.undo(); assert.equal(h.raw(), raw);
  h.reconfigure();
  h.redo(); assert.equal(h.raw(), 'XYZa\r\nb\nc');
  h.edit({ from: h.text().length, insert: '\n新行' });
  h.reconfigure();
  assert.equal(h.raw(), 'XYZa\r\nb\nc\r\n新行');
});

test('an unsupported non-history change cannot serialize stale offsets over ordinary text', () => {
  let state = EditorState.create({ doc: 'a\nb\nc', extensions: [history(), documentLineEndings('a\r\nb\nc')] });
  state = state.update({ changes: { from: 0, insert: 'X' } }).state;
  state = state.update({ changes: { from: 0, insert: '\n' }, annotations: Transaction.addToHistory.of(false) }).state;
  undo({ state, dispatch: (transaction) => { state = transaction.state; } });
  assert.equal(state.doc.toString(), '\na\nb\nc');
  assert.throws(() => serializeDocument(state), /行尾状态不一致/);
  assert.equal(state.doc.toString(), '\na\nb\nc');
});
