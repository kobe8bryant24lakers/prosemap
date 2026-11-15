import type { Root } from 'hast';

// Run after sanitization: source-supplied attributes must not impersonate these
// trusted positions. Top-level blocks stay monotonic even with nested lists.
export function previewSourceLines() {
  return (tree: Root) => {
    for (const child of tree.children) {
      if (child.type === 'element' && child.position) {
        child.properties.dataSourceLine = child.position.start.line;
      }
    }
  };
}
