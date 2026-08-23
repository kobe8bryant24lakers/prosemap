'use client';

import { FileText } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MermaidDiagram from './MermaidDiagram';

type MarkdownPreviewProps = {
  markdown: string;
};

const components: Components = {
  a({ children, ...props }) {
    return <a {...props} target="_blank" rel="noreferrer noopener">{children}</a>;
  },
  code({ className, children, ...props }) {
    const language = /language-([^\s]+)/.exec(className ?? '')?.[1]?.toLowerCase();
    const value = String(children).replace(/\n$/, '');
    if (language === 'mermaid') return <MermaidDiagram code={value} />;
    return <code className={className} {...props}>{children}</code>;
  },
};

export default function MarkdownPreview({ markdown }: MarkdownPreviewProps) {
  if (!markdown.trim()) {
    return (
      <div className="preview-empty">
        <span><FileText size={23} /></span>
        <strong>预览会出现在这里</strong>
        <p>从左侧开始写 Markdown，内容会实时呈现。</p>
      </div>
    );
  }

  return (
    <article className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{markdown}</ReactMarkdown>
    </article>
  );
}
