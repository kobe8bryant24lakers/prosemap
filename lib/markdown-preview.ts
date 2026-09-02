const JSON_PREVIEW_INDENT = 2;

export function compactJsonPreviewIndentation(value: string) {
  try {
    JSON.parse(value);
  } catch {
    return value;
  }

  const normalizedTabs = value.replace(
    /^[\t ]+(?=\S)/gm,
    (prefix) => prefix.replace(/\t/g, ' '.repeat(JSON_PREVIEW_INDENT)),
  );
  const indentationPrefixes = Array.from(normalizedTabs.matchAll(/^ +(?=\S)/gm), (match) => match[0]);
  if (!indentationPrefixes.length) return value;

  const indentationWidths = indentationPrefixes.map((prefix) => prefix.length);
  const sourceIndent = indentationWidths.reduce(greatestCommonDivisor);
  if (sourceIndent <= JSON_PREVIEW_INDENT) return normalizedTabs;

  return normalizedTabs.replace(/^ +(?=\S)/gm, (prefix) => {
    const compactedWidth = prefix.length / sourceIndent * JSON_PREVIEW_INDENT;
    return ' '.repeat(compactedWidth);
  });
}

function greatestCommonDivisor(left: number, right: number): number {
  let remainderLeft = Math.abs(left);
  let remainderRight = Math.abs(right);
  while (remainderRight) {
    [remainderLeft, remainderRight] = [remainderRight, remainderLeft % remainderRight];
  }
  return remainderLeft;
}
