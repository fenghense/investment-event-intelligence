import type { Metadata } from 'next';
import './globals.css';
import { TopNav } from '@/components/app/top-nav';

export const metadata: Metadata = {
  title: {
    default: '证迹 TraceMark · 投资事件情报平台',
    template: '%s | 证迹 TraceMark',
  },
  description:
    '同一投资事件的识别、合并与版本演化：看清事件的初始来源、事实变化、证据冲突、当前可信状态，以及事件与关注标的的关系。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <TopNav />
        <main className="mx-auto min-h-[calc(100vh-56px)] max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
