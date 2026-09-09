import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { highlightCode } from '@/lib/code-blocks';

export default function CodeBlock({ source, language }: { source: string; language: string }) {
  const [highlighted, setHighlighted] = useState<{ source: string; language: string; tokens: Awaited<ReturnType<typeof highlightCode>> } | null>(null);
  const [copyState, setCopyState] = useState('');
  useEffect(() => {
    let active = true;
    void highlightCode(source, language).then((tokens) => {
      if (active) setHighlighted({ source, language, tokens });
    }).catch(() => { /* Unknown or unavailable grammars remain readable plain text. */ });
    return () => { active = false; };
  }, [source, language]);
  useEffect(() => {
    if (!copyState) return;
    const timer = window.setTimeout(() => setCopyState(''), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);
  const tokens = highlighted?.source === source && highlighted.language === language ? highlighted.tokens : null;
  return <div className="preview-code-block">
    <div className="code-block-header"><span>{language || 'text'}</span><button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(source); setCopyState('已复制'); }
      catch { setCopyState('复制失败'); }
    }}>{copyState === '已复制' ? <Check size={13} /> : <Copy size={13} />} {copyState || '复制代码'}</button></div>
    <pre><code className={`language-${language}`}>{tokens ? tokens.map((token, index) => <span key={index} className={token.className || undefined}>{token.text}</span>) : source}</code></pre>
  </div>;
}
