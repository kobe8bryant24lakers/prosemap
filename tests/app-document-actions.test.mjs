import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Execute the actual component handlers with controlled platform boundaries.
// UI wiring, focus ownership and native dialogs are covered by the E2E suite.
function loadHandler(path, name, bindings) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(matches.length, 1, `Expected one production handler named ${name}`);
  const javascript = ts.transpileModule(matches[0].getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return new Function(...Object.keys(bindings), `${javascript}\nreturn ${name};`)(...Object.values(bindings));
}

function shortcutHarness(dialogs = []) {
  const calls = [];
  const handle = loadHandler('../app/page.tsx', 'handleShortcut', {
    document: { querySelectorAll: () => dialogs },
    saveDocument: (saveAs) => calls.push(['save', saveAs]),
    openFile: () => calls.push(['open']),
    setAssistantAction: (action) => calls.push(['assistant', action]),
    setAssistantOpen: (open) => calls.push(['assistantOpen', open]),
  });
  const press = (key, options = {}) => {
    const event = {
      key, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...options,
    };
    handle(event);
    return event;
  };
  return { calls, press };
}

const dialog = (workbench = false, inert = false) => ({
  classList: { contains: (name) => workbench && name === 'mermaid-workbench' },
  closest: () => inert ? {} : null,
});

test('file shortcuts dispatch Save, Save As and Open for both platform modifiers', () => {
  for (const modifier of [{ metaKey: true, ctrlKey: false }, { metaKey: false, ctrlKey: true }]) {
    const { calls, press } = shortcutHarness();
    assert.equal(press('s', modifier).defaultPrevented, true);
    assert.equal(press('S', { ...modifier, shiftKey: true }).defaultPrevented, true);
    assert.equal(press('o', modifier).defaultPrevented, true);
    assert.deepEqual(calls, [['save', false], ['save', true], ['open']]);
  }
});

test('workbench permits ordinary main-document Save but blocks file replacement shortcuts', () => {
  const { calls, press } = shortcutHarness([dialog(true)]);
  press('s');
  assert.equal(press('S', { shiftKey: true }).defaultPrevented, true);
  assert.equal(press('o').defaultPrevented, true);
  press('M', { shiftKey: true });
  assert.deepEqual(calls, [['save', false]]);
});

test('other, nested and suspended modals block all background file shortcuts', () => {
  for (const dialogs of [[dialog()], [dialog(true), dialog()], [dialog(true, true)]]) {
    const { calls, press } = shortcutHarness(dialogs);
    for (const [key, options] of [['s', {}], ['S', { shiftKey: true }], ['o', {}]]) {
      assert.equal(press(key, options).defaultPrevented, true);
    }
    assert.deepEqual(calls, []);
  }
});

test('text input, consumed events and unrelated modifier combinations remain untouched', () => {
  const { calls, press } = shortcutHarness();
  assert.equal(press('s', { metaKey: false }).defaultPrevented, false);
  assert.equal(press('s', { altKey: true }).defaultPrevented, false);
  assert.equal(press('O', { shiftKey: true }).defaultPrevented, false);
  press('s', { defaultPrevented: true });
  assert.deepEqual(calls, []);
});

test('document entry reveals an editor and focuses it after the view update without replacing selection', () => {
  for (const initial of ['preview', 'editor', 'split']) {
    let mode = initial;
    let pendingFrame;
    let focused = false;
    const selection = Object.freeze({ from: 7, to: 12 });
    const view = { state: { selection }, focus: () => { focused = true; } };
    const activate = loadHandler('../app/page.tsx', 'returnToDocument', {
      setViewMode: (update) => { mode = update(mode); },
      editorRef: { current: { view } },
      window: { requestAnimationFrame: (callback) => { pendingFrame = callback; } },
    });
    activate();
    assert.equal(mode, initial === 'preview' ? 'editor' : initial);
    assert.equal(focused, false);
    pendingFrame();
    assert.equal(focused, true);
    assert.equal(view.state.selection, selection);
  }
});

function clipboardHarness(writeText) {
  const states = [];
  const timers = new Map();
  let nextTimer = 0;
  const copyRequestRef = { current: 0 };
  const copyResetTimerRef = { current: null };
  const code = 'flowchart LR\n  A[保留原始源码] --> B';
  const copy = loadHandler('../components/MermaidDiagram.tsx', 'copySource', {
    code,
    navigator: { clipboard: writeText ? { writeText } : undefined },
    copyRequestRef,
    copyResetTimerRef,
    setCopyState: (state) => states.push(state),
    window: {
      setTimeout: (callback, delay) => { assert.equal(delay, 2000); timers.set(++nextTimer, callback); return nextTimer; },
      clearTimeout: (id) => { timers.delete(id); },
    },
  });
  return { code, copy, copyRequestRef, copyResetTimerRef, states, timers };
}

test('clipboard success copies exact source and resets visible success feedback', async () => {
  let written;
  const h = clipboardHarness(async (text) => { written = text; });
  await h.copy();
  assert.equal(written, h.code);
  assert.deepEqual(h.states, ['idle', 'copied']);
  assert.equal(h.timers.size, 1);
  h.timers.get(h.copyResetTimerRef.current)();
  assert.equal(h.states.at(-1), 'idle');
});

test('clipboard rejection and unavailable clipboard show failure without unhandled rejection', async () => {
  for (const writeText of [async () => { throw new Error('Permission denied'); }, undefined]) {
    const h = clipboardHarness(writeText);
    await assert.doesNotReject(h.copy());
    assert.deepEqual(h.states, ['idle', 'failed']);
    assert.equal(h.timers.size, 1);
  }
});

test('a newer copy attempt owns feedback and cancels the preceding feedback timer', async () => {
  let completeFirst;
  let call = 0;
  const h = clipboardHarness(() => ++call === 1 ? new Promise((resolve) => { completeFirst = resolve; }) : Promise.reject(new Error('Denied')));
  const first = h.copy();
  await h.copy();
  completeFirst();
  await first;
  assert.deepEqual(h.states, ['idle', 'idle', 'failed']);
  assert.equal(h.timers.size, 1);
  const previousTimer = h.copyResetTimerRef.current;
  await h.copy();
  assert.equal(h.timers.has(previousTimer), false);
  assert.equal(h.timers.size, 1);
});

test('invalidated pending clipboard result cannot publish feedback after disposal', async () => {
  let complete;
  const h = clipboardHarness(() => new Promise((resolve) => { complete = resolve; }));
  const pending = h.copy();
  h.copyRequestRef.current += 1;
  complete();
  await pending;
  assert.deepEqual(h.states, ['idle']);
  assert.equal(h.timers.size, 0);
});
