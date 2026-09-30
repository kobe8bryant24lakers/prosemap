import type { Element, Root } from 'hast';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

// Only accept literal colors: no URLs, CSS variables, expressions, or arbitrary
// declarations that could affect the surrounding application.
const literalColor = /^(?:[a-z]+|#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|(?:rgba?|hsla?)\((?:[\d\s.,%+\-/]|deg|grad|rad|turn)+\))$/i;

function colorStyles(style: string): string {
  return style.split(';').flatMap((declaration) => {
    const separator = declaration.indexOf(':');
    if (separator < 0) return [];
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (property !== 'color' && property !== 'background-color') return [];
    return literalColor.test(value) ? [`${property}: ${value}`] : [];
  }).join('; ');
}

export function previewHtmlSanitize() {
  const sanitize = rehypeSanitize({
    ...defaultSchema,
    attributes: {
      ...defaultSchema.attributes,
      '*': [...(defaultSchema.attributes?.['*'] ?? []), 'style'],
    },
  });

  return (tree: Root) => {
    const visit = (node: Root | Element) => {
      if (node.type === 'element' && 'style' in node.properties) {
        const style = typeof node.properties.style === 'string' ? colorStyles(node.properties.style) : '';
        if (style) node.properties.style = style;
        else delete node.properties.style;
      }
      for (const child of node.children) if (child.type === 'element') visit(child);
    };
    // Filter styles before passing them through the HTML sanitizer. Merely
    // allowing `style` in its schema would leave CSS values unchecked.
    visit(tree);
    return sanitize(tree);
  };
}
