import type { RawSourceItem } from '@/lib/domain/types';

// ============================================================
// 实时消息条目注册表（进程内短期保留）
// 多源实时汇聚（/api/live）拿到的真实条目在此登记，前端可凭
// externalId 把某一条真实消息接入 抽取→去重→状态机 主链路。
// 与种子数据完全隔离：这里只放实时源返回的条目。
// ============================================================

const TTL_MS = 30 * 60_000; // 30 分钟内可回看接入

interface Entry {
  item: RawSourceItem;
  /** 实时提供方：cninfo / ifind-news / ifind-trending */
  provider: string;
  at: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __liveItemRegistry: Map<string, Entry> | undefined;
}

function registry(): Map<string, Entry> {
  if (!globalThis.__liveItemRegistry) {
    globalThis.__liveItemRegistry = new Map<string, Entry>();
  }
  return globalThis.__liveItemRegistry;
}

export function registerLiveItem(item: RawSourceItem, provider: string): void {
  registry().set(item.externalId, { item, provider, at: Date.now() });
}

export function registerLiveItems(items: RawSourceItem[], provider: string): void {
  for (const item of items) registerLiveItem(item, provider);
}

export function getLiveItem(externalId: string): { item: RawSourceItem; provider: string } | null {
  const map = registry();
  const e = map.get(externalId);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) {
    map.delete(externalId);
    return null;
  }
  return { item: e.item, provider: e.provider };
}
