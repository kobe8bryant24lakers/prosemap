import { expect, test } from '@playwright/test';
import { draftSource, editorSource, launchDocument } from './helpers';

const oldSource = 'flowchart LR\nA[SYNTHETIC_OLD] --> B[End]';
const nextSource = 'erDiagram\nSYNTHETIC_NEW ||--o{ SYNTHETIC_CHILD : owns';
const documentFor = (title: string, source: string) => `# ${title}\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`;

test('deferred preview cannot offer a diagram from the previous document', async ({ page }) => {
  // Hold delivery of deferred Markdown, not Mermaid rendering. This controls
  // the old-preview/new-editor interval seen in CI without relying on CPU speed.
  await page.route(/\/app\/page\.tsx(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    const body = await response.text();
    const expression = 'useDeferredValue(previewSnapshot)';
    expect(body).toContain(expression);
    await route.fulfill({ response, body: body.replace(expression, 'useHeldPreview(previewSnapshot)') + `
function useHeldPreview(content) {
  const deferred = useDeferredValue(content);
  const previous = useRef(deferred);
  if (!window.__holdSyntheticPreview) previous.current = deferred;
  return previous.current;
}
` });
  });
  const original = documentFor('Synthetic old document', oldSource);
  const replacement = documentFor('Synthetic new document', nextSource);
  await launchDocument(page, original, 'synthetic-old.md');
  const edit = page.getByRole('button', { name: '在可视化画布中编辑图表', exact: true });
  await expect(page.locator('.mermaid-svg')).toContainText('SYNTHETIC_OLD');
  await expect(edit).toBeVisible();
  await page.evaluate(content => {
    const w = window as any;
    w.__holdSyntheticPreview = true;
    w.__acceptance.nextFile = { path: '/acceptance/synthetic-new.md', name: 'synthetic-new.md', content };
  }, replacement);
  await page.getByRole('button', { name: '打开文件', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('synthetic-new');
  expect(await editorSource(page)).toBe(replacement);
  await expect(page.locator('.preview-pane')).toContainText('Synthetic old document');
  await expect(edit).toHaveCount(0);
  await expect(page.locator('.mermaid-canvas.editable')).toHaveCount(0);
  await expect(page.locator('.mermaid-workbench')).toHaveCount(0);

  await page.evaluate(() => { (window as any).__holdSyntheticPreview = false; });
  // A normal UI update delivers the held preview without changing the document.
  await page.getByRole('button', { name: '纯预览', exact: true }).click();
  await expect(page.locator('.preview-pane')).toContainText('Synthetic new document');
  await edit.click();
  await expect(page.locator('.mermaid-workbench')).toBeVisible();
  expect(await draftSource(page)).toBe(nextSource);
  expect(await editorSource(page)).toBe(replacement);
});
