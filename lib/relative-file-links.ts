import type { Link, Parent, PhrasingContent, Root, Text } from 'mdast';
import type { Point } from 'unist';
import type { Processor } from 'unified';
import { decodeString } from 'micromark-util-decode-string';

const attachmentExtension = /\.(?:xlsx?|xlsm|xlsb|csv|tsv|ods|numbers|docx?|odt|rtf|pages|pptx?|odp|key|pdf|txt|md|markdown|mdown|mkdn|log|json|png|jpe?g|gif|webp|bmp|svg|avif|tiff?|mp3|wav|m4a|ogg|flac|mp4|mov|webm|mkv|zip)$/i;
const inlineContainers = new Set(['paragraph', 'heading', 'tableCell', 'strong', 'emphasis', 'delete']);
const protectedNodes = new Set(['link', 'linkReference', 'image', 'imageReference', 'code', 'inlineCode', 'html']);
type Candidate = { start: number; labelEnd: number; end: number };

function escaped(source: string, offset: number): boolean {
  let count = 0;
  while (offset > 0 && source[--offset] === '\\') count += 1;
  return count % 2 === 1;
}

// Each destination is scanned once; an unclosed destination consumes the rest
// of its line instead of repeatedly searching a long run of opening brackets.
function candidates(source: string, start: number, end: number, protectedRanges: [number, number][]): Candidate[] {
  const result: Candidate[] = [];
  const brackets: number[] = [];
  let protectedIndex = 0;
  for (let index = start; index < end; index += 1) {
    while (protectedRanges[protectedIndex]?.[1] <= index) protectedIndex += 1;
    const protectedRange = protectedRanges[protectedIndex];
    if (protectedRange && index >= protectedRange[0]) { index = protectedRange[1] - 1; brackets.length = 0; continue; }
    const char = source[index];
    if (char === '\n' || char === '\r') { brackets.length = 0; continue; }
    if ((char === '[' || char === ']') && escaped(source, index)) continue;
    if (char === '[') { brackets.push(index); continue; }
    if (char !== ']' || !brackets.length) continue;
    const opening = brackets.pop()!;
    if (source[index + 1] !== '(' || (source[opening - 1] === '!' && !escaped(source, opening - 1))) continue;
    let depth = 1;
    let cursor = index + 2;
    for (; cursor < end; cursor += 1) {
      const current = source[cursor];
      if (current === '\n' || current === '\r') break;
      if ((current === '(' || current === ')' || current === '"' || current === "'") && escaped(source, cursor)) continue;
      if ((current === '"' || current === "'") && /[ \t]/.test(source[cursor - 1])) {
        const quote = current;
        cursor += 1;
        for (; cursor < end && source[cursor] !== '\n' && source[cursor] !== '\r'; cursor += 1) {
          if (source[cursor] === quote && !escaped(source, cursor)) break;
        }
        if (cursor >= end || source[cursor] === '\n' || source[cursor] === '\r') break;
      } else if (current === '(') depth += 1;
      else if (current === ')' && --depth === 0) break;
    }
    if (!depth) result.push({ start: opening, labelEnd: index, end: cursor + 1 });
    index = cursor;
  }
  return result;
}

function relativeAttachment(path: string): boolean {
  const relative = (value: string) => value.trim() === value && !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    && !/^(?:[a-z][a-z\d+.-]*:|[/\\]|#)/i.test(value);
  if (!path || !relative(path)) return false;
  try {
    const decoded = decodeURIComponent(path.replace(/%(?![\da-f]{2})/gi, '%25')).replace(/\\/g, '/');
    return relative(decoded) && attachmentExtension.test(decoded.split(/[?#]/, 1)[0]);
  } catch { return false; }
}

function destination(body: string): { path: string; title: string } | null {
  const trimmed = body.trim();
  // Titles follow ordinary Markdown quoting. Only separate a title when the
  // preceding destination itself is an allowed attachment path.
  const titled = /^(.*\S)[ \t]+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\))$/.exec(trimmed);
  const options = titled ? [[titled[1], titled[2]], [trimmed, '']] : [[trimmed, '']];
  for (const [rawPath, title] of options) {
    const path = decodeString(rawPath);
    if (/[<>]/.test(path) || !relativeAttachment(path)) continue;
    return { path, title };
  }
  return null;
}

function lines(value: string): { value: string; start: number }[] {
  const result: { value: string; start: number }[] = [];
  let start = 0;
  for (const match of value.matchAll(/\r\n|\r|\n/g)) {
    result.push({ value: value.slice(start, match.index), start });
    start = match.index! + match[0].length;
  }
  result.push({ value: value.slice(start), start });
  return result;
}

// Text values have already decoded escapes/entities and removed continuation
// indentation (including quote/list prefixes). Map source offsets back to those
// existing values, preserving surrounding text rather than reparsing it.
function textMapper(node: Text, source: string): ((offset: number) => number | null) | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return null;
  const rawLines = lines(source.slice(start, end));
  const valueLines = lines(node.value);
  if (rawLines.length !== valueLines.length) return null;
  const mappedLines = rawLines.map((raw, index) => {
    const value = valueLines[index];
    const decoded = decodeString(raw.value);
    const changes: { start: number; end: number; delta: number }[] = [];
    let delta = 0;
    for (const match of raw.value.matchAll(/\\[!-/:-@[-`{-~]|&(?:#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi)) {
      delta += decodeString(match[0]).length - match[0].length;
      changes.push({ start: match.index!, end: match.index! + match[0].length, delta });
    }
    return { raw, value, changes, stripped: decoded.length - value.value.length, valid: decoded.endsWith(value.value) };
  });
  return (offset) => {
    const relative = offset - start;
    let low = 0;
    let high = mappedLines.length;
    while (low + 1 < high) { const middle = (low + high) >>> 1; if (mappedLines[middle].raw.start <= relative) low = middle; else high = middle; }
    const line = mappedLines[low];
    if (!line.valid) return null;
    const column = relative - line.raw.start;
    low = 0;
    high = line.changes.length;
    while (low < high) { const middle = (low + high) >>> 1; if (line.changes[middle].end <= column) low = middle + 1; else high = middle; }
    if (line.changes[low] && column > line.changes[low].start) return null;
    const result = column + (line.changes[low - 1]?.delta ?? 0) - line.stripped;
    return result < 0 || result > line.value.value.length ? null : line.value.start + result;
  };
}

export function relativeFileLinks(this: Processor) {
  const parse = (value: string) => this.parse(value) as Root;
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    const textMaps = new WeakMap<Text, ReturnType<typeof textMapper>>();
    const lineStarts = [0];
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === '\r') { if (source[index + 1] === '\n') index += 1; lineStarts.push(index + 1); }
      else if (source[index] === '\n') lineStarts.push(index + 1);
    }
    const point = (offset: number): Point => {
      let low = 0;
      let high = lineStarts.length;
      while (low + 1 < high) {
        const middle = (low + high) >>> 1;
        if (lineStarts[middle] <= offset) low = middle; else high = middle;
      }
      return { line: low + 1, column: offset - lineStarts[low] + 1, offset };
    };
    const position = (from: number, to: number) => ({ start: point(from), end: point(to) });
    const mapText = (node: Text, offset: number) => {
      if (!textMaps.has(node)) textMaps.set(node, textMapper(node, source));
      return textMaps.get(node)?.(offset) ?? null;
    };
    const sliceText = (node: Text, from: number, to: number): Text | null => {
      const start = mapText(node, from);
      const end = mapText(node, to);
      return start === null || end === null ? null : { type: 'text', value: node.value.slice(start, end), position: position(from, to) };
    };
    const protectedChild = (node: PhrasingContent): boolean => protectedNodes.has(node.type)
      || ('children' in node && node.children.some(protectedChild));
    const visit = (parent: Parent) => {
      if (protectedNodes.has(parent.type)) return;
      // Inline HTML boundaries can span several sibling nodes. Leave the whole
      // inline container alone to avoid nested anchors or links inside <code>.
      if (inlineContainers.has(parent.type) && parent.children.some((child) => child.type === 'html')) return;
      const start = parent.position?.start.offset;
      const end = parent.position?.end.offset;
      if (inlineContainers.has(parent.type) && start !== undefined && end !== undefined) {
        const recoveries: { first: number; last: number; candidate: Candidate; link: Link }[] = [];
        const protectedRanges: [number, number][] = parent.children.flatMap((child) => protectedChild(child as PhrasingContent)
          && child.position?.start.offset !== undefined && child.position.end.offset !== undefined ? [[child.position.start.offset, child.position.end.offset]] : []);
        for (const candidate of candidates(source, start, end, protectedRanges)) {
          const first = parent.children.findIndex((child) => child.type === 'text'
            && child.position?.start.offset !== undefined && child.position.end.offset !== undefined
            && child.position.start.offset <= candidate.start && child.position.end.offset > candidate.start);
          const last = parent.children.findIndex((child) => child.type === 'text'
            && child.position?.start.offset !== undefined && child.position.end.offset !== undefined
            && child.position.start.offset < candidate.end && child.position.end.offset >= candidate.end);
          if (first < 0 || last < first || parent.children.slice(first, last + 1).some((child) => protectedChild(child as PhrasingContent))) continue;
          const target = destination(source.slice(candidate.labelEnd + 2, candidate.end - 1));
          if (!target) continue;
          const label = source.slice(candidate.start + 1, candidate.labelEnd);
          const paragraph = /[\\`*_~[\]<>]/.test(label) ? parse(`[${label}](./attachment.xlsx)`).children[0] : null;
          if (paragraph && (paragraph.type !== 'paragraph' || paragraph.children.length !== 1 || paragraph.children[0].type !== 'link')) continue;
          const link: Link = { type: 'link', url: target.path.replace(/\\/g, '/'), title: target.title ? decodeString(target.title.slice(1, -1)) : null,
            children: paragraph?.type === 'paragraph' && paragraph.children[0].type === 'link' ? paragraph.children[0].children : [{ type: 'text', value: decodeString(label), position: position(1, candidate.labelEnd - candidate.start) }] };
          const remap = (node: PhrasingContent) => {
            const from = node.position?.start.offset;
            const to = node.position?.end.offset;
            if (from !== undefined && to !== undefined) node.position = position(candidate.start + from, candidate.start + to);
            if ('children' in node) node.children.forEach(remap);
          };
          link.children.forEach(remap);
          link.position = position(candidate.start, candidate.end);
          const firstText = parent.children[first] as Text;
          const lastText = parent.children[last] as Text;
          if (mapText(firstText, candidate.start) === null || mapText(lastText, candidate.end) === null) continue;
          recoveries.push({ first, last, candidate, link });
        }
        if (recoveries.length) {
          const children = parent.children;
          const output: typeof children = [];
          let cursor = 0;
          let consumedTo: number | null = null;
          const appendText = (node: Text, from: number, to: number) => { const sliced = sliceText(node, from, to); if (sliced?.value) output.push(sliced); };
          for (const { first, last, candidate, link } of recoveries) {
            while (cursor < first) {
              const child = children[cursor];
              if (consumedTo !== null && child.type === 'text') appendText(child, consumedTo, child.position!.end.offset!); else output.push(child);
              cursor += 1;
              consumedTo = null;
            }
            const text = children[first] as Text;
            appendText(text, consumedTo ?? text.position!.start.offset!, candidate.start);
            output.push(link);
            cursor = last;
            consumedTo = candidate.end;
          }
          while (cursor < children.length) {
            const child = children[cursor];
            if (consumedTo !== null && child.type === 'text') appendText(child, consumedTo, child.position!.end.offset!); else output.push(child);
            cursor += 1;
            consumedTo = null;
          }
          parent.children = output;
        }
      }
      for (const child of parent.children) if ('children' in child) visit(child);
    };
    visit(tree);
  };
}
