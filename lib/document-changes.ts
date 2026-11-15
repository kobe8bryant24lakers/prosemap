import { diffChars } from 'diff';

export type DocumentChange = { from: number; to: number; insert: string };

type DiffPart = { value: string; added?: boolean; removed?: boolean };

// A short diagram can exhaust Myers's wall-clock budget on a busy WebKit
// runner. Finish those small comparisons with a bounded exact LCS, preserving
// equal characters rather than replacing the entire range. At most one million
// cells (about 2 MB) are visited; larger comparisons still fail closed.
function boundedSmallDiff(previous: string, replacement: string): DiffPart[] | null {
  if (previous.length + replacement.length > 4096) return null;
  const oldText = Array.from(previous), newText = Array.from(replacement);
  const width = newText.length + 1;
  const cells = (oldText.length + 1) * width;
  if (cells > 1_000_000) return null;
  const lengths = new Uint16Array(cells);
  for (let old = oldText.length - 1; old >= 0; old--) {
    for (let next = newText.length - 1; next >= 0; next--) {
      const at = old * width + next;
      lengths[at] = oldText[old] === newText[next]
        ? lengths[at + width + 1] + 1
        : Math.max(lengths[at + width], lengths[at + 1]);
    }
  }
  const parts: DiffPart[] = [];
  let old = 0, next = 0;
  while (old < oldText.length || next < newText.length) {
    if (old < oldText.length && next < newText.length && oldText[old] === newText[next]) {
      parts.push({ value: oldText[old++] });
      next++;
    } else if (old < oldText.length && (next === newText.length
      || lengths[(old + 1) * width + next] >= lengths[old * width + next + 1])) {
      parts.push({ value: oldText[old++], removed: true });
    } else {
      parts.push({ value: newText[next++], added: true });
    }
  }
  return parts;
}

/** Plan changes in the original document's UTF-16 coordinates. Keeping equal
 * spans outside the transaction preserves their original line-ending metadata.
 * An incomplete comparison is a failure, never permission to overwrite the range. */
export function minimalDocumentChanges(previous: string, replacement: string, from: number): DocumentChange[] | null {
  if (!Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(from + previous.length)) return null;
  if (previous === replacement) return [];
  if (!previous) return [{ from, to: from, insert: replacement }];
  if (!replacement) return [{ from, to: from + previous.length, insert: '' }];

  // Single contiguous insertions/deletions need no edit-distance search. Scan
  // code points so the boundary cannot split a shared emoji surrogate pair.
  const delta = replacement.length - previous.length;
  if (delta) {
    let prefix = 0;
    while (prefix < previous.length && prefix < replacement.length
      && previous.codePointAt(prefix) === replacement.codePointAt(prefix)) {
      prefix += previous.codePointAt(prefix)! > 0xffff ? 2 : 1;
    }
    if (delta > 0 && previous.slice(prefix) === replacement.slice(prefix + delta)) {
      return [{ from: from + prefix, to: from + prefix, insert: replacement.slice(prefix, prefix + delta) }];
    }
    if (delta < 0 && previous.slice(prefix - delta) === replacement.slice(prefix)) {
      return [{ from: from + prefix, to: from + prefix - delta, insert: '' }];
    }
  }

  const parts = diffChars(previous, replacement, { timeout: 80 }) ?? boundedSmallDiff(previous, replacement);
  if (!parts) return null;
  const changes: DocumentChange[] = [];
  let position = from;
  let pending: DocumentChange | null = null;
  for (const part of parts) {
    if (!part.added && !part.removed) {
      if (pending) { changes.push(pending); pending = null; }
      position += part.value.length;
      continue;
    }
    pending ??= { from: position, to: position, insert: '' };
    if (part.removed) {
      // diffChars counts Unicode code points; CodeMirror counts UTF-16 units.
      position += part.value.length;
      pending.to = position;
    } else pending.insert += part.value;
  }
  if (pending) changes.push(pending);
  return changes;
}
