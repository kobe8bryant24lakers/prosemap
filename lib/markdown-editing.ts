/** Small, deterministic edits shared by toolbar buttons and keyboard commands. */
export type MarkdownEdit = { from: number; to: number; insert: string; anchor: number; head: number };

export function inlineMarkdownEdit(doc: string, anchor: number, head: number, before: string, after = before, placeholder = 'Text'): MarkdownEdit {
  let from = Math.min(anchor, head), to = Math.max(anchor, head);
  const selected = doc.slice(from, to);
  let body = selected || placeholder;
  // A single asterisk must not remove one half of a bold delimiter.
  const italicOutside = before !== '*' || ((doc.slice(0, from).match(/\*+$/)?.[0].length ?? 0) % 2 === 1 && (doc.slice(to).match(/^\*+/)?.[0].length ?? 0) % 2 === 1);
  const italicInside = before !== '*' || ((selected.match(/^\*+/)?.[0].length ?? 0) % 2 === 1 && (selected.match(/\*+$/)?.[0].length ?? 0) % 2 === 1);
  if (italicOutside && from >= before.length && doc.slice(from - before.length, from) === before && doc.slice(to, to + after.length) === after) {
    from -= before.length;
    to += after.length;
    return { from, to, insert: selected, anchor: from, head: from + selected.length };
  }
  if (italicInside && selected.length >= before.length + after.length && selected.startsWith(before) && selected.endsWith(after)) {
    body = selected.slice(before.length, selected.length - after.length);
    return { from, to, insert: body, anchor: from, head: from + body.length };
  }
  return { from, to, insert: before + body + after, anchor: from + before.length, head: from + before.length + body.length };
}

export type MarkdownLineStyle = 'heading' | 'list' | 'quote' | 'task';
export function lineMarkdownEdit(doc: string, anchor: number, head: number, style: MarkdownLineStyle, placeholder = 'Text'): MarkdownEdit {
  const start = Math.min(anchor, head), end = Math.max(anchor, head);
  const from = start === 0 ? 0 : doc.lastIndexOf('\n', start - 1) + 1;
  // A selection ending at the beginning of a line excludes that line.
  const last = end > start && doc[end - 1] === '\n' ? end - 1 : end;
  const nextBreak = doc.indexOf('\n', last);
  const to = nextBreak < 0 ? doc.length : nextBreak;
  const source = doc.slice(from, to);
  const lines = source.split('\n');
  const prefix = { heading: '## ', list: '- ', quote: '> ', task: '- [ ] ' }[style];
  const pattern = { heading: /^#{1,6}\s+/, list: /^(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, quote: /^>\s?/, task: /^[-+*]\s+\[[ xX]\]\s+/ }[style];
  const active = (line: string) => style === 'heading' ? /^##\s+/.test(line.trimStart()) : pattern.test(line.trimStart());
  const nonempty = lines.filter((line) => line.trim());
  const remove = nonempty.length > 0 && nonempty.every(active);
  const insert = lines.map((line) => {
    if (!line.trim() && lines.length > 1) return line;
    const indent = line.match(/^\s*/)?.[0] ?? '';
    const body = line.slice(indent.length);
    if (remove) return indent + body.replace(pattern, '');
    const stripped = style === 'task' ? body.replace(/^(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '') : body.replace(pattern, '');
    return indent + prefix + (stripped || placeholder);
  }).join('\n');
  if (start === end && !source.trim()) {
    const anchor = from + insert.length - placeholder.length;
    return { from, to, insert, anchor, head: anchor + placeholder.length };
  }
  // Retain a caret within a single line; retain whole-line selection for bulk edits.
  const caret = Math.max(from, Math.min(from + insert.length, start + insert.length - source.length));
  return { from, to, insert, anchor: start === end ? caret : from, head: start === end ? caret : from + insert.length };
}
