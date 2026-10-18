import type {
  ActionType,
  Credibility,
  EventStatus,
  EvidenceType,
  NotificationKind,
  SourceType,
} from './types';

// ============================================================
// 受控词表与 UI 语义元数据（前后端共享，纯常量无副作用）
// ============================================================

export const ACTION_LABELS: Record<ActionType, string> = {
  ACQUISITION: '收购',
  SUBSCRIBE: '认购',
  TRANSFER: '转让',
  INCREASE: '增持',
  REDUCE: '减持',
  PLEDGE: '质押',
  DENY: '否认',
  TERMINATE: '终止',
  COOPERATE: '签署合作',
  OTHER: '其他',
};

/** 泛指对象短语（非真实实体）：标题拼接与去重合并时都应跳过 */
export const GENERIC_OBJECT_PHRASES: ReadonlySet<string> = new Set([
  '未指明',
  '本公司股份',
  '公司股份',
  '本公司',
  '标的资产',
  '相关资产',
  'A股',
  'A股股份',
  '合作方',
  '交易对方',
  '战略合作方',
  '相关方',
  '标的公司',
  '标的',
]);

/**
 * 事件标准标题：主体·[与对象]动作
 * 例：eventTitle('宁德时代','COOPERATE','赛力斯') → 宁德时代·与赛力斯签署合作
 *     eventTitle('宁德时代','INCREASE','本公司股份') → 宁德时代·增持
 */
export function eventTitle(subject: string, action: ActionType, object: string | null | undefined): string {
  const obj = object && !GENERIC_OBJECT_PHRASES.has(object.trim()) ? `与${object}` : '';
  // OTHER 无明确动作语义：不拼「其他」，退化为「主体·[与对象]动态」避免「与巧克力换电生态其他」类噪音标题
  if (action === 'OTHER') return `${subject}·${obj ? `${obj}相关动态` : '动态'}`;
  return `${subject}·${obj}${ACTION_LABELS[action]}`;
}

export const STATUS_LABELS: Record<EventStatus, string> = {
  published: '初发布',
  updated: '有更新',
  corrected: '已更正',
  denied: '已否认',
  expired: '已过期',
  revived: '反转',
};

/** 状态语义色（印章色，与 DESIGN.md 对齐） */
export const STATUS_COLORS: Record<EventStatus, { fg: string; bg: string; ring: string }> = {
  published: { fg: '#0DA678', bg: '#E7F6F0', ring: '#B7E4D4' },
  updated: { fg: '#0DA678', bg: '#E7F6F0', ring: '#B7E4D4' },
  corrected: { fg: '#D97706', bg: '#FEF3C7', ring: '#F2D8A7' },
  denied: { fg: '#991B1B', bg: '#FDEDEC', ring: '#F3B8B4' },
  expired: { fg: '#6B7280', bg: '#F3F4F6', ring: '#D1D5DB' },
  revived: { fg: '#EA580C', bg: '#FDEFE3', ring: '#F5CDA8' },
};

/** 状态分组（列表页筛选用：初发布绿/有更新红/更正黄/否认红/过期灰/反转橙） */
export const STATUS_GROUP_LABELS: Record<EventStatus, string> = {
  published: '初发布',
  updated: '有更新',
  corrected: '更正',
  denied: '否认',
  expired: '过期',
  revived: '反转',
};

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  fact: '事实',
  opinion: '观点',
  speculation: '推测',
  rumor: '传闻',
};

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  announcement: '公司公告',
  exchange: '交易所披露',
  media: '财经媒体',
  research: '研报',
  official_social: '官方社媒',
  social: '社交媒体/论坛',
  personal: '个人传闻',
};

export const CREDIBILITY_LABELS: Record<Credibility, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  fact_update: '事实更新',
  fact_revocation: '事实撤销',
  status_info: '状态信息',
};

export const TARGET_ROLE_LABELS: Record<'subject' | 'object' | 'mentioned', string> = {
  subject: '主体',
  object: '对象',
  mentioned: '提及',
};
