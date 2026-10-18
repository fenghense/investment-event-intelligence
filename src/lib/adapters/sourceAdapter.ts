import type { RawSourceItem } from '@/lib/domain/types';

// ============================================================
// 数据源适配器接口（source adapter）
// 数据层抽象：真实接入 iFinD / 巨潮 / Tushare 等数据源时，
// 只需实现 SourceAdapter 并注册到 registry，管线无需改动。
// ============================================================

export interface SourceAdapter {
  /** 适配器标识名 */
  readonly name: string;
  /** 拉取最新原始条目（增量，since 为上次同步时间） */
  fetchLatest(since?: string): Promise<RawSourceItem[]>;
  /** 按标的代码拉取原始条目 */
  fetchByTarget(code: string): Promise<RawSourceItem[]>;
}

const adapters = new Map<string, SourceAdapter>();

export function registerAdapter(adapter: SourceAdapter): void {
  adapters.set(adapter.name, adapter);
}

export function getAdapter(name: string): SourceAdapter | undefined {
  return adapters.get(name);
}

export function listAdapters(): string[] {
  return [...adapters.keys()];
}

// ------------------------------------------------------------
// 真实数据源接入骨架（预留结构，未配置凭证时显式抛错，绝不伪造数据）
// ------------------------------------------------------------

export interface DataSourceCredentials {
  apiKey?: string;
  baseUrl?: string;
}

abstract class RemoteSourceAdapter implements SourceAdapter {
  abstract readonly name: string;
  constructor(protected readonly credentials: DataSourceCredentials) {}
  protected ensureConfigured(): void {
    if (!this.credentials.apiKey || !this.credentials.baseUrl) {
      throw new Error(`数据源 ${this.name} 未配置 apiKey/baseUrl，无法接入`);
    }
  }
  abstract fetchLatest(since?: string): Promise<RawSourceItem[]>;
  abstract fetchByTarget(code: string): Promise<RawSourceItem[]>;
}

/** 巨潮资讯（公告）适配器骨架 */
export class CninfoAdapter extends RemoteSourceAdapter {
  readonly name = 'cninfo';
  async fetchLatest(): Promise<RawSourceItem[]> {
    this.ensureConfigured();
    // 接入指引：POST {baseUrl}/new/fulltextSearch/full → 映射 announcementNo/url/disclosedAt
    throw new Error('CninfoAdapter 尚未实现：请按巨潮 OpenAPI 完成字段映射后启用');
  }
  async fetchByTarget(): Promise<RawSourceItem[]> {
    this.ensureConfigured();
    throw new Error('CninfoAdapter 尚未实现');
  }
}

/** iFinD（同花顺）适配器骨架 */
export class IFindAdapter extends RemoteSourceAdapter {
  readonly name = 'ifind';
  async fetchLatest(): Promise<RawSourceItem[]> {
    this.ensureConfigured();
    throw new Error('IFindAdapter 尚未实现');
  }
  async fetchByTarget(): Promise<RawSourceItem[]> {
    this.ensureConfigured();
    throw new Error('IFindAdapter 尚未实现');
  }
}

/** Tushare 适配器骨架 */
export class TushareAdapter extends RemoteSourceAdapter {
  readonly name = 'tushare';
  async fetchLatest(): Promise<RawSourceItem[]> {
    this.ensureConfigured();
    throw new Error('TushareAdapter 尚未实现');
  }
  async fetchByTarget(): Promise<RawSourceItem[]> {
    this.ensureConfigured();
    throw new Error('TushareAdapter 尚未实现');
  }
}
