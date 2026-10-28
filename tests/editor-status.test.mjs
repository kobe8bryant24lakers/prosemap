import assert from 'node:assert/strict';
import test from 'node:test';
import { countReadableCharacters } from '../lib/editor.ts';

test('visible character count ignores whitespace and includes source punctuation', () => {
  assert.equal(countReadableCharacters(' \n\t\r\u00a0'), 0);
  assert.equal(countReadableCharacters('中文 😀'), 3);
  assert.equal(countReadableCharacters('```js\nconst x = 1;\n```'), 17);
});

test('compound emoji and combining accents count as visible characters', () => {
  assert.equal(countReadableCharacters('👨‍👩‍👧‍👦 🇨🇳 👍🏽 e\u0301'), 4);
  assert.equal(countReadableCharacters('é'), countReadableCharacters('e\u0301'));
});
