import { Facet, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { invertedEffects } from '@codemirror/commands';

type LineEnding = '\n' | '\r\n' | '\r';
type Endings = { preferred: LineEnding; breaks: readonly { at: number; ending: LineEnding }[] };

export function normalizeDocumentText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n');
}

function readEndings(raw: string): Endings {
  let removed = 0;
  const counts = new Map<LineEnding, number>();
  const breaks = Array.from(raw.matchAll(/\r\n|\r|\n/g), (match) => {
    const ending = match[0] as LineEnding;
    const at = match.index - removed;
    removed += ending.length - 1;
    counts.set(ending, (counts.get(ending) ?? 0) + 1);
    return { at, ending };
  });
  // Stable sorting makes the first encountered style win a tie.
  const preferred = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '\n';
  return { breaks, preferred };
}

const restoreEndings = StateEffect.define<Endings>();
const initialEndings = Facet.define<Endings, Endings>({ combine: (values) => values[0] ?? readEndings('') });
const endingsField = StateField.define<Endings>({
  create: (state) => state.facet(initialEndings),
  update(value, transaction) {
    const restore = transaction.effects.findLast((effect) => effect.is(restoreEndings));
    if (restore) return restore.value as Endings;
    if (!transaction.docChanged) return value;
    const breaks: { at: number; ending: LineEnding }[] = [];
    let cursor = 0;
    transaction.changes.iterGaps((from, mappedFrom, length) => {
      while (cursor < value.breaks.length && value.breaks[cursor].at < from) cursor++;
      while (cursor < value.breaks.length && value.breaks[cursor].at < from + length) {
        const item = value.breaks[cursor++];
        breaks.push({ at: mappedFrom + item.at - from, ending: item.ending });
      }
    });
    transaction.changes.iterChanges((_from, _to, from, _end, inserted) => {
      for (let line = 1; line < inserted.lines; line++) {
        breaks.push({ at: from + inserted.line(line).to, ending: value.preferred });
      }
    });
    breaks.sort((a, b) => a.at - b.at);
    return { preferred: value.preferred, breaks };
  },
});

/** Keep CodeMirror/preview offsets in LF coordinates; preserve disk endings separately. */
export function documentLineEndings(raw: string): Extension {
  return [
    initialEndings.of(readEndings(raw)),
    endingsField,
    invertedEffects.of((transaction) => transaction.docChanged
      ? [restoreEndings.of(transaction.startState.field(endingsField))]
      : []),
  ];
}

export function serializeDocument(state: EditorState): string {
  const text = state.doc.toString();
  const endings = state.field(endingsField, false);
  if (!endings) return text;
  if (endings.breaks.length !== state.doc.lines - 1 || endings.breaks.some((item, index) =>
    text[item.at] !== '\n' || (index > 0 && item.at <= endings.breaks[index - 1].at))) {
    // Unknown extensions may remap history outside our document transactions.
    // Reject a save instead of ever slicing ordinary text at stale break offsets.
    throw new Error('无法安全保存：文档行尾状态不一致。当前编辑内容已保留，请复制备份后重新打开文件。');
  }
  const parts: string[] = [];
  let start = 0;
  for (const { at, ending } of endings.breaks) {
    parts.push(text.slice(start, at), ending);
    start = at + 1;
  }
  parts.push(text.slice(start));
  return parts.join('');
}
