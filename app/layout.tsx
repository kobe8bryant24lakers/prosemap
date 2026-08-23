import type { Metadata } from 'next';
import './globals.css';

const siteUrl = 'https://moliu-markdown-studio.ko8e24lakers.chatgpt.site';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: '墨流 · AI Markdown 与 Mermaid 编辑器',
  description: '支持实时预览、AI 差异审阅与 Mermaid 智能可视化的中文 Markdown 编辑器。',
  applicationName: '墨流 Markdown Studio',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/favicon.png', apple: '/icon-192.png' },
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    url: '/',
    siteName: '墨流 Markdown Studio',
    title: '墨流 · AI Markdown 与 Mermaid 编辑器',
    description: '写作、预览、AI 审阅与 Mermaid 智能绘图，在一个中文桌面工作区完成。',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: '墨流 AI Markdown 与 Mermaid 编辑器' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '墨流 · AI Markdown 与 Mermaid 编辑器',
    description: '写作、预览、AI 审阅与 Mermaid 智能绘图，在一个中文桌面工作区完成。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
