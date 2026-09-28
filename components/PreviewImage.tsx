import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { isRelativeImageSource } from '@/lib/preview-images';

type Props = { src?: string; alt?: string; title?: string; documentPath?: string | null };

export default function PreviewImage({ src = '', alt, title, documentPath }: Props) {
  const relative = isRelativeImageSource(src);
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const key = JSON.stringify([documentPath, src]);
  const desktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  useEffect(() => {
    if (!relative || !documentPath || !desktop) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<{ bytes: number[]; mime: string }>('read_local_image', { documentPath, source: src });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: result.mime }));
        setLoaded({ key, url: objectUrl });
      } catch {
        if (!cancelled) setFailed(key);
      }
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [desktop, documentPath, key, relative, src]);

  const needsPath = relative && (!documentPath || !desktop);
  if (needsPath || failed === key) {
    return <span className="preview-image-error" role="status" title={src}>{alt && `${alt} — `}{needsPath ? t('请在桌面端打开或保存 Markdown 文件以加载相对路径图片') : t('图片加载失败，请检查路径和文件是否存在')}</span>;
  }
  const url = relative ? (loaded?.key === key ? loaded.url : undefined) : src;
  if (!url) return <span role="status">{t('正在加载图片…')}</span>;
  return <img src={url} alt={alt ?? ''} title={title} onError={() => setFailed(key)} />;
}
