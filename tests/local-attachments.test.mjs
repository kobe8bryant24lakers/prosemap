import assert from 'node:assert/strict';
import test from 'node:test';
import { isRelativeFileLink } from '../lib/preview-links.ts';
import { clipboardImageFiles, imageMarkdown } from '../lib/image-paste.ts';

test('relative attachments support Unicode, spaces, encoded paths and parent folders', () => {
  for (const path of ['./报表.xlsx', '../资料/年报%20最终.pdf', 'files\\budget.xls', '附件/图 表.png', './report.xlsx#Sheet1']) assert.ok(isRelativeFileLink(path), path);
  for (const path of ['', '/tmp/a.xlsx', '//server/share/a.xlsx', '\\server\a.xlsx', 'C:\\a.xlsx', 'file:///a.xlsx', 'https://example.com/a.xlsx', 'javascript:alert(1)', '#title', '\nfile.xlsx', 'a\u0000.xlsx']) assert.equal(isRelativeFileLink(path), false, path);
});

test('clipboard images are captured once and normal text paste stays untouched', () => {
  const screenshot = new File(['png'], 'image.png', { type: 'image/png' });
  const fileCopy = new File(['jpg'], '照片.JPG');
  const text = new File(['hello'], 'note.txt', { type: 'text/plain' });
  const items = [{ kind: 'file', getAsFile: () => screenshot }];
  assert.deepEqual(clipboardImageFiles({ files: [screenshot, fileCopy, text], items }), [screenshot, fileCopy]);
  assert.deepEqual(clipboardImageFiles({ files: [], items }), [screenshot]);
  assert.deepEqual(clipboardImageFiles({ files: [], items: [{ kind: 'string', getAsFile: () => null }] }), []);
});

test('image references escape labels and encode relative paths without embedding data', () => {
  assert.equal(imageMarkdown('images/截图 (1).png', '截图 [1].png'), '![截图 \\[1\\]](images/%E6%88%AA%E5%9B%BE%20%281%29.png)');
});
