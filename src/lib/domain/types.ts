// ============================================================
// 投资事件情报平台 - 核心领域类型
// ============================================================

/** 动作类型（受控词表） */
export type ActionType =
  | 'ACQUISITION' // 收购
  | 'SUBSCRIBE' // 认购
  | 'TRANSFER' // 转让
  | 'INCREASE' // 增持
  | 'REDUCE' // 减持
  | 'PLEDGE' // 质押
  | 'DENY' // 否认
  | 'TERMINATE' // 终止/届满
  | 'COOPERATE' // 签署合作/战略合作
  | 'OTHER'; // 其他

/** 事件状态机状态 */
export type EventStatus =
  | 'published' // 初始发布
  | 'updated' // 更新补充
  | 'corrected' // 更正
  | 'denied' // 否认
  | 'expired' // 过期
  | 'revived'; // 否认后复活（保留曾有否认记录标记）

/** 证据类型：事实/观点/推测/传闻 */
export type EvidenceType = 'fact' | 'opinion' | 'speculation' | 'rumor';

/** 来源类型（权重基础分依据，按可信度降序） */
export type SourceType =
  | 'announcement' // 公司公告
  | 'exchange' // 交易所披露
  | 'media' // 财经媒体
  | 'research' // 研报
  | 'official_social' // 官方社媒
  | 'social' // 社交媒体/论坛
  | 'personal'; // 个人传闻

/** 要素抽取结果 */
export interface ExtractedElements {
  subject: string | null;
  subjectCode: string | null;
  action: ActionType;
  object: string | null;
  objectCode: string | null;
  /** yyyy-MM-dd，抽取自文本 */
  time: string | null;
  /** 抽取置信度 0-1 */
  confidence: number;
  extractor: 'rules' | 'llm';
}

/** 证据权重评分明细 */
export interface WeightBreakdown {
  sourceBase: number; // 来源类型基础分
  elementCompleteness: number; // 要素完整度
  corroboration: number; // 多源印证加分
  sourceHitRate: number; // 来源历史命中率加分
  officialConfirm: number; // 官方确认加分
  interestPenalty: number; // 利益相关性罚分（负值）
  total: number; // 0-100
}

/** 证据 */
export interface Evidence {
  id: string;
  eventId: string;
  /** 数据源侧原始 ID（可追溯） */
  externalId: string;
  sourceType: SourceType;
  sourceName: string;
  title: string;
  content: string;
  /** 出处 URL（可追溯） */
  url?: string;
  /** 公告编号（可追溯） */
  announcementNo?: string;
  evidenceType: EvidenceType;
  extracted: ExtractedElements;
  weight: WeightBreakdown;
  /** 披露时间：来源公布时间 */
  disclosedAt: string;
  /** 抓取时间：系统采集时间 */
  fetchedAt: string;
  /** 事件发生时间：从正文抽取（抽取自文本，非结构化字段） */
  eventOccurredAt: string | null;
  /** 更新时间：合并进事件/事件合并新证据时刷新，保留上一版本于 versions */
  updatedAt: string;
  /** 所属事件版本号 */
  version: number;
  officialConfirm: boolean;
  interestRelated: boolean;
  /** 合并时事件内独立来源数（多源印证计数） */
  corroborationCount: number;
  /** 来源历史命中率 0-1 */
  sourceHitRate: number;
  /** 原始字段值（来自数据源的原始记录，可追溯） */
  rawFields: Record<string, string>;
}

/** 事件版本快照 */
export interface EventVersion {
  version: number;
  status: EventStatus;
  summary: string;
  changedAt: string;
  reason: string;
  /** 更正/否认/复活时的显式差异标注 */
  diffNote?: string;
  triggerEvidenceId?: string;
  /** 该版本时的证据 id 快照（用于逐版本回看） */
  evidenceSnapshot: string[];
}

/** 状态变更记录 */
export interface StatusChange {
  from: EventStatus;
  to: EventStatus;
  at: string;
  reason: string;
  diffNote?: string;
  notificationId: string;
}

/** 关联标的 */
export interface RelatedTarget {
  code: string;
  name: string;
  role: 'subject' | 'object' | 'mentioned';
}

/** 可信度等级 */
export type Credibility = 'high' | 'medium' | 'low';

/** 投资事件（同一事件合并后的载体） */
export interface InvestmentEvent {
  id: string;
  dedupKey: string;
  title: string;
  subject: string;
  subjectCode: string | null;
  action: ActionType;
  object: string;
  objectCode: string | null;
  eventTime: string | null;
  status: EventStatus;
  /** 曾有否认记录标记（复活后保留） */
  hasDenialRecord: boolean;
  /** 曾被否认的时间与来源（复活后展示） */
  denialRecord?: { at: string; sourceName: string; note: string };
  credibilityScore: number;
  credibility: Credibility;
  /** 最新状态摘要 */
  summary: string;
  targets: RelatedTarget[];
  evidenceIds: string[];
  versions: EventVersion[];
  statusHistory: StatusChange[];
  createdAt: string;
  updatedAt: string;
  /** 是否已收藏（运行时由 store 附加；收藏后事件的状态变更通知才会推送至通知中心） */
  favorited?: boolean;
}

/** 通知类型：事实更新 / 事实撤销（更正、否认、复活） / 状态信息（过期等） */
export type NotificationKind = 'fact_update' | 'fact_revocation' | 'status_info';

export interface AppNotification {
  id: string;
  eventId: string;
  eventTitle: string;
  kind: NotificationKind;
  fromStatus: EventStatus;
  toStatus: EventStatus;
  title: string;
  body: string;
  /** 显式差异标注，如“此前说X有误，正确的是Y”，禁止无声修改 */
  diffNote?: string;
  createdAt: string;
  read: boolean;
}

/** 标的（公司） */
export interface Target {
  code: string;
  name: string;
  market: string;
  industry: string;
  aliases?: string[];
}

/** 数据源原始条目（source adapter 输出） */
export interface RawSourceItem {
  externalId: string;
  sourceType: SourceType;
  sourceName: string;
  title: string;
  content: string;
  url?: string;
  announcementNo?: string;
  disclosedAt: string;
  fetchedAt: string;
  meta: {
    /** 公告类型（如 更正公告/澄清公告/进展公告），来自数据源结构化字段 */
    bulletinType?: string;
    evidenceType?: EvidenceType;
    officialConfirm?: boolean;
    interestRelated?: boolean;
    /** 来源历史命中率（来源画像库） */
    sourceHitRate?: number;
  };
  /** 数据源原始 JSON 快照（真实接入时完整保留，可追溯） */
  rawSnapshot?: unknown;
  /** 数据源附带的结构化字段（如巨潮的 stockCodes/secName），供主链路标的建档 */
  rawFields?: Record<string, unknown>;
  /** 降级链标记：remote=实时源 / cache=缓存 / fallback=本地降级数据 */
  origin?: 'remote' | 'cache' | 'fallback';
}

/** 接入管线决策过程（前端演示用） */
export interface IngestDecision {
  dedupKey: string;
  matchType: 'exact' | 'fuzzy' | 'deny_ref' | 'reactivate' | 'new';
  matchedEventId?: string;
  similarity?: number;
  transition?: {
    from: EventStatus;
    to: EventStatus;
    legal: boolean;
    reason: string;
    blockedReason?: string;
  };
  revivalCheck?: {
    passed: boolean;
    via: 'official_confirm' | 'multi_source' | null;
    detail: string;
  };
  notificationId?: string;
}

export interface IngestResult {
  evidence: Evidence;
  event: InvestmentEvent;
  extraction: ExtractedElements & { evidenceType: EvidenceType; reasoning?: string };
  decision: IngestDecision;
  warnings: string[];
}

/** 事件详情时间线条目 */
export type TimelineEntry =
  | { kind: 'created'; at: string; detail: string }
  | { kind: 'evidence'; at: string; evidence: Evidence }
  | {
      kind: 'status';
      at: string;
      fromStatus: EventStatus;
      toStatus: EventStatus;
      version: EventVersion;
    };

/** 事件详情 API 返回结构 */
export interface EventDetailResponse {
  event: InvestmentEvent;
  evidence: Evidence[];
  notifications: AppNotification[];
  timeline: TimelineEntry[];
}
