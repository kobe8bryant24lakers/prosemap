import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Structural guards complement (not replace) the native Computer Use regressions.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('native user Quit is routed through the interceptable window close path', () => {
  const source = read('../src-tauri/src/lib.rs');
  const route = source.slice(source.indexOf('if let tauri::RunEvent::ExitRequested'), source.indexOf('if let tauri::RunEvent::Opened'));
  assert.match(route, /code: None/);
  assert.match(route, /get_webview_window\("main"\)/);
  assert.match(route, /api\.prevent_exit\(\)/);
  assert.match(route, /window\.close\(\)/);
  assert.doesNotMatch(route, /window\.destroy\(|app_handle\.exit\(/);
  assert.match(source, /install_guarded_quit_menu\(app\.handle\(\)\)/);
  assert.match(source, /"guarded-quit"/);
  assert.match(source, /CmdOrCtrl\+Q/);
  assert.match(source, /\.on_menu_event\(/);
});

test('canvas deletion restores focus before the selected controls unmount', () => {
  const source = read('../components/MermaidCanvasEditor.tsx');
  const removal = source.slice(source.indexOf('function removeSelection()'), source.indexOf('function updateNode('));
  assert.match(removal, /setSelection\(null\)/);
  assert.match(removal, /editorRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
});

test('editor toolbar can wrap without compressing or hiding its actions', () => {
  const css = read('../app/globals.css');
  for (const selector of ['editor-header', 'format-actions', 'editor-ai-actions']) {
    const rule = css.match(new RegExp(`\\.${selector} \\{([^}]+)\\}`))?.[1];
    assert.match(rule, /flex-wrap: wrap/);
  }
  for (const selector of ['format-actions', 'editor-ai-actions']) {
    assert.match(css.match(new RegExp(`\\.${selector} button \\{([^}]+)\\}`))?.[1], /flex: none/);
  }
  assert.doesNotMatch(css, /\.format-actions button:nth-child\([^)]*\)\s*\{\s*display: none/);
});
