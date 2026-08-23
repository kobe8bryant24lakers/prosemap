import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '墨流 Markdown Studio',
    short_name: '墨流',
    description: '支持 AI 差异审阅与 Mermaid 智能可视化的中文 Markdown 编辑器。',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f7f4',
    theme_color: '#125e45',
    lang: 'zh-CN',
    categories: ['productivity', 'utilities'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
