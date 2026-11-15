export function synchronizedScrollTop(
  sourceScrollTop: number,
  sourceScrollHeight: number,
  sourceClientHeight: number,
  targetScrollHeight: number,
  targetClientHeight: number,
) {
  const sourceRange = scrollRange(sourceScrollHeight, sourceClientHeight);
  const targetRange = scrollRange(targetScrollHeight, targetClientHeight);
  if (sourceRange === 0 || targetRange === 0) return 0;

  const normalizedSourceTop = Number.isFinite(sourceScrollTop) ? sourceScrollTop : 0;
  const progress = Math.max(0, Math.min(1, normalizedSourceTop / sourceRange));
  return progress * targetRange;
}

export type ScrollAnchor = { source: number; target: number };

// Match rendered blocks to their source lines before interpolating. Whole-page
// percentages drift when a short Markdown block produces a tall image or table.
export function anchoredScrollTop(sourceTop: number, sourceRange: number, targetRange: number, anchors: ScrollAnchor[]) {
  if (sourceRange <= 0 || targetRange <= 0) return 0;
  const top = Math.max(0, Math.min(sourceRange, Number.isFinite(sourceTop) ? sourceTop : 0));
  let previous = { source: 0, target: 0 };
  for (const next of [...anchors, { source: sourceRange, target: targetRange }]) {
    if (!Number.isFinite(next.source) || !Number.isFinite(next.target)
      || next.source <= previous.source || next.target < previous.target
      || next.source > sourceRange || next.target > targetRange) continue;
    if (top <= next.source) {
      const progress = (top - previous.source) / (next.source - previous.source);
      return previous.target + progress * (next.target - previous.target);
    }
    previous = next;
  }
  return targetRange;
}

function scrollRange(scrollHeight: number, clientHeight: number) {
  const normalizedScrollHeight = Number.isFinite(scrollHeight) ? Math.max(0, scrollHeight) : 0;
  const normalizedClientHeight = Number.isFinite(clientHeight) ? Math.max(0, clientHeight) : 0;
  return Math.max(0, normalizedScrollHeight - normalizedClientHeight);
}
