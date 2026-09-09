import type { Root, Element, Text } from 'hast';

export function isExternalPreviewLink(href: string): boolean {
  try { return ['http:', 'https:', 'mailto:'].includes(new URL(href).protocol); }
  catch { return false; }
}

export function headingSlug(text: string): string {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
}

export function previewHeadingIds() {
  return (tree: Root) => {
    const slugs = new Set<string>();
    const text = (node: Element | Text): string => node.type === 'text' ? node.value : node.children.map((child) => child.type === 'text' || child.type === 'element' ? text(child) : '').join('');
    const visit = (node: Root | Element) => {
      if (node.type === 'element' && /^h[1-6]$/.test(node.tagName)) {
        const base = headingSlug(text(node));
        let id = base;
        let suffix = 0;
        while (slugs.has(id)) id = `${base}-${++suffix}`;
        slugs.add(id);
        node.properties.id = id;
      }
      for (const child of node.children) if (child.type === 'element') visit(child);
    };
    visit(tree);
  };
}
