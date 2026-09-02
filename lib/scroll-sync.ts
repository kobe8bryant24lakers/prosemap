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

function scrollRange(scrollHeight: number, clientHeight: number) {
  const normalizedScrollHeight = Number.isFinite(scrollHeight) ? Math.max(0, scrollHeight) : 0;
  const normalizedClientHeight = Number.isFinite(clientHeight) ? Math.max(0, clientHeight) : 0;
  return Math.max(0, normalizedScrollHeight - normalizedClientHeight);
}
