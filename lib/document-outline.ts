import type { Element, Root, RootContent } from 'hast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import { previewHtmlSanitize } from './preview-html.ts';
import { previewHeadingIds } from './preview-links.ts';
import { previewLineBreaks } from './markdown-preview.ts';
import { relativeFileLinks } from './relative-file-links.ts';

export type OutlineHeading = {
  id: string;
  title: string;
  level: number;
  line: number;
  children: OutlineHeading[];
};

// Match the preview's parser, sanitization and duplicate-heading IDs. In
// particular, fenced code is not a heading and raw HTML cannot forge IDs.
const processor = unified().use(remarkParse).use(remarkGfm).use(relativeFileLinks).use(previewLineBreaks)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw)
  .use(previewHtmlSanitize).use(previewHeadingIds);

function headingText(node: RootContent): string {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element') return '';
  if (node.tagName === 'img') return String(node.properties.alt ?? '');
  if (node.tagName === 'br') return ' ';
  return node.children.map(headingText).join('');
}

export function documentOutline(markdown: string): OutlineHeading[] {
  const tree = processor.runSync(processor.parse(markdown), markdown) as Root;
  const headings: OutlineHeading[] = [];
  const parents: OutlineHeading[] = [];
  const visit = (node: Root | Element) => {
    if (node.type === 'element' && /^h[1-6]$/.test(node.tagName) && node.position) {
      const heading: OutlineHeading = {
        id: String(node.properties.id), title: headingText(node).replace(/\s+/g, ' ').trim(),
        level: Number(node.tagName[1]), line: node.position.start.line, children: [],
      };
      while (parents.length && parents.at(-1)!.level >= heading.level) parents.pop();
      (parents.at(-1)?.children ?? headings).push(heading);
      parents.push(heading);
    }
    for (const child of node.children) if (child.type === 'element') visit(child);
  };
  visit(tree);
  return headings;
}

export function activeOutlineHeading(headings: OutlineHeading[], line: number): string | null {
  let active: string | null = null;
  const visit = (nodes: OutlineHeading[]) => {
    for (const node of nodes) {
      if (node.line > line) continue;
      active = node.id;
      visit(node.children);
    }
  };
  visit(headings);
  return active;
}
