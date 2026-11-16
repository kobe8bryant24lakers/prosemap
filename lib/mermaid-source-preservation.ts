import { diffArrays } from 'diff';
import { parseFlowchartEdgeTokens, parseMermaidVisualSource, serializeMermaidVisualGraph, type MermaidVisualGraph } from './mermaid-workbench.ts';

function lineKey(line: string) {
  // A quoted and an unquoted Mermaid label can represent the same model. Every
  // candidate below is reparsed and compared in full before it is accepted.
  return line.trim().replaceAll('"', '');
}

function replaceLine(original: string, before: string, after: string) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const removed = before.slice(start, before.length - end);
  const inserted = after.slice(start, after.length - end);
  const at = removed ? original.indexOf(removed) : -1;
  if (at >= 0 && original.indexOf(removed, at + removed.length) < 0) {
    return original.slice(0, at) + inserted + original.slice(at + removed.length);
  }
  return original.match(/^\s*/)?.[0] + after.trimStart();
}

type SourceLine = { text: string; eol: string; key: string };

function memberBlockPattern(kind: MermaidVisualGraph['kind']) {
  return kind === 'class'
    ? /^class\s+([\p{L}\p{N}_-]+)(?:\["[^"]*"\])?\s*\{$/u
    : /^([\p{L}\p{N}_-]+)(?:\["[^"]*"\])?\s*\{$/u;
}

function sourceLines(source: string, kind: MermaidVisualGraph['kind']): SourceLine[] {
  const lines: SourceLine[] = [];
  const groups: string[] = [];
  let owner = '';
  for (const match of source.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)) {
    if (!match[0]) continue;
    const text = match[1];
    const trimmed = text.trim();
    if (kind === 'class' || kind === 'er') {
      const declaration = memberBlockPattern(kind).exec(trimmed);
      if (declaration) owner = declaration[1];
    }
    if (kind === 'flowchart') {
      const group = /^subgraph\s+([\w-]+)/.exec(trimmed);
      if (group) groups.push(group[1]);
    }
    const scope = /^%%/.test(trimmed) ? '' : owner || groups.join('/');
    lines.push({ text, eol: match[2], key: scope + '\0' + lineKey(text) });
    if (trimmed === '}') owner = '';
    if (kind === 'flowchart' && trimmed === 'end') groups.pop();
  }
  return lines;
}

type NodeToken = { at: number; text: string; explicit: boolean };

function singleFlowchartNode(token: string) {
  const graph = parseMermaidVisualSource(`flowchart TD\n${token}`);
  return graph?.kind === 'flowchart' && graph.nodes.length === 1 && !graph.edges.length && !graph.data?.groups?.length
    ? graph.nodes[0] : null;
}

/** Flowchart endpoints can declare nodes on an edge line. Locate complete
 * endpoint tokens, never label substrings in comments, groups or edge text.
 * The split patterns mirror the supported edge forms, and each endpoint is
 * independently checked by the existing parser rather than a second grammar. */
function flowchartNodeTokens(source: string) {
  const tokens = new Map<string, NodeToken[]>();
  let offset = 0;
  const remember = (text: string, at: number) => {
    const trimmed = text.trim();
    const node = singleFlowchartNode(trimmed);
    if (!node) return false;
    const token = { at: at + text.indexOf(trimmed), text: trimmed, explicit: trimmed !== node.id };
    tokens.set(node.id, [...tokens.get(node.id) ?? [], token]);
    return true;
  };
  for (const line of sourceLines(source, 'flowchart')) {
    const text = line.text;
    if (text.trim() && !/^\s*(?:%%|subgraph\b|end\s*$|(?:flowchart|graph)\b)/.test(text)) {
      const edge = parseFlowchartEdgeTokens(text);
      if (edge) {
        remember(edge.from, offset + edge.fromAt);
        remember(edge.to, offset + edge.toAt);
      } else remember(text, offset);
    }
    offset += text.length + line.eol.length;
  }
  return tokens;
}

function preserveFlowchartNodeEdits(source: string, before: MermaidVisualGraph, after: MermaidVisualGraph, expected: string) {
  const targetNodes = new Map(after.nodes.map(node => [node.id, node]));
  const changed = before.nodes.filter(node => {
    const target = targetNodes.get(node.id);
    return target && (target.label !== node.label || target.shape !== node.shape);
  });
  if (!changed.length) return null;
  // This path only owns label/shape changes. Structural edits and edge changes
  // continue through the general line mapper and its explicit safe fallback.
  const projected = { ...before, nodes: before.nodes.map(node => {
    const target = targetNodes.get(node.id);
    return target ? { ...node, label: target.label, shape: target.shape } : node;
  }) };
  if (serializeMermaidVisualGraph(projected) !== expected) return null;

  const tokens = flowchartNodeTokens(source);
  const declaration = (node: MermaidVisualGraph['nodes'][number]) => serializeMermaidVisualGraph({
    kind: 'flowchart', direction: 'TD', nodes: [{ id: node.id, label: node.label, shape: node.shape }], edges: [],
  }).split('\n')[1].trim();
  const edits: Array<NodeToken & { replacement: string }> = [];
  for (const node of changed) {
    const occurrences = tokens.get(node.id) ?? [];
    const declarations = occurrences.filter(token => token.explicit);
    const candidates = declarations.length ? declarations : occurrences;
    // Repeated declarations, even identical ones, can have different authoring
    // intent. Do not guess which occurrence should own a new node label.
    if (candidates.length !== 1) return null;
    const token = candidates[0];
    const target = targetNodes.get(node.id)!;
    const targetDeclaration = declaration(target);
    // A bare identifier has no label substring to replace. Also use the
    // serializer's quoting for punctuation that could become Mermaid syntax;
    // the visual parser intentionally accepts a broader label body.
    const replacement = !token.explicit || /[()[\]{}<>|"']/.test(target.label)
      ? targetDeclaration : replaceLine(token.text, declaration(node), targetDeclaration);
    edits.push({ ...token, replacement });
  }
  let candidate = source;
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    candidate = candidate.slice(0, edit.at) + edit.replacement + candidate.slice(edit.at + edit.text.length);
  }
  try {
    const parsed = parseMermaidVisualSource(candidate);
    return parsed && serializeMermaidVisualGraph(parsed) === expected ? candidate : null;
  } catch { return null; }
}

/** A label on an inline edge has no standalone canonical line to map. Patch
 * its parsed label span, leaving endpoint declarations and line endings alone. */
function preserveFlowchartEdgeLabels(source: string, before: MermaidVisualGraph, after: MermaidVisualGraph, expected: string) {
  const targets = new Map(after.edges.map(edge => [edge.id, edge]));
  const changed = before.edges.filter(edge => targets.has(edge.id) && targets.get(edge.id)!.label !== edge.label);
  if (!changed.length || targets.size !== after.edges.length) return null;
  const projected = { ...before, edges: before.edges.map(edge => ({ ...edge, label: targets.get(edge.id)?.label ?? edge.label })) };
  if (serializeMermaidVisualGraph(projected) !== expected) return null;

  type EdgeToken = NonNullable<ReturnType<typeof parseFlowchartEdgeTokens>> & { at: number; line: string };
  const signature = (edge: MermaidVisualGraph['edges'][number]) => JSON.stringify([edge.from, edge.to, edge.label, edge.style]);
  const tokens = new Map<string, EdgeToken[]>();
  let offset = 0;
  for (const line of sourceLines(source, 'flowchart')) {
    const token = /^\s*(?:%%|subgraph\b|end\s*$|(?:flowchart|graph)\b)/.test(line.text) ? null : parseFlowchartEdgeTokens(line.text);
    if (token) {
      const from = singleFlowchartNode(token.from), to = singleFlowchartNode(token.to);
      if (!from || !to) return null;
      const key = JSON.stringify([from.id, to.id, token.label, token.style]);
      tokens.set(key, [...tokens.get(key) ?? [], { ...token, at: offset, line: line.text }]);
    }
    offset += line.text.length + line.eol.length;
  }
  const edits: Array<{ at: number; length: number; text: string }> = [];
  for (const edge of changed) {
    const occurrences = tokens.get(signature(edge));
    if (occurrences?.length !== 1) return null;
    const token = occurrences[0];
    // Reuse the serializer's validation and text escaping, not another copy.
    const canonical = serializeMermaidVisualGraph({ ...after, edges: [targets.get(edge.id)!] })
      .split('\n').map(line => ({ line, token: parseFlowchartEdgeTokens(line) })).find(value => value.token !== null);
    if (!canonical?.token) return null;
    const label = canonical.line.slice(canonical.token.labelAt, canonical.token.labelAt + canonical.token.labelLength);
    let at = token.labelAt, length = token.labelLength, text = label;
    if (token.labelSyntax === 'none') {
      text = label ? `|${label}|` : '';
    } else if (!label && token.labelSyntax === 'pipe') {
      at--; length += 2;
    } else if (!label) {
      at = token.from.length; length = token.toAt - at;
      const connector = token.line.slice(at, token.toAt);
      text = connector.match(/^\s*/)![0] + '-->' + connector.match(/\s*$/)![0];
    } else {
      const original = token.line.slice(at, at + length), trimmed = original.trim();
      const quote = /^(["']).*\1$/.exec(trimmed)?.[1] ?? '';
      text = original.match(/^\s*/)![0] + quote + label + quote + (trimmed ? original.match(/\s*$/)![0] : '');
    }
    edits.push({ at: token.at + at, length, text });
  }
  let candidate = source;
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    candidate = candidate.slice(0, edit.at) + edit.text + candidate.slice(edit.at + edit.length);
  }
  try {
    const parsed = parseMermaidVisualSource(candidate);
    return parsed && serializeMermaidVisualGraph(parsed) === expected ? candidate : null;
  } catch { return null; }
}

/** Members belong to one declaration, even when their text repeats. Locate
 * that declaration first and map its ordered rows, rather than looking up
 * member text globally or regenerating unrelated declarations. */
function preserveMemberEdits(source: string, before: MermaidVisualGraph, after: MermaidVisualGraph, expected: string) {
  if (before.kind !== 'class' && before.kind !== 'er') return null;
  const details = (node: MermaidVisualGraph['nodes'][number]) => (node.data?.details ?? []).map(value => value.trim()).filter(Boolean);
  const targets = new Map(after.nodes.map(node => [node.id, node]));
  const changed = before.nodes.filter(node => {
    const target = targets.get(node.id);
    return target && JSON.stringify(details(node)) !== JSON.stringify(details(target));
  });
  if (!changed.length) return null;
  const projected = { ...before, nodes: before.nodes.map(node => {
    const target = targets.get(node.id);
    return target ? { ...node, data: { ...node.data, details: target.data?.details } } : node;
  }) };
  if (serializeMermaidVisualGraph(projected) !== expected) return null;

  const raw = sourceLines(source, before.kind);
  const blockPattern = memberBlockPattern(before.kind);
  const edits: Array<{ at: number; remove: number; insert: SourceLine[] }> = [];
  for (const node of changed) {
    const ref = node.data?.ref ?? node.id;
    const blocks = raw.flatMap((line, index) => blockPattern.exec(line.text.trim())?.[1] === ref ? [index] : []);
    if (blocks.length !== 1) return null;
    const start = blocks[0];
    const end = raw.findIndex((line, index) => index > start && line.text.trim() === '}');
    if (end < 0) return null;
    const members = raw.flatMap((line, index) => index > start && index < end && line.text.trim() && !line.text.trimStart().startsWith('%%') ? [index] : []);
    const previous = details(node);
    // Reject split/external declarations whose model aggregates other members.
    if (JSON.stringify(members.map(index => raw[index].text.trim())) !== JSON.stringify(previous)) return null;
    const next = details(targets.get(node.id)!);
    const parts = diffArrays(previous, next);
    const indent = members.length ? raw[members[0]].text.match(/^[\t ]*/)![0] : raw[start].text.match(/^[\t ]*/)![0] + '  ';
    const newline = raw[members[0] ?? start].eol || raw[start].eol || '\n';
    let oldAt = 0;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (!part.added && !part.removed) { oldAt += part.count; continue; }
      const removed = part.removed ? part.value : [];
      const added = part.added ? part.value : parts[index + 1]?.added ? parts[++index].value : [];
      const shared = Math.min(removed.length, added.length);
      for (let offset = 0; offset < shared; offset++) {
        const at = members[oldAt + offset];
        edits.push({ at, remove: 1, insert: [{ ...raw[at], text: replaceLine(raw[at].text, removed[offset], added[offset]) }] });
      }
      for (let offset = shared; offset < removed.length; offset++) edits.push({ at: members[oldAt + offset], remove: 1, insert: [] });
      if (added.length > shared) {
        const at = removed.length ? members[oldAt + removed.length - 1] + 1
          : members[oldAt] ?? (members.length ? members.at(-1)! + 1 : end);
        edits.push({ at, remove: 0, insert: added.slice(shared).map(text => ({ text: indent + text, eol: newline, key: '' })) });
      }
      oldAt += removed.length;
    }
  }
  for (const edit of edits.sort((a, b) => b.at - a.at)) raw.splice(edit.at, edit.remove, ...edit.insert);
  const candidate = raw.map(line => line.text + line.eol).join('');
  try {
    const parsed = parseMermaidVisualSource(candidate);
    return parsed && serializeMermaidVisualGraph(parsed) === expected ? candidate : null;
  } catch { return null; }
}

/** A single new sequence message has an unambiguous ordinal source slot,
 * even if neighboring messages have identical text. Keep every old byte. */
function preserveSequenceInsertion(source: string, before: MermaidVisualGraph, after: MermaidVisualGraph, expected: string) {
  if (before.kind !== 'sequence' || after.kind !== 'sequence' || after.edges.length !== before.edges.length + 1) return null;
  const ids = new Set(before.edges.map(edge => edge.id));
  const added = after.edges.filter(edge => !ids.has(edge.id));
  if (added.length !== 1 || JSON.stringify(after.edges.filter(edge => ids.has(edge.id))) !== JSON.stringify(before.edges)) return null;
  const index = after.edges.indexOf(added[0]);
  const raw = sourceLines(source, 'sequence');
  const slots = raw.flatMap((line, at) => parseMermaidVisualSource(`sequenceDiagram\n${line.text}`)?.edges.length === 1 ? [at] : []);
  if (slots.length !== before.edges.length) return null;
  const at = slots[index] ?? raw.length;
  const indent = at < raw.length ? raw[at].text.match(/^\s*/)![0] : '  ';
  const eol = raw[at]?.eol || raw.find(line => line.eol)?.eol || '\n';
  const message = serializeMermaidVisualGraph({ ...after, edges: added, data: undefined }).split('\n').at(-1)!.trim();
  const noFinalEol = at === raw.length && raw.at(-1)?.eol === '';
  if (noFinalEol) raw[raw.length - 1].eol = eol;
  raw.splice(at, 0, { text: indent + message, eol: noFinalEol ? '' : eol, key: '' });
  const candidate = raw.map(line => line.text + line.eol).join('');
  try {
    const parsed = parseMermaidVisualSource(candidate);
    return parsed && serializeMermaidVisualGraph(parsed) === expected ? candidate : null;
  } catch { return null; }
}

/** Reordering sequence messages changes message slots, not the intervening
 * directives. A generic line diff can instead move/reformat those directives.
 * Handle only a pure permutation with unambiguous, exact message spellings. */
function preserveSequenceMessageOrder(source: string, before: MermaidVisualGraph, after: MermaidVisualGraph, previous: string, next: string) {
  if (before.kind !== 'sequence' || after.kind !== 'sequence'
    || JSON.stringify({ ...before, edges: [] }) !== JSON.stringify({ ...after, edges: [] })
    || before.edges.length !== after.edges.length) return null;
  const originals = new Map(before.edges.map(edge => [edge.id, JSON.stringify(edge)]));
  if (originals.size !== before.edges.length || new Set(after.edges.map(edge => edge.id)).size !== after.edges.length
    || after.edges.some(edge => originals.get(edge.id) !== JSON.stringify(edge))) return null;

  const raw = sourceLines(source, 'sequence');
  const oldLines = sourceLines(previous, 'sequence');
  const newLines = sourceLines(next, 'sequence');
  if (oldLines.length !== newLines.length) return null;
  const locations = new Map<string, number[]>();
  const canonicalCounts = new Map<string, number>();
  raw.forEach((line, index) => locations.set(line.text.trim(), [...locations.get(line.text.trim()) ?? [], index]));
  oldLines.forEach(line => canonicalCounts.set(line.text.trim(), (canonicalCounts.get(line.text.trim()) ?? 0) + 1));
  const locate = (text: string) => {
    const key = text.trim();
    const found = locations.get(key);
    return canonicalCounts.get(key) === 1 && found?.length === 1 ? found[0] : -1;
  };
  const isMessage = (text: string) => parseMermaidVisualSource(`sequenceDiagram\n${text}`)?.edges.length === 1;
  const edits: Array<{ at: number; text: string }> = [];
  for (let index = 0; index < oldLines.length; index++) {
    if (oldLines[index].text === newLines[index].text) continue;
    if (!isMessage(oldLines[index].text) || !isMessage(newLines[index].text)) return null;
    const at = locate(oldLines[index].text);
    const from = locate(newLines[index].text);
    if (at < 0 || from < 0) return null;
    const slot = raw[at].text;
    edits.push({ at, text: slot.match(/^\s*/)![0] + raw[from].text.trim() + slot.match(/\s*$/)![0] });
  }
  for (const edit of edits) raw[edit.at].text = edit.text;
  const candidate = raw.map(line => line.text + line.eol).join('');
  try {
    const parsed = parseMermaidVisualSource(candidate);
    return parsed && serializeMermaidVisualGraph(parsed) === next ? candidate : null;
  } catch { return null; }
}

/** Project canonical graph changes onto original source locations. Mapping is
 * scoped for members and groups; ambiguous occurrences are never guessed.
 * Reparse the complete result before accepting a source-preserving edit. */
export function preserveMermaidSource(source: string, before: MermaidVisualGraph, after: MermaidVisualGraph) {
  const next = serializeMermaidVisualGraph(after);
  let previous: string;
  try {
    previous = serializeMermaidVisualGraph(before);
  } catch {
    // Imported source can parse into a graph while failing stricter visual
    // validation. Permit repairing it; there is no safe canonical mapping for
    // the old graph, so use the validated result and keep exact undo separately.
    return next;
  }
  const parsedSource = parseMermaidVisualSource(source);
  try {
    if (!parsedSource || serializeMermaidVisualGraph(parsedSource) !== previous) return next;
  } catch { return next; }
  if (previous === next) return source;
  if (before.kind !== after.kind) return next;
  const sequenceInsertion = preserveSequenceInsertion(source, before, after, next);
  if (sequenceInsertion !== null) return sequenceInsertion;
  const sequenceOrder = preserveSequenceMessageOrder(source, before, after, previous, next);
  if (sequenceOrder !== null) return sequenceOrder;
  if (before.kind === 'flowchart') {
    const inlineEdit = preserveFlowchartNodeEdits(source, before, after, next);
    if (inlineEdit !== null) return inlineEdit;
    const edgeLabels = preserveFlowchartEdgeLabels(source, before, after, next);
    if (edgeLabels !== null) return edgeLabels;
  }
  const memberEdit = preserveMemberEdits(source, before, after, next);
  if (memberEdit !== null) return memberEdit;
  const raw = sourceLines(source, before.kind);
  const oldLines = sourceLines(previous, before.kind);
  const newLines = sourceLines(next, after.kind);
  const locations = new Map<string, number[]>();
  raw.forEach((line, index) => locations.set(line.key, [...locations.get(line.key) ?? [], index]));
  const locate = (line: SourceLine | undefined) => {
    const found = line && locations.get(line.key);
    return found?.length === 1 ? found[0] : -1;
  };
  const indentations = new Map<number, Map<string, number>>();
  for (const line of oldLines) {
    const index = locate(line);
    if (index < 0 || !line.text.trim() || line.text.trim().startsWith('%%')) continue;
    const canonicalIndent = line.text.match(/^\s*/)![0].length;
    const actualIndent = raw[index].text.match(/^\s*/)![0];
    const counts = indentations.get(canonicalIndent) ?? new Map<string, number>();
    counts.set(actualIndent, (counts.get(actualIndent) ?? 0) + 1);
    indentations.set(canonicalIndent, counts);
  }
  const formatAdded = (line: SourceLine) => {
    const indent = line.text.match(/^\s*/)![0];
    const candidates = indentations.get(indent.length);
    const best = candidates && [...candidates].sort((a, b) => b[1] - a[1])[0][0];
    return (best ?? indent) + line.text.trimStart();
  };
  const newline = raw.find(line => line.eol)?.eol || '\n';
  const edits: Array<{ at: number; remove: number; insert: SourceLine[] }> = [];
  const parts = diffArrays(oldLines.map(line => line.key), newLines.map(line => line.key));
  let oldAt = 0;
  let newAt = 0;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (!part.added && !part.removed) { oldAt += part.count; newAt += part.count; continue; }
    const removed = part.removed ? oldLines.slice(oldAt, oldAt + part.count) : [];
    const addition = part.added ? part : parts[index + 1]?.added ? parts[++index] : null;
    const added = addition ? newLines.slice(newAt, newAt + addition.count) : [];
    const positions = removed.map(locate);
    if (positions.some(position => position < 0)) return next;
    if (removed.length && removed.length === added.length) {
      positions.forEach((position, offset) => edits.push({
        at: position, remove: 1,
        insert: [{ ...raw[position], text: replaceLine(raw[position].text, removed[offset].text, added[offset].text) }],
      }));
    } else if (removed.length && added.length) {
      // A changed member list must occupy one contiguous original region.
      if (!positions.every((position, offset) => position === positions[0] + offset)) return next;
      edits.push({ at: positions[0], remove: positions.length,
        insert: added.map((line, offset) => ({ ...line, text: formatAdded(line), eol: offset === added.length - 1 ? raw[positions.at(-1)!].eol : newline })) });
    } else if (removed.length) {
      for (const position of positions) edits.push({ at: position, remove: 1, insert: [] });
    } else if (added.length) {
      const previousPosition = locate(oldLines[oldAt - 1]);
      const nextPosition = locate(oldLines[oldAt]);
      // Serializers lift comments and some declarations. If their original
      // positions disagree, the following declaration is the reliable anchor.
      const movedComment = oldLines[oldAt - 1]?.text.trimStart().startsWith('%%');
      const position = nextPosition >= 0 && (previousPosition < 0 || (movedComment && previousPosition >= nextPosition))
        ? nextPosition : previousPosition >= 0 ? previousPosition + 1 : nextPosition;
      if (position < 0) return next;
      const eol = raw[Math.max(0, position - 1)]?.eol || newline;
      const appendedWithoutNewline = position === raw.length && raw.at(-1)?.eol === '';
      if (appendedWithoutNewline) edits.push({ at: position - 1, remove: 1, insert: [{ ...raw[position - 1], eol }] });
      edits.push({ at: position, remove: 0, insert: added.map((line, offset) => ({
        ...line, text: formatAdded(line), eol: appendedWithoutNewline && offset === added.length - 1 ? '' : eol,
      })) });
    }
    oldAt += removed.length;
    newAt += added.length;
  }
  for (const edit of edits.sort((a, b) => b.at - a.at)) raw.splice(edit.at, edit.remove, ...edit.insert);
  // Moving/deleting the last declaration exposes the previous separator as
  // an EOF newline. Preserve whether the original source had that newline.
  if (raw.length && !/[\r\n]$/.test(source)) raw[raw.length - 1].eol = '';
  const candidate = raw.map(line => line.text + line.eol).join('');
  try {
    const parsed = parseMermaidVisualSource(candidate);
    return parsed && serializeMermaidVisualGraph(parsed) === next ? candidate : next;
  } catch { return next; }
}

/** Immutable graph objects are also the canvas's undo/redo snapshots. Retain
 * their exact source, rather than serializing old graphs during undo. */
export class MermaidSourceHistory {
  private sources = new WeakMap<MermaidVisualGraph, string>();
  private spellings = new Map<string, string>();
  reset(graph: MermaidVisualGraph | null, source: string) {
    // An external source edit starts a new authoring history. Equivalent old
    // graphs must not resurrect formatting from before that edit.
    this.sources = new WeakMap();
    this.spellings.clear();
    this.remember(graph, source);
  }
  remember(graph: MermaidVisualGraph | null, source: string) {
    if (!graph) return;
    this.sources.set(graph, source);
    let key: string;
    try {
      key = serializeMermaidVisualGraph(graph);
    } catch {
      // Retain original bytes for undo even when an imported graph is invalid.
      // Only valid graphs may enter the equivalent-spelling lookup.
      return;
    }
    this.spellings.delete(key);
    this.spellings.set(key, source);
    if (this.spellings.size > 160) this.spellings.delete(this.spellings.keys().next().value!);
  }
  commit(source: string, before: MermaidVisualGraph | null, after: MermaidVisualGraph, editBase?: MermaidVisualGraph) {
    this.remember(before, source);
    // A text replacement may temporarily empty a field. Patch the complete
    // edit against its starting source so that the intermediate deletion does
    // not move surrounding comments when the replacement is typed.
    const baseSource = editBase && this.sources.get(editBase);
    // A copy followed by deleting that copy also returns to an earlier model,
    // even though it is a new graph object rather than an undo snapshot.
    const next = this.sources.get(after) ?? this.spellings.get(serializeMermaidVisualGraph(after))
      ?? (baseSource !== undefined && editBase ? preserveMermaidSource(baseSource, editBase, after)
        : before ? preserveMermaidSource(source, before, after) : serializeMermaidVisualGraph(after));
    this.remember(after, next);
    return next;
  }
}
