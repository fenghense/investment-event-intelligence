'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

const NAV_ITEMS = [
  { href: '/', label: '搜索' },
  { href: '/events', label: '事件监控' },
  { href: '/live', label: '实时消息', live: true },
  { href: '/notifications', label: '通知中心' },
];

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [q, setQ] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/api/notifications', { cache: 'no-store' });
        const data = (await res.json()) as { unread: number };
        if (!cancelled) setUnread(data.unread);
      } catch {
        /* 角标失败不阻断 */
      }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pathname]);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const kw = q.trim();
    if (kw) router.push(`/search?q=${encodeURIComponent(kw)}`);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-[#e5e7eb] bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#d93025] text-[13px] font-bold text-white">
            证
          </span>
          <span className="text-[15px] font-bold tracking-wide text-[#1f2329]">
            证迹<span className="mono ml-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#9ca3af]">TraceMark</span>
          </span>
        </Link>

        <nav className="flex h-full items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = item.href === '/' ? pathname === '/' || pathname === '/search' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex h-14 items-center px-3 text-[13.5px] transition-colors duration-150 ${
                  active ? 'font-semibold text-[#d93025]' : 'text-[#6b7280] hover:text-[#1f2329]'
                }`}
              >
                {item.label}
                {'live' in item && item.live && (
                  <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-[#d93025] animate-pulse" title="实时多源消息" />
                )}
                {item.href === '/notifications' && unread > 0 && (
                  <span className="mono ml-1 rounded-full bg-[#d93025] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                    {unread}
                  </span>
                )}
                {active && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[#d93025]" />}
              </Link>
            );
          })}
        </nav>

        {pathname !== '/' && (
          <form onSubmit={submit} className="ml-auto hidden w-64 items-center md:flex">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="输入标的代码 / 名称 / 关键词"
              className="h-8 w-full rounded-md border border-[#e5e7eb] bg-[#f5f6fa] px-3 text-[12.5px] text-[#1f2329] outline-none transition-colors placeholder:text-[#9ca3af] focus:border-[#d93025] focus:bg-white"
            />
          </form>
        )}
      </div>
    </header>
  );
}
