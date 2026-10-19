'use client';

import { t, uiMessage } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';

import { createContext, memo, useContext, useMemo, useState, type ImgHTMLAttributes } from 'react';
import PreviewImage from './PreviewImage';
import { isDesktopRuntime } from '@/lib/ai-client';
import { previewHeadingIds, isExternalPreviewLink, isRelativeFileLink } from '@/lib/preview-links';
import { openRelativeFile } from '@/lib/local-desktop';
import CodeBlock from './CodeBlock';
import { FileText } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { previewHtmlSanitize } from '@/lib/preview-html';
import { createMermaidTarget, type MermaidTarget } from '@/lib/editor';
import { compactJsonPreviewIndentation, previewLineBreaks } from '@/lib/markdown-preview';
import { relativeFileLinks } from '@/lib/relative-file-links';
import MermaidDiagram from './MermaidDiagram';

type MarkdownPreviewProps = {
  markdown: string;
  documentPath?: string | null;
  onEditMermaid?: (target: NonNullable<MermaidTarget>) => void;
};

const PreviewImg = ({ src, alt, title }: ImgHTMLAttributes<HTMLImageElement>) => {
  const { documentPath } = useContext(PreviewContext);
  return <PreviewImage src={typeof src === 'string' ? src : undefined} alt={alt} title={title} documentPath={documentPath} />;
};

const PreviewContext = createContext<MarkdownPreviewProps>({ markdown: '' });

const PreviewPre: Components['pre'] = ({ children, node }) => {
  const code = node?.children.find((child) => child.type === 'element' && child.tagName === 'code');
  if (code?.type === 'element') {
    const language = /language-([^\s]+)/.exec(String(code.properties.className ?? ''))?.[1]?.toLowerCase() ?? '';
    if (language !== 'mermaid') {
      const source = code.children.map((child) => child.type === 'text' ? child.value : '').join('').replace(/\n$/, '');
      return <CodeBlock source={language === 'json' ? compactJsonPreviewIndentation(source) : source} language={language} />;
    }
  }
  return <pre>{children}</pre>;
};

const PreviewCode: Components['code'] = ({ className, children, node, ...props }) => {
  const { markdown, onEditMermaid } = useContext(PreviewContext);
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
};

function MarkdownPreview({ markdown, documentPath, onEditMermaid }: MarkdownPreviewProps) {
  useLocale();
  const [linkError, setLinkError] = useState('');
  const context = useMemo(() => ({ markdown, documentPath, onEditMermaid }), [markdown, documentPath, onEditMermaid]);
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
    img: PreviewImg,
    a({ children, href, title, style }) {
      return <a href={href} title={title} style={style} target={href?.startsWith('#') ? undefined : '_blank'} rel="noreferrer noopener" onClick={async (event) => {
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
        if (href && isRelativeFileLink(href)) {
          event.preventDefault();
          if (!documentPath) { setLinkError(t("请先保存 Markdown 文档，再打开相对路径文件。")); return; }
          try {
            await openRelativeFile(documentPath, href);
          } catch (error) { setLinkError(uiMessage(error instanceof Error ? error.message : String(error))); }
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
    pre: PreviewPre,
    code: PreviewCode,
  };

  return (
    <PreviewContext.Provider value={context}><article className="markdown-body">
      <>{linkError && <div className="preview-link-error" role="alert">{uiMessage(linkError)}</div>}<ReactMarkdown remarkPlugins={[remarkGfm, relativeFileLinks, previewLineBreaks]} rehypePlugins={[rehypeRaw, previewHtmlSanitize, previewHeadingIds]} components={components}>{markdown}</ReactMarkdown></>
    </article></PreviewContext.Provider>
  );
}

export default memo(MarkdownPreview);
