import { markdownLanguage } from '@codemirror/lang-markdown';
import { diffArrays } from 'diff';
import { splitGraphemes } from 'unicode-segmenter/grapheme';

export type ProviderKind = 'openai' | 'anthropic';
export type AssistAction = 'polish' | 'continue' | 'summarize' | 'custom' | 'mermaid';

export type SelectionRange = {
  from: number;
  to: number;
  text: string;
};

export type ModelConfig = {
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type Proposal = {
  id: number;
  action: AssistAction;
  title: string;
  original: string;
  modified: string;
  reasoning: string;
  sourceDocument: string;
  from: number;
  to: number;
  status: 'streaming' | 'ready' | 'error';
  error?: string;
};

export type MermaidTarget = {
  from: number;
  to: number;
  source: string;
  fenced: string;
  linePrefix?: string;
  lineEnding?: '\n' | '\r\n';
  /** Actual Markdown container/indent prefix for each source line. */
  contentPrefixes?: string[];
} | null;

export type MermaidDocumentEdit = {
  from: number;
  to: number;
  replacement: string;
  diagramFrom: number;
  diagramTo: number;
};

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

export const INITIAL_MARKDOWN = `# 把复杂想法，变成清晰表达

ProseMap 是一间安静的 Markdown 工作室。你可以专注写作，也可以让 AI 在真正改动文稿之前，先把差异呈现给你。

> 所有修改都由你决定。AI 的建议不会直接覆盖原文。

## 一次可靠的内容工作流

\`\`\`mermaid
flowchart LR
  A[导入或新建] --> B[专注编辑]
  B --> C{需要 AI 协助?}
  C -- 文字 --> D[润色 / 续写 / 总结]
  C -- 图表 --> E[创建或修改 Mermaid]
  D --> F[差异预览]
  E --> F
  F --> G{接受修改?}
  G -- 接受 --> H[导出 Markdown]
  G -- 拒绝 --> B
\`\`\`

## 现在就开始

- 选中一段文字，再点击左侧的 **AI 助手**。
- 桌面端可直接打开一个 Markdown 文件，或打开包含 Markdown 的本地文件夹。
- 在预览图右上角点击 **画布编辑**，可直接拖拽、缩放和修改图表。
- 所有 AI 结果先进入差异预览，由你决定接受或拒绝。

| 能力 | 状态 |
| --- | --- |
| GitHub Flavored Markdown | ✅ |
| Mermaid 实时渲染 | ✅ |
| OpenAI-compatible / Claude | 配置后可用 |
`;

export const ACTION_LABELS: Record<AssistAction, string> = {
  polish: '润色表达',
  continue: '智能续写',
  summarize: '提炼总结',
  custom: '自定义指令',
  mermaid: 'Mermaid 智能绘图',
};

// Cursor movement should reuse the document parse rather than reparsing long
// Markdown on every selection update. Keep only the most recent document.
let mermaidTargetTree: { markdown: string; tree: ReturnType<typeof markdownLanguage.parser.parse> } | null = null;

export function findMermaidTarget(markdown: string, position: number): MermaidTarget {
  if (!Number.isInteger(position) || position < 0 || position > markdown.length) return null;
  if (!markdown.includes('```') && !markdown.includes('~~~')) return null;
  if (mermaidTargetTree?.markdown !== markdown) {
    mermaidTargetTree = { markdown, tree: markdownLanguage.parser.parse(markdown) };
  }
  // Resolve both sides so the opening/closing fence endpoints remain selectable.
  for (const bias of [1, -1] as const) {
    let node = mermaidTargetTree.tree.resolveInner(position, bias);
    while (node.name !== 'FencedCode' && node.parent) node = node.parent;
    if (node.name !== 'FencedCode' || position < node.from || position > node.to) continue;
    const info = node.getChild('CodeInfo');
    if (!info || markdown.slice(info.from, info.to).trim().split(/\s/)[0].toLowerCase() !== 'mermaid') continue;
    const marks = node.getChildren('CodeMark');
    if (marks.length !== 2) continue;
    // Markdown's CodeText nodes already omit list/blockquote prefixes. Joining
    // their original slices preserves Mermaid indentation and LF/CRLF bytes.
    const source = node.getChildren('CodeText').map((part) => markdown.slice(part.from, part.to)).join('');
    return createMermaidTarget(markdown, marks[0].from, marks[1].to, source);
  }
  return null;
}

export function createMermaidTarget(
  markdown: string,
  from: number,
  to: number,
  source: string,
): MermaidTarget {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > markdown.length) return null;
  if (mermaidTargetTree?.markdown !== markdown) {
    mermaidTargetTree = { markdown, tree: markdownLanguage.parser.parse(markdown) };
  }
  const firstMark = markdown.slice(from, to).search(/`{3,}|~{3,}/);
  if (firstMark < 0) return null;
  let node = mermaidTargetTree.tree.resolveInner(from + firstMark, 1);
  while (node.name !== 'FencedCode' && node.parent) node = node.parent;
  const marks = node.name === 'FencedCode' ? node.getChildren('CodeMark') : [];
  if (marks.length !== 2 || marks[0].from < from || marks[1].to > to) return null;
  // Preview and cursor parsers disagree about indentation/trailing spaces in
  // the node range. Use the actual marks so both edit exactly the same bytes.
  from = marks[0].from;
  to = marks[1].to;
  const fenced = markdown.slice(from, to);
  const lineEnding = fenced.includes('\r\n') ? '\r\n' : '\n';
  const lines = splitFenceLines(fenced);
  const parts = node.getChildren('CodeText');
  let offset = from + lines[0].text.length + lines[0].eol.length;
  const body = lines.slice(1, -1).map(line => {
    const part = parts.find(part => part.to > offset && part.from <= offset + line.text.length);
    // CodeText starts after the Markdown container, while retaining Mermaid
    // indentation. Closing-fence indentation is independent of content and
    // must never be used to strip source lines.
    const prefix = part ? line.text.slice(0, Math.max(0, part.from - offset))
      : /^[\t >]*$/.test(line.text) ? line.text : '';
    offset += line.text.length + line.eol.length;
    return { ...line, text: line.text.slice(prefix.length), prefix };
  });
  const containerPrefix = body.find(line => line.text.trim())?.prefix ?? '';
  const openingLineStart = Math.max(markdown.lastIndexOf('\n', from - 1), markdown.lastIndexOf('\r', from - 1)) + 1;
  const openingPrefix = markdown.slice(openingLineStart, from);
  const fenceIndent = Math.max(0, Math.min(3, openingPrefix.length - containerPrefix.length));
  for (const line of body) {
    const indent = Math.min(fenceIndent, line.text.match(/^ */)![0].length);
    line.prefix += line.text.slice(0, indent);
    line.text = line.text.slice(indent);
  }
  const linePrefix = containerPrefix + ' '.repeat(fenceIndent);
  // Preview libraries trim/normalize code text. Recover the editable source
  // from the actual document so both entry points retain code-edge whitespace.
  const exactSource = body.length
    ? body.map((line, index) => line.text + (index < body.length - 1 ? line.eol : '')).join('')
    : source;
  return { from, to, source: exactSource, fenced, linePrefix, lineEnding, contentPrefixes: body.map(line => line.prefix) };
}

type FenceLine = { text: string; eol: string; prefix?: string };

function splitFenceLines(source: string): FenceLine[] {
  return source.split(/(\r\n|\n|\r)/).reduce<FenceLine[]>((lines, text, index, parts) => {
    if (index % 2 === 0) lines.push({ text, eol: parts[index + 1] ?? '' });
    return lines;
  }, []);
}

function decodeFenceBody(lines: FenceLine[], prefix: string, prefixes?: string[]): FenceLine[] {
  return lines.slice(1, -1).map((line, index) => {
    const actualPrefix = prefixes?.[index] ?? (line.text.startsWith(prefix) ? prefix
      : /^[\t >]*$/.test(line.text) ? line.text
        : line.text.match(/^(?:[\t ]*>[\t ]*)+/)?.[0] ?? '');
    return { text: line.text.slice(actualPrefix.length), prefix: actualPrefix, eol: line.eol };
  });
}

export function formatMermaidFence(source: string, target: MermaidTarget = null): string {
  const lineEnding = target?.lineEnding ?? '\n';
  const linePrefix = target?.linePrefix ?? '';
  if (target?.fenced) {
    if (source === target.source) return target.fenced;
    const lines = splitFenceLines(target.fenced);
    const body = decodeFenceBody(lines, linePrefix, target.contentPrefixes);
    const nextLines = source.replace(/\r\n?/g, '\n').split('\n');
    const changes = diffArrays(body.map(line => line.text), nextLines);
    const result: FenceLine[] = [];
    let oldAt = 0;
    for (let index = 0; index < changes.length; index++) {
      const change = changes[index];
      if (!change.added && !change.removed) {
        result.push(...body.slice(oldAt, oldAt + change.value.length));
        oldAt += change.value.length;
      } else if (change.removed) {
        const removed = body.slice(oldAt, oldAt + change.value.length);
        oldAt += change.value.length;
        if (changes[index + 1]?.added) {
          result.push(...changes[++index].value.map((text, offset) => ({
            text, prefix: removed[offset]?.prefix ?? linePrefix, eol: removed[offset]?.eol || lineEnding,
          })));
        }
      } else {
        result.push(...change.value.map(text => ({ text, prefix: linePrefix, eol: lineEnding })));
      }
    }
    return lines[0].text + lines[0].eol
      + result.map(line => (line.prefix ?? linePrefix) + line.text + (line.eol || lineEnding)).join('')
      + lines.at(-1)!.text;
  }
  const sourceLines = source.trim().replace(/\r\n?/g, '\n').split('\n');
  return ['```mermaid', ...sourceLines, '```']
    .map((line, index) => index === 0 ? line : `${linePrefix}${line}`)
    .join(lineEnding);
}

/**
 * Plans one complete Mermaid document edit without depending on React or
 * CodeMirror timing. New diagrams are inserted at the exact editor head that
 * was captured when the workbench opened. The returned diagram range excludes
 * any spacing added around the fence, so callers can restore the editor to the
 * diagram itself instead of scrolling past it.
 */
export function createMermaidDocumentEdit(
  markdown: string,
  source: string,
  target: MermaidTarget,
  insertAt: number,
): MermaidDocumentEdit {
  if (target) {
    const replacement = formatMermaidFence(source, target);
    return {
      from: target.from,
      to: target.to,
      replacement,
      diagramFrom: target.from,
      diagramTo: target.from + replacement.length,
    };
  }

  const normalizedInsertAt = Number.isFinite(insertAt)
    ? Math.max(0, Math.min(markdown.length, Math.trunc(insertAt)))
    : 0;
  const lineEnding: '\n' | '\r\n' = markdown.includes('\r\n') ? '\r\n' : '\n';
  const fenceTarget = {
    from: 0,
    to: 1,
    source: '',
    fenced: '',
    linePrefix: '',
    lineEnding,
  };
  const fenced = formatMermaidFence(source, fenceTarget);
  const previousCharacter = markdown[normalizedInsertAt - 1];
  const nextCharacter = markdown[normalizedInsertAt];
  const prefix = normalizedInsertAt > 0 && previousCharacter !== '\n'
    ? lineEnding.repeat(2)
    : '';
  const suffix = normalizedInsertAt < markdown.length && nextCharacter !== '\n' && nextCharacter !== '\r'
    ? lineEnding.repeat(2)
    : lineEnding;
  const replacement = `${prefix}${fenced}${suffix}`;
  const diagramFrom = normalizedInsertAt + prefix.length;
  return {
    from: normalizedInsertAt,
    to: normalizedInsertAt,
    replacement,
    diagramFrom,
    diagramTo: diagramFrom + fenced.length,
  };
}

export function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:mermaid)?\s*\n?([\s\S]*?)\n?```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

export function safeDocumentName(value: string): string {
  const withoutControlCharacters = Array.from(value, (character) => character.charCodeAt(0) < 32 ? '-' : character).join('');
  const cleaned = withoutControlCharacters
    .replace(/\.(md|markdown|mdown|mkdn|txt)$/i, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim()
    .slice(0, 80);
  return cleaned || '未命名文档';
}

export function countReadableCharacters(value: string): number {
  // Count visible graphemes, not UTF-16 code units. Use the same Unicode rules
  // on older WebViews that do not provide Intl.Segmenter.
  let count = 0;
  for (const grapheme of splitGraphemes(value)) if (/\S/u.test(grapheme)) count += 1;
  return count;
}
