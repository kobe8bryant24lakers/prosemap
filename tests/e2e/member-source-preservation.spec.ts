import { expect, test } from '@playwright/test';
import { draftSource, launchDocument, openDiagram, savedSource, showCanvas } from './helpers';

for (const kind of ['class', 'er'] as const) {
  for (const [ending, separators] of [['LF', ['\n']], ['CRLF', ['\r\n']], ['CR', ['\r']], ['mixed', ['\r\n', '\n', '\r']]] as const) {
    test(`${kind}: ${ending} saved duplicate deletion preserves aliased blocks after reopening`, async ({ page }) => {
      const declaration = (id: string, label: string) => `  ${kind === 'class' ? 'class ' : ''}${id}["${label}"] {`;
      const field = kind === 'class' ? '    +String id' : '    string id PK';
      const source = ['', kind === 'class' ? 'classDiagram' : 'erDiagram', '  direction TB',
        declaration('Original', 'SYNTHETIC original'), field, '  }',
        declaration('Other', 'SYNTHETIC unrelated'), field, '  }', '  %% SYNTHETIC tail remains here', ''].join('\n');
      const markdown = `# SYNTHETIC reopened structure\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nSYNTHETIC_END\n`;
      const lines = markdown.split('\n');
      let previousEnding = '';
      const original = lines.map((line, index) => {
        let next = index === lines.length - 1 ? '' : separators[index % separators.length];
        if (!line && previousEnding === '\r' && next === '\n') next = '\r';
        previousEnding = next;
        return line + next;
      }).join('');
      const counts = new Map<string, number>();
      for (const match of original.matchAll(/\r\n|\r|\n/g)) counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
      const preferred = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      const id = kind === 'class' ? 'Class3' : 'ENTITY3';
      const added = [declaration(id, 'SYNTHETIC original 副本'), field, '  }', ''].join('\n');
      const duplicateSource = source.replace('  %% SYNTHETIC tail', added + '  %% SYNTHETIC tail');
      const duplicateRaw = original.replace('  %% SYNTHETIC tail', added.replaceAll('\n', preferred) + '  %% SYNTHETIC tail');
      await launchDocument(page, original);
      await openDiagram(page);
      await page.locator('.mermaid-canvas-node[data-mermaid-node-id="Original"]').click();
      await page.locator('.canvas-selection-panel').getByRole('button', { name: '复制', exact: true }).click();
      expect(await draftSource(page)).toBe(duplicateSource);
      await page.getByRole('button', { name: '应用到文档', exact: true }).click();
      await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
      expect(await savedSource(page)).toBe(duplicateRaw);
      await openDiagram(page);
      await page.locator(`.mermaid-canvas-node[data-mermaid-node-id="${id}"]`).click();
      await page.locator('.canvas-selection-panel').getByRole('button', { name: '删除', exact: true }).click();
      expect(await draftSource(page)).toBe(source);
      await showCanvas(page);
      await page.locator('.history-tools button').nth(0).click();
      expect(await draftSource(page)).toBe(duplicateSource);
      await showCanvas(page);
      await page.locator('.history-tools button').nth(1).click();
      expect(await draftSource(page)).toBe(source);
      await page.getByRole('button', { name: '应用到文档', exact: true }).click();
      await expect(page.locator('.mermaid-workbench')).toHaveCount(0);
      expect(await savedSource(page)).toBe(original);
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      expect(await savedSource(page)).toBe(duplicateRaw);
      await page.getByRole('button', { name: '重做', exact: true }).click();
      expect(await savedSource(page)).toBe(original);
    });
  }
}

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
