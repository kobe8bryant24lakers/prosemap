import { diffChars } from 'diff';

export type DocumentChange = { from: number; to: number; insert: string };

/** Plan changes in the original document's UTF-16 coordinates. Keeping equal
 * spans outside the transaction preserves their original line-ending metadata.
 * A timed-out comparison is a failure, never permission to overwrite the range. */
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

  const parts = diffChars(previous, replacement, { timeout: 80 });
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
