import assert from 'node:assert/strict';
import test from 'node:test';
import { isRelativeImageSource } from '../lib/preview-images.ts';

test('document-relative images include parent folders, spaces, Unicode and encoded names', () => {
  for (const source of ['image.png', './assets/图 片.png', '../images/a%20b.png', 'assets\\photo.jpg', 'image.svg#icon']) {
    assert.equal(isRelativeImageSource(source), true, source);
  }
});

test('URLs and absolute paths are not treated as document-relative images', () => {
  for (const source of ['', '#icon', 'https://example.com/a.png', '//example.com/a.png', 'data:image/png;base64,AA', 'blob:abc', 'file:///tmp/a.png', '/tmp/a.png', 'C:\\images\\a.png', '\\\\server\\a.png']) {
    assert.equal(isRelativeImageSource(source), false, source);
  }
});
