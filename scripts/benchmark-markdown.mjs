// Repeatable CPU benchmark, not an end-to-end browser latency or FPS measurement.
// Run: node --experimental-strip-types scripts/benchmark-markdown.mjs
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { previewHtmlSanitize } from '../lib/preview-html.ts';
import { previewLineBreaks } from '../lib/markdown-preview.ts';
import { previewHeadingIds } from '../lib/preview-links.ts';
import { parseMermaidVisualSource } from '../lib/mermaid-workbench.ts';
import { layoutMermaidGraph } from '../lib/mermaid-canvas-layout.ts';
const markdown = readFileSync(new URL('../docs/fixtures/complex-markdown.md', import.meta.url), 'utf8');
const graphs = [...markdown.matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map((match) => parseMermaidVisualSource(match[1]));
function measure(run, samples = 30) {
  for (let i = 0; i < 5; i++) run();
  const times = [];
  for (let i = 0; i < samples; i++) { const start = performance.now(); run(); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  return { samples, medianMs: +times[Math.floor(samples / 2)].toFixed(2), p95Ms: +times[Math.ceil(samples * .95) - 1].toFixed(2) };
}
console.log(JSON.stringify({
  node: process.version, bytes: Buffer.byteLength(markdown), lines: markdown.split('\n').length, diagrams: graphs.length,
  markdownParseAndServerRender: measure(() => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, previewLineBreaks], rehypePlugins: [rehypeRaw, previewHtmlSanitize, previewHeadingIds] }, markdown))),
  sevenCanvasLayouts: measure(() => graphs.forEach((graph) => layoutMermaidGraph(graph))),
  note: 'Warm CPU measurements. Excludes browser DOM, syntax highlighting and Mermaid SVG rendering; not a typing latency or FPS claim.',
}, null, 2));
