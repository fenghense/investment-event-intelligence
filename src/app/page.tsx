'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { EventCard, type EventCardData } from '@/components/app/event-card';

// 兜底标签：真实公司 + 代码（实时检索可命中巨潮/iFinD/媒体源）+ 演示事件主体
const FALLBACK_TAGS = ['宁德时代', '特斯拉', '300750', '华锐科技', '恒远能源'];

export default function HomePage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [events, setEvents] = useState<EventCardData[]>([]);
  const [hotTags, setHotTags] = useState<string[]>(FALLBACK_TAGS);
  const [stats, setStats] = useState<{ total: number; unread: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const res = await fetch('/api/events', { cache: 'no-store' });
        const data = (await res.json()) as {
          events: EventCardData[];
          stats: { total: number; unreadNotifications: number };
        };
        if (cancelled) return;
        setEvents(data.events);
        setStats({ total: data.stats.total, unread: data.stats.unreadNotifications });
        // 热门标签：实时取在监事件的具体公司/主体名（按更新时间排序，去重取前 5）
        const tags = [...new Set(data.events.map((e) => e.subject))].slice(0, 5);
        if (tags.length > 0) setHotTags(tags);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const go = (kw: string): void => {
    const v = kw.trim();
    if (v) router.push(`/search?q=${encodeURIComponent(v)}`);
  };
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    go(q);
  };

  return (
    <div>
      {/* 搜索区：唯一视觉焦点 */}
      <div className="flex min-h-[calc(100vh-120px)] flex-col items-center justify-center pb-16">
        <div className="mb-8 text-center">
          <h1 className="text-[34px] font-bold leading-tight tracking-tight text-[#1f2329]">
            证迹 <span className="text-[#d93025]">TraceMark</span>
          </h1>
          <p className="mt-2 text-[14px] text-[#6b7280]">
            同一投资事件的识别、合并与版本演化 —— 看清来源、事实变化、证据冲突与可信状态
          </p>
        </div>

        <form onSubmit={submit} className="w-[60%] min-w-[320px] max-w-[760px]">
          <div className="flex items-center overflow-hidden rounded-lg border-2 border-[#d93025] bg-white shadow-[0_4px_16px_rgba(217,48,37,0.10)] transition-shadow focus-within:shadow-[0_6px_22px_rgba(217,48,37,0.16)]">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="输入标的代码 / 名称 / 事件关键词，如：华锐科技、688301、收购"
              className="h-14 flex-1 px-5 text-[17px] text-[#1f2329] outline-none placeholder:text-[#b3b7bf]"
            />
            <button
              type="submit"
              className="h-14 shrink-0 bg-[#d93025] px-8 text-[16px] font-semibold text-white transition-colors hover:bg-[#c2281e]"
            >
              搜索
            </button>
          </div>
        </form>

        {/* 热门标签：实时取自在监事件的具体公司名，点击即出结果 */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <span className="text-[12px] text-[#9ca3af]">热门：</span>
          {hotTags.map((tag) => (
            <button
              key={tag}
              onClick={() => go(tag)}
              className="rounded-full border border-[#e5e7eb] bg-white px-3.5 py-1.5 text-[13px] text-[#6b7280] transition-all duration-150 hover:border-[#d93025] hover:text-[#d93025]"
            >
              {tag}
            </button>
          ))}
        </div>

        {stats && (
          <div className="mono mt-12 flex items-center gap-8 text-[12px] text-[#9ca3af]">
            <span>
              在监事件 <b className="text-[15px] font-semibold text-[#1f2329]">{stats.total}</b>
            </span>
            <span className="h-3 w-px bg-[#e5e7eb]" />
            <span>
              未读通知 <b className="text-[15px] font-semibold text-[#d93025]">{stats.unread}</b>
            </span>
          </div>
        )}

        {/* 下滑提示 */}
        <a
          href="#hot"
          className="mt-14 flex flex-col items-center gap-1 text-[#9ca3af] transition-colors hover:text-[#d93025]"
        >
          <span className="text-[12px]">下滑查看热点事件</span>
          <ChevronDown size={18} className="animate-bounce" />
        </a>
      </div>

      {/* 热点事件卡片区（与事件监控同数据源，按更新时间排序） */}
      <section id="hot" className="scroll-mt-20 pb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[18px] font-bold text-[#1f2329]">
            <span className="h-4 w-1 rounded-full bg-[#d93025]" />
            热点事件
          </h2>
          <Link href="/events" className="text-[13px] text-[#d93025] hover:underline">
            进入事件监控 →
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="paper-card animate-pulse p-4">
                <div className="flex items-center gap-2">
                  <div className="h-5 w-16 rounded-full bg-[#eceef3]" />
                  <div className="h-5 w-2/5 rounded bg-[#eceef3]" />
                </div>
                <div className="mt-2.5 h-4 w-3/4 rounded bg-[#eceef3]" />
                <div className="mt-2 h-3 w-1/2 rounded bg-[#eceef3]" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
