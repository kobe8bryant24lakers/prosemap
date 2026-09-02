import assert from 'node:assert/strict';
import test from 'node:test';

import { compactJsonPreviewIndentation } from '../lib/markdown-preview.ts';

test('JSON preview compacts common four-space indentation to two spaces', () => {
  const source = [
    '{',
    '    "nested": {',
    '        "items": [',
    '            1',
    '        ]',
    '    }',
    '}',
  ].join('\n');
  const expected = [
    '{',
    '  "nested": {',
    '    "items": [',
    '      1',
    '    ]',
    '  }',
    '}',
  ].join('\n');

  assert.equal(compactJsonPreviewIndentation(source), expected);
});

test('JSON preview preserves two-space indentation and exact value syntax', () => {
  const source = [
    '{',
    '  "id": 9007199254740993,',
    '  "id": 1e3',
    '}',
    '',
  ].join('\r\n');

  assert.equal(compactJsonPreviewIndentation(source), source);
});

test('JSON preview displays tab indentation as two spaces', () => {
  const source = '{\n\t"nested": {\n\t\t"ready": true\n\t}\n}';
  const expected = '{\n  "nested": {\n    "ready": true\n  }\n}';

  assert.equal(compactJsonPreviewIndentation(source), expected);
});

test('JSON preview keeps equivalent tab and two-space indentation aligned', () => {
  const source = '{\n\t"fromTab": true,\n  "fromSpaces": true\n}';
  const expected = '{\n  "fromTab": true,\n  "fromSpaces": true\n}';

  assert.equal(compactJsonPreviewIndentation(source), expected);
});

test('invalid JSON preview remains byte-for-byte unchanged', () => {
  const source = '{\n    // JSONC stays untouched\n    "ready": true,\n}';

  assert.equal(compactJsonPreviewIndentation(source), source);
});
