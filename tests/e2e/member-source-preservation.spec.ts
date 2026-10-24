import { expect, test } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, savedSource, showCanvas } from './helpers';

for (const kind of ['class', 'er'] as const) {
  test(`${kind}: twelve detail rows keep original declaration order and exact source through canvas/document history`, async ({ page }) => {
    const declaration = (id: string) => kind === 'class' ? `class ${id}` : id;
    const member = (value: string) => kind === 'class' ? `+String ${value}` : `string ${value}`;
    const initial = ['id', 'email', 'name', 'created'].map(member);
    let members = initial;
    const source = (values: string[]) => [kind === 'class' ? 'classDiagram' : 'erDiagram', '  direction LR',
      kind === 'class' ? '  CUSTOMER --> ORDER : places' : '  CUSTOMER ||--o{ ORDER : places',
      kind === 'class' ? '  CUSTOMER --> ADDRESS : stores' : '  CUSTOMER ||--o{ ADDRESS : stores',
      '', '  %% Keep original declaration order', `  ${declaration('CUSTOMER')} {`,
      `    ${values[0]}`, '    %% Preserve comment and blank line', '', ...values.slice(1).map(value => `    ${value}`),
      '  }', '', `  ${declaration('ADDRESS')} {`, `    ${member('id')}`, '  }',
      `  ${declaration('ORDER')} {`, `    ${member('id')}`, '  }'].join('\n');
    const markdown = (values: string[]) => `# Member source\n\n\`\`\`mermaid\n${source(values)}\n\`\`\`\n\nTail unchanged\n`.replaceAll('\n', '\r\n');
    await launchDocument(page, markdown(initial));
    await openDiagram(page);
    const target = page.locator('.mermaid-canvas-node[data-mermaid-node-id="CUSTOMER"]');
    await target.click();
    const add = kind === 'class' ? '添加成员' : '添加字段';
    const field = kind === 'class' ? '类成员' : '实体字段';
    for (let index = 0; index < 8; index++) await page.getByRole('button', { name: add, exact: true }).click();
    // Read the actual product default; the repeated rows are the regression
    // trigger, and every edit below uses the real member form.
    members = await page.locator('.canvas-detail-list input').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value));
    expect(members).toHaveLength(12);
    expect(new Set(members.slice(4)).size).toBe(1);
    await page.getByRole('textbox', { name: `${field} 1`, exact: true }).fill(member('客户编号'));
    members[0] = member('客户编号');
    await page.getByRole('textbox', { name: `${field} 6`, exact: true }).fill(member('balance_amount'));
    members[5] = member('balance_amount');
    const beforeLast = [...members];
    await page.getByRole('textbox', { name: `${field} 12`, exact: true }).fill(member('备注'));
    members[11] = member('备注');
    expect(await draftSource(page)).toBe(source(members));
    await showCanvas(page);
    await page.locator('.history-tools button').nth(0).click();
    expect(await draftSource(page)).toBe(source(beforeLast));
    await showCanvas(page);
    await page.locator('.history-tools button').nth(1).click();
    expect(await draftSource(page)).toBe(source(members));
    await showCanvas(page);
    await target.click();
    await page.getByRole('button', { name: '删除第 7 项', exact: true }).click();
    expect(await draftSource(page)).toBe(source(members.filter((_, index) => index !== 6)));
    await showCanvas(page);
    await page.locator('.history-tools button').nth(0).click();
    expect(await draftSource(page)).toBe(source(members));
    await page.getByRole('button', { name: '应用到文档', exact: true }).click();
    await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
    expect(await savedSource(page)).toBe(markdown(members));
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(await savedSource(page)).toBe(markdown(initial));
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect(await savedSource(page)).toBe(markdown(members));
  });
}
