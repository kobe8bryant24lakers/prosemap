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
} | null;

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

export function findMermaidTarget(markdown: string, position: number): MermaidTarget {
  const pattern = /```mermaid[\t ]*\r?\n([\s\S]*?)\r?\n```/gi;
  for (const match of markdown.matchAll(pattern)) {
    const from = match.index ?? 0;
    const fenced = match[0];
    const to = from + fenced.length;
    if (position >= from && position <= to) {
      return createMermaidTarget(markdown, from, to, match[1]);
    }
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
  const fenced = markdown.slice(from, to);
  const lineEnding = fenced.includes('\r\n') ? '\r\n' : '\n';
  const rawLines = fenced.split(/\r?\n/);
  const normalizedSource = source.trim();
  const firstSourceLine = normalizedSource.split(/\r?\n/, 1)[0];
  const firstRawContentLine = rawLines[1] ?? '';
  let linePrefix = '';
  if (firstSourceLine && firstRawContentLine.endsWith(firstSourceLine)) {
    linePrefix = firstRawContentLine.slice(0, -firstSourceLine.length);
  } else {
    const closingLine = rawLines.at(-1) ?? '';
    linePrefix = closingLine.match(/^(.*?)(?:`{3,}|~{3,})[\t ]*$/)?.[1] ?? '';
  }
  return { from, to, source: normalizedSource, fenced, linePrefix, lineEnding };
}

export function formatMermaidFence(source: string, target: MermaidTarget = null): string {
  const lineEnding = target?.lineEnding ?? '\n';
  const linePrefix = target?.linePrefix ?? '';
  const sourceLines = source.trim().replace(/\r\n?/g, '\n').split('\n');
  return ['```mermaid', ...sourceLines, '```']
    .map((line, index) => index === 0 ? line : `${linePrefix}${line}`)
    .join(lineEnding);
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
  return value.replace(/\s/g, '').length;
}
