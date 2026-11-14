import { expect, test } from '@playwright/test';
import { launchDocument, draftSource, savedSource } from './helpers';
const source = 'flowchart LR\nA["SYNTHETIC repeated 中文🧭"] --> B["SYNTHETIC end"]';
const original = `# SYNTHETIC preview entry\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nSYNTHETIC_BETWEEN\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nSYNTHETIC_END\n`;
for (const gesture of ['click', 'dblclick'] as const) {
 test(`stale preview ${gesture} rejects an old range after a same-event editor transaction`, async ({ page }) => {
  await launchDocument(page, original);
  await expect(page.locator('.preview-pane .mermaid-svg svg')).toHaveCount(2);
  const selector = gesture === 'click' ? '.diagram-edit-action' : '.mermaid-canvas';
  await page.evaluate(({ gesture, selector }) => {
   const el = document.querySelectorAll('.preview-pane '+selector)[1];
   el.addEventListener(gesture, event => {
    const view = (document.querySelector('.cm-content') as any).cmTile.root.view;
    (window as any).__staleEntry = { trusted: event.isTrusted, before: view.state.doc.toString() };
    view.dispatch({ changes: { from: 0, insert: 'SYNTHETIC_SHIFT\n\n' } });
    (window as any).__staleEntry.after = view.state.doc.toString();
   }, { capture: true, once: true });
  }, { gesture, selector });
  if (gesture === 'click') await page.locator('.preview-pane '+selector).nth(1).click();
  else await page.locator('.preview-pane '+selector).nth(1).dblclick();
  await expect(page.locator('.toast')).toContainText('预览正在更新');
  await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__staleEntry.trusted)).toBe(true);
  expect(await savedSource(page)).toBe('SYNTHETIC_SHIFT\n\n'+original);
  await page.locator('.preview-pane .diagram-edit-action').nth(1).click();
  expect(await draftSource(page)).toBe(source);
  await page.getByRole('textbox', { name: 'Mermaid 源码编辑器', exact: true }).fill(source.replace('repeated','SECOND_ONLY'));
  await page.getByRole('button', { name: '应用到文档', exact: true }).click();
  const saved = await savedSource(page), offset = original.lastIndexOf(source);
  expect(saved).toBe('SYNTHETIC_SHIFT\n\n'+original.slice(0,offset)+source.replace('repeated','SECOND_ONLY')+original.slice(offset+source.length));
 });
}
test('an open inline fullscreen renders direct invalid source and recovers with the latest source', async ({ page }) => {
 const single = `# SYNTHETIC fullscreen direct\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`;
 await launchDocument(page,single);
 await expect(page.locator('.preview-pane .mermaid-svg svg')).toHaveCount(1);
 await page.getByRole('button',{name:'全屏查看图表',exact:true}).click();
 const dialog=page.locator('.mermaid-fullscreen-dialog');
 await expect(dialog.locator('.mermaid-fullscreen-svg svg')).toContainText('SYNTHETIC repeated');
 const update=async(code:string)=>page.evaluate(({code})=>{
  const view=(document.querySelector('.cm-content') as any).cmTile.root.view,doc=view.state.doc.toString();
  const from=doc.indexOf('```mermaid\n')+11,to=doc.indexOf('\n```',from);view.dispatch({changes:{from,to,insert:code}});
 },{code});
 await update('SYNTHETIC_INVALID_SOURCE');
 await expect(dialog).toBeVisible(); await expect(dialog.locator('.mermaid-error')).toBeVisible();
 await expect(dialog.locator('.mermaid-fullscreen-svg svg')).toHaveCount(0);
 await update(source.replace('repeated','RECOVERED'));
 await expect(dialog.locator('.mermaid-fullscreen-svg svg')).toContainText('SYNTHETIC RECOVERED');
 await expect(dialog.locator('.mermaid-error')).toHaveCount(0);
 await page.keyboard.press('Escape'); await page.getByRole('button',{name:'全屏查看图表',exact:true}).click();
 await expect(dialog.locator('.mermaid-fullscreen-svg svg')).toContainText('SYNTHETIC RECOVERED');
 await page.keyboard.press('Escape'); expect(await savedSource(page)).toBe(single.replace('repeated','RECOVERED'));
});
