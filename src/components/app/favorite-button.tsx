'use client';

import { Star } from 'lucide-react';
import { useState, type MouseEvent } from 'react';

// 收藏星标：收藏后该事件的状态变更通知才会推送至通知中心
export function FavoriteButton({
  eventId,
  favorited,
  size = 'md',
  onChange,
}: {
  eventId: string;
  favorited: boolean;
  size?: 'sm' | 'md';
  onChange?: (next: boolean) => void;
}) {
  const [fav, setFav] = useState(favorited);
  const [pending, setPending] = useState(false);

  const toggle = async (e: MouseEvent): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch(`/api/events/${eventId}/favorite`, { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as { favorited: boolean };
        setFav(data.favorited);
        onChange?.(data.favorited);
      }
    } finally {
      setPending(false);
    }
  };

  const px = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  const icon = size === 'sm' ? 14 : 16;
  return (
    <button
      onClick={toggle}
      disabled={pending}
      title={fav ? '取消收藏（取消后不再推送该事件通知）' : '收藏该事件（收藏后状态变更将推送至通知中心）'}
      aria-label={fav ? '取消收藏' : '收藏事件'}
      className={`group/fav flex ${px} shrink-0 items-center justify-center rounded-full border transition-all duration-150 ${
        fav
          ? 'border-[#d93025]/30 bg-[#d93025]/10 hover:bg-[#d93025]/20'
          : 'border-[#e5e7eb] bg-white hover:border-[#d93025]/40 hover:bg-[#d93025]/5'
      } ${pending ? 'opacity-50' : ''}`}
    >
      <Star
        size={icon}
        className={`transition-colors ${fav ? 'fill-[#d93025] text-[#d93025]' : 'text-[#9ca3af] group-hover/fav:text-[#d93025]'}`}
      />
    </button>
  );
}
