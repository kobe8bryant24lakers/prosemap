import { test, expect } from '@playwright/test';
import { launchDocument, mod, savedSource } from './helpers';

const cases = [
  {
    "language": "json",
    "file": "format-json.md",
    "original": "# 格式化 json\n\n```json\n{\"name\":\"中文🧭\",\"list\":[1,2,3]}\n```\n\nTAIL-保持\n",
    "expected": "# 格式化 json\n\n```json\n{\n  \"name\": \"中文🧭\",\n  \"list\": [\n    1,\n    2,\n    3\n  ]\n}\n```\n\nTAIL-保持\n"
  },
  {
    "language": "javascript",
    "file": "format-javascript.md",
    "original": "# 格式化 javascript\n\n```javascript\nfunction f(x){return {value:x+1}}\n```\n\nTAIL-保持\n",
    "expected": "# 格式化 javascript\n\n```javascript\nfunction f(x) {\n  return { value: x + 1 };\n}\n```\n\nTAIL-保持\n"
  },
  {
    "language": "typescript",
    "file": "format-typescript.md",
    "original": "# 格式化 typescript\n\n```typescript\ntype User={id:string;name:string};const user:User={id:\"a\",name:\"中文\"};\n```\n\nTAIL-保持\n",
    "expected": "# 格式化 typescript\n\n```typescript\ntype User = { id: string; name: string };\nconst user: User = { id: \"a\", name: \"中文\" };\n```\n\nTAIL-保持\n"
  },
  {
    "language": "css",
    "file": "format-css.md",
    "original": "# 格式化 css\n\n```css\n.a{color:red;padding:1px 2px}\n```\n\nTAIL-保持\n",
    "expected": "# 格式化 css\n\n```css\n.a {\n  color: red;\n  padding: 1px 2px;\n}\n```\n\nTAIL-保持\n"
  },
  {
    "language": "html",
    "file": "format-html.md",
    "original": "# 格式化 html\n\n```html\n<section><h2>中文</h2><p>test</p></section>\n```\n\nTAIL-保持\n",
    "expected": "# 格式化 html\n\n```html\n<section>\n  <h2>中文</h2>\n  <p>test</p>\n</section>\n```\n\nTAIL-保持\n"
  },
  {
    "language": "yaml",
    "file": "format-yaml.md",
    "original": "# 格式化 yaml\n\n```yaml\nname: fixture\nitems: [one,two,three]\n```\n\nTAIL-保持\n",
    "expected": "# 格式化 yaml\n\n```yaml\nname: fixture\nitems: [one, two, three]\n```\n\nTAIL-保持\n"
  }
];

for (const item of cases) {
  test(`format ${item.language}: only the target block changes; one undo restores the entire document`, async ({ page }) => {
    await launchDocument(page, item.original);
    await page.locator('.cm-content').click();
    await page.keyboard.press(`${mod}+Home`);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press(`${mod}+Shift+F`);
    await expect(page.locator('.toast')).toBeVisible();
    await expect(page.getByText(`${item.language.toUpperCase()} 代码已格式化，可撤销`, { exact: true })).toBeVisible();
    expect(await savedSource(page)).toBe(item.expected);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(await savedSource(page)).toBe(item.original);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect(await savedSource(page)).toBe(item.expected);
  });
}

const boundaries = [
  {
    "name": "none",
    "file": "format-boundary-none.md",
    "original": "# 没有代码\n\n普通正文\n",
    "message": "请将光标放入带有语言标记的顶层代码块中",
    "down": 2
  },
  {
    "name": "unknown",
    "file": "format-boundary-unknown.md",
    "original": "# 未知语言\n\n```fixture-unknown\na :  b\n```\n",
    "message": "暂不支持 fixture-unknown 自动格式化",
    "down": 3
  },
  {
    "name": "invalid",
    "file": "format-boundary-invalid.md",
    "original": "# 非法 JSON\n\n```json\n{\"a\":]\n```\n",
    "message": "格式化失败",
    "down": 3
  },
  {
    "name": "nested",
    "file": "format-boundary-nested.md",
    "original": "# 嵌套代码\n\n> ```json\n> {\"a\":1}\n> ```\n",
    "message": "请将光标放入带有语言标记的顶层代码块中",
    "down": 3
  }
];
for (const item of boundaries) {
  test(`format boundary ${item.name}: explains rejection and preserves all bytes`, async ({ page }) => {
    await launchDocument(page, item.original);
    await page.locator('.cm-content').click();
    await page.keyboard.press(`${mod}+Home`);
    for (let i = 0; i < item.down; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press(`${mod}+Shift+F`);
    await expect(page.locator('.toast')).toContainText(item.message);
    expect(await savedSource(page)).toBe(item.original);
  });
}
