import { markdownLanguage } from '@codemirror/lang-markdown';
import { LanguageDescription } from '@codemirror/language';
import { languages as languageData } from '@codemirror/language-data';
import { classHighlighter, highlightTree } from '@lezer/highlight';

export const languages = [LanguageDescription.of({
  name: 'JSONC',
  load: () => LanguageDescription.matchLanguageName(languageData, 'json')!.load(),
}), ...languageData];

export async function highlightCode(source: string, name: string) {
  const description = LanguageDescription.matchLanguageName(languages, name, true);
  if (!description) return [{ text: source, className: '' }];
  const support = await description.load();
  const tokens: { text: string; className: string }[] = [];
  let position = 0;
  highlightTree(support.language.parser.parse(source), classHighlighter, (from, to, className) => {
    if (from > position) tokens.push({ text: source.slice(position, from), className: '' });
    tokens.push({ text: source.slice(from, to), className });
    position = to;
  });
  if (position < source.length) tokens.push({ text: source.slice(position), className: '' });
  return tokens;
}

type CodeBlockRange = { from: number; to: number; language: string; source: string };

export function findCodeBlock(document: string, position: number): CodeBlockRange | null {
  const tree = markdownLanguage.parser.parse(document);
  let result: CodeBlockRange | null = null;
  tree.iterate({ enter(node) {
    if (node.name !== 'FencedCode' || position < node.from || position > node.to) return;
    if (node.node.parent?.name !== 'Document') return;
    const info = node.node.getChild('CodeInfo');
    const code = node.node.getChild('CodeText');
    if (!info || !code) return;
    // Container prefixes (lists/quotes) require a separate prefix-aware edit.
    const start = document.lastIndexOf('\n', node.from - 1) + 1;
    if (document.slice(start, node.from).trim()) return;
    const source = document.slice(code.from, code.to);
    if (/^\s*>/m.test(source)) return;
    result = { from: code.from, to: code.to, language: document.slice(info.from, info.to).split(/\s/)[0].toLowerCase(), source };
  } });
  return result as CodeBlockRange | null;
}

export async function formatCode(source: string, language: string): Promise<string> {
  const parsers: Record<string, string> = {
    json: 'json-stringify', jsonc: 'jsonc', json5: 'json5', js: 'babel', javascript: 'babel', jsx: 'babel',
    ts: 'typescript', typescript: 'typescript', tsx: 'typescript', css: 'css', scss: 'scss', less: 'less',
    html: 'html', vue: 'vue', yaml: 'yaml', yml: 'yaml', graphql: 'graphql', gql: 'graphql',
  };
  const parser = parsers[language.toLowerCase()];
  if (!parser) throw new Error(`暂不支持 ${language} 自动格式化；仍可使用缩进和语法高亮。`);
  const [{ format }, babel, estree, typescript, postcss, html, yaml, graphql] = await Promise.all([
    import('prettier/standalone'), import('prettier/plugins/babel'), import('prettier/plugins/estree'),
    import('prettier/plugins/typescript'), import('prettier/plugins/postcss'), import('prettier/plugins/html'),
    import('prettier/plugins/yaml'), import('prettier/plugins/graphql'),
  ]);
  return (await format(source, { parser, plugins: [babel, estree, typescript, postcss, html, yaml, graphql], tabWidth: 2, printWidth: 88 })).trimEnd();
}
