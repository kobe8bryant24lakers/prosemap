import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '墨流 · AI Markdown 与 Mermaid 编辑器',
  description: '支持实时预览、AI 差异审阅与 Mermaid 智能可视化的中文 Markdown 编辑器。',
  applicationName: '墨流 Markdown Studio',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/favicon.svg' },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
