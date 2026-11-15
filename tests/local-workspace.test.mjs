import assert from 'node:assert/strict';
import test from 'node:test';
import { includeSavedFile } from '../lib/local-workspace.ts';

const document = (path, name = 'saved.md') => ({ path, name, content: '# Synthetic data' });
const workspace = (root, files = []) => ({ root, name: 'Synthetic workspace', files });

test('saved files appear in sorted relative paths without mutating the prior list', () => {
  const original = workspace('/acceptance', [{ path: '/acceptance/z.md', name: 'z.md', relativePath: 'z.md' }]);
  const updated = includeSavedFile(original, document('/acceptance/子目录/saved.md'));
  assert.deepEqual(updated.files.map(file => file.relativePath), ['z.md', '子目录/saved.md']);
  const first = includeSavedFile(updated, document('/acceptance/a.md', 'a.md'));
  assert.deepEqual(first.files.map(file => file.relativePath), ['a.md', 'z.md', '子目录/saved.md']);
  assert.equal(original.files.length, 1);
  assert.equal(includeSavedFile(first, document('/acceptance/a.md', 'a.md')), first);
});

test('another workspace, sibling prefix, or invalid relative path is never included', () => {
  const original = workspace('/acceptance');
  for (const path of ['/elsewhere/saved.md', '/acceptance-other/saved.md', '/acceptance', '/acceptance/../saved.md', '/acceptance/./saved.md']) {
    assert.equal(includeSavedFile(original, document(path)), original);
  }
  assert.equal(includeSavedFile(null, document('/acceptance/saved.md')), null);
});

test('canonical Windows drive and UNC roots preserve native relative separators', () => {
  for (const root of ['C:\\acceptance', '\\\\?\\C:\\acceptance', '\\\\server\\share', '\\\\?\\UNC\\server\\share']) {
    const updated = includeSavedFile(workspace(root), document(root + '\\sub\\saved.md'));
    assert.equal(updated.files[0].relativePath, 'sub\\saved.md');
  }
  assert.equal(includeSavedFile(workspace('C:\\'), document('C:\\saved.md')).files[0].relativePath, 'saved.md');
});

test('POSIX root and literal backslashes in POSIX filenames keep their meaning', () => {
  assert.equal(includeSavedFile(workspace('/'), document('/saved.md')).files[0].relativePath, 'saved.md');
  assert.equal(includeSavedFile(workspace('/acceptance/'), document('/acceptance/back\\slash.md')).files[0].relativePath, 'back\\slash.md');
});
