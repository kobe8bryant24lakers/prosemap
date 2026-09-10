'use client';

import { t, uiMessage } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';

import { useState } from 'react';
import { isDesktopRuntime } from '@/lib/ai-client';
import { previewHeadingIds, isExternalPreviewLink } from '@/lib/preview-links';
import CodeBlock from './CodeBlock';
import { FileText } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createMermaidTarget, type MermaidTarget } from '@/lib/editor';
import { compactJsonPreviewIndentation } from '@/lib/markdown-preview';
import MermaidDiagram from './MermaidDiagram';

type MarkdownPreviewProps = {
  markdown: string;
  onEditMermaid?: (target: NonNullable<MermaidTarget>) => void;
};

export default function MarkdownPreview({ markdown, onEditMermaid }: MarkdownPreviewProps) {
  useLocale();
  const [linkError, setLinkError] = useState('');
  if (!markdown.trim()) {
    return (
      <div className="preview-empty">
        <span><FileText size={23} /></span>
        <strong>{t("预览会出现在这里")}</strong>
        <p>{t("从左侧开始写 Markdown，内容会实时呈现。")}</p>
      </div>
    );
  }

  const components: Components = {
    a({ children, href, title }) {
      return <a href={href} title={title} target={href?.startsWith('#') ? undefined : '_blank'} rel="noreferrer noopener" onClick={async (event) => {
        setLinkError('');
        if (href?.startsWith('#')) {
          event.preventDefault();
          try {
            const id = decodeURIComponent(href.slice(1));
            const target = Array.from(event.currentTarget.closest('article')?.querySelectorAll('[id]') ?? []).find((element) => element.id === id);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            else setLinkError(t("未找到对应的文档标题"));
          } catch { setLinkError(t("标题链接无效")); }
          return;
        }
        if (!href || !isExternalPreviewLink(href)) {
          event.preventDefault();
          setLinkError(t("暂不支持此链接类型，请使用完整网页地址或页内标题链接。"));
          return;
        }
        // Prevent default before awaiting desktop detection; browser windows must
        // still be opened synchronously within the user gesture.
        if ('__TAURI_INTERNALS__' in window) {
          event.preventDefault();
          try {
            if (await isDesktopRuntime()) {
              const { invoke } = await import('@tauri-apps/api/core');
              await invoke('open_external_url', { url: href });
            }
          } catch { setLinkError(t("无法打开链接，请检查系统默认浏览器或邮件应用。")); }
        }
      }}>{children}</a>;
    },
    pre({ children, node }) {
      const code = node?.children.find((child) => child.type === 'element' && child.tagName === 'code');
      if (code?.type === 'element') {
        const language = /language-([^\s]+)/.exec(String(code.properties.className ?? ''))?.[1]?.toLowerCase() ?? '';
        if (language !== 'mermaid') {
          const source = code.children.map((child) => child.type === 'text' ? child.value : '').join('').replace(/\n$/, '');
          return <CodeBlock source={language === 'json' ? compactJsonPreviewIndentation(source) : source} language={language} />;
        }
      }
      return <pre>{children}</pre>;
    },
    code({ className, children, node, ...props }) {
      const language = /language-([^\s]+)/.exec(className ?? '')?.[1]?.toLowerCase();
      const value = String(children).replace(/\n$/, '');
      if (language === 'mermaid') {
        const from = node?.position?.start.offset;
        const to = node?.position?.end.offset;
        const target = typeof from === 'number' && typeof to === 'number'
          ? createMermaidTarget(markdown, from, to, value)
          : null;
        return (
          <MermaidDiagram
            code={value}
            onEdit={target && onEditMermaid ? () => onEditMermaid(target) : undefined}
          />
        );
      }
      if (language === 'json') {
        return <code className={className} {...props}>{compactJsonPreviewIndentation(String(children))}</code>;
      }
      return <code className={className} {...props}>{children}</code>;
    },
  };

  return (
    <article className="markdown-body">
      <>{linkError && <div className="preview-link-error" role="alert">{uiMessage(linkError)}</div>}<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[previewHeadingIds]} components={components}>{markdown}</ReactMarkdown></>
    </article>
  );
}
