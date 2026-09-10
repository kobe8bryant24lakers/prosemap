import assert from 'node:assert/strict';
import { test } from 'node:test';
import { english } from '../lib/translations.ts';
import { getLocale, setLocale, readSavedLocale, LOCALE_STORAGE_KEY, subscribeLocale, translate, t, uiMessage } from '../lib/i18n.ts';
import { initialDocument, templateSource } from '../lib/localized-content.ts';
import { MERMAID_TEMPLATES, parseMermaidVisualSource } from '../lib/mermaid-workbench.ts';

test('English is the default; language choices persist and notify subscribers', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) } });
  try {
    assert.equal(readSavedLocale(), 'en');
    values.set(LOCALE_STORAGE_KEY, 'invalid');
    assert.equal(readSavedLocale(), 'en');
    let changes = 0;
    const unsubscribe = subscribeLocale(() => changes++);
    setLocale('zh-CN');
    assert.equal(getLocale(), 'zh-CN');
    assert.equal(readSavedLocale(), 'zh-CN');
    assert.equal(t('保存'), '保存');
    setLocale('en');
    assert.equal(t('保存'), 'Save');
    assert.equal(changes, 2);
    unsubscribe();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
    setLocale('en');
  }
});

test('storage failure does not prevent language switching', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Unavailable'); } });
  try {
    assert.equal(readSavedLocale(), 'en');
    assert.doesNotThrow(() => setLocale('zh-CN'));
    assert.equal(getLocale(), 'zh-CN');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
    setLocale('en');
  }
});

test('interpolation preserves names and literal placeholder-looking content', () => {
  assert.equal(translate('已打开 {0}', 'en', '保存{1}.md'), 'Opened 保存{1}.md');
  assert.equal(translate('未知消息', 'en'), '未知消息');
  assert.equal(translate('从 {0} 创建{1}', 'en', '用户', 'message'), 'Create a message from 用户');
});

test('stored notices retranslate in both directions, preserving interpolation order', () => {
  setLocale('en');
  assert.equal(uiMessage('已打开 草稿.md'), 'Opened 草稿.md');
  setLocale('zh-CN');
  assert.equal(uiMessage('Create a message from User'), '从 User 创建message');
  setLocale('en');
});

test('every translated UI template preserves all placeholders', () => {
  const slots = (text) => [...text.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
  for (const [zh, en] of Object.entries(english)) assert.deepEqual(slots(en), slots(zh), zh);
});

test('built-in English examples are valid while existing source remains unchanged', () => {
  setLocale('en');
  assert.match(initialDocument(), /Turn complex ideas/);
  for (const template of MERMAID_TEMPLATES) {
    const original = template.source;
    const localized = templateSource(template);
    assert.ok(parseMermaidVisualSource(localized), template.id);
    assert.equal(template.source, original);
  }
  setLocale('zh-CN');
  assert.match(initialDocument(), /把复杂想法/);
  assert.equal(templateSource(MERMAID_TEMPLATES[0]), MERMAID_TEMPLATES[0].source);
  setLocale('en');
});
