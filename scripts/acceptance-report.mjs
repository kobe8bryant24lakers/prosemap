// Validate the actual GFM table structure and report complete-row outcomes.
// Partial native evidence and browser-only passes never become native passes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const processor = unified().use(remarkParse).use(remarkGfm);
const tree = processor.runSync(processor.parse(readFileSync(new URL('../docs/v0.11.0-deep-acceptance.md', import.meta.url), 'utf8')));
const text = node => node.value ?? node.children?.map(text).join('') ?? '';
const rows = [];
function visit(node) {
  if (node.type === 'table' && text(node.children[0].children[0]) === 'ID') {
    for (const row of node.children.slice(1)) {
      assert.equal(row.children.length, 11, `Expected 11 cells for ${text(row.children[0])}`);
      rows.push(row.children.map(text));
    }
  }
  node.children?.forEach(visit);
}
visit(tree);
assert.ok(rows.length >= 490, 'Feature inventory unexpectedly shrank');
assert.equal(new Set(rows.map(row => row[0])).size, rows.length, 'Feature IDs must be unique');
const classify = value => value.startsWith('通过') ? 'passed'
  : value.startsWith('失败') ? 'failed'
    : value.startsWith('不支持') ? 'unsupported'
      : value.startsWith('受限') ? 'limited' : 'pending_or_partial';
function counts(column) {
  return rows.reduce((counts, row) => {
    const status = classify(row[column]);
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
}
console.log(JSON.stringify({ inventory: rows.length, baselineNative: counts(8), candidateRetest: counts(9),
  note: 'Inventory progress only. A final acceptance pass rate is not available while pending/partial rows remain.' }, null, 2));
