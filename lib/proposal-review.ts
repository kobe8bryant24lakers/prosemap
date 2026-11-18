import { diffLines } from 'diff';

export type ReviewRow = {
  kind: 'added' | 'removed' | 'context'; text: string; line: number;
  ending: 'LF' | 'CRLF' | null; showEnding?: boolean;
};
export type ReviewHunk = { start: number; end: number; fromLine: number; toLine: number; inserted: boolean };

/** Half-open ranges into the full comparison. A replacement is one change,
 * even when jsdiff represents it as separate removal and insertion chunks. */
export function buildProposalReview(original: string, modified: string, firstLine: number) {
  const rows: ReviewRow[] = [];
  const hunks: ReviewHunk[] = [];
  let oldLine = firstLine, newLine = firstLine, added = 0, removed = 0;
  let current: ReviewHunk | undefined;
  for (const change of diffLines(original, modified)) {
    const kind = change.added ? 'added' : change.removed ? 'removed' : 'context';
    if (kind === 'context') current = undefined;
    else if (!current) {
      current = { start: rows.length, end: rows.length, fromLine: oldLine, toLine: oldLine, inserted: true };
      hunks.push(current);
    }
    const lines = change.value.split('\n');
    const terminated = lines.at(-1) === '';
    if (terminated) lines.pop();
    for (const [i, raw] of lines.entries()) {
      const ending = !terminated && i === lines.length - 1 ? null : raw.endsWith('\r') ? 'CRLF' : 'LF';
      const text = ending === 'CRLF' ? raw.slice(0, -1) : raw;
      rows.push({ kind, text, ending, line: kind === 'removed' ? oldLine : newLine });
      if (current) {
        current.end = rows.length;
        if (kind === 'removed') { current.toLine = oldLine; current.inserted = false; }
      }
      if (kind !== 'added') oldLine++;
      if (kind !== 'removed') newLine++;
    }
    if (kind === 'added') added += lines.length;
    if (kind === 'removed') removed += lines.length;
  }
  // Explain otherwise identical replacements, without decorating ordinary text.
  for (const hunk of hunks) {
    const changed = rows.slice(hunk.start, hunk.end);
    const before = changed.filter(row => row.kind === 'removed');
    const after = changed.filter(row => row.kind === 'added');
    before.forEach((row, i) => {
      const replacement = after[i];
      if (replacement && row.text === replacement.text && row.ending !== replacement.ending) {
        row.showEnding = replacement.showEnding = true;
      }
    });
  }
  return { rows, hunks, added, removed };
}
