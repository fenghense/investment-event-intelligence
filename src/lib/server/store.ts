import type {
  AppNotification,
  Evidence,
  EventStatus,
  EventVersion,
  EvidenceType,
  ExtractedElements,
  IngestDecision,
  IngestResult,
  InvestmentEvent,
  NotificationKind,
  RawSourceItem,
  RelatedTarget,
  SourceType,
  StatusChange,
  Target,
} from '@/lib/domain/types';
import { eventTitle } from '@/lib/domain/vocabulary';
import {
  entitiesFromTargets,
  extractByRules,
  inferEvidenceType,
  LlmExtractor,
  type EntityInfo,
  type LlmExtraction,
} from '@/lib/domain/extract';
import { buildDedupKey, findMatchingEvent, normalizeName, normalizeObjectName } from '@/lib/domain/dedup';
import { computeEventCredibility, scoreEvidence } from '@/lib/domain/scoring';
import { checkRevivalThreshold, checkTransition } from '@/lib/domain/stateMachine';
import { registerAdapter, type SourceAdapter } from '@/lib/adapters/sourceAdapter';
import { SEED_RAW_ITEMS, SEED_TARGETS } from './seed';

// ============================================================
// 事件存储 + 接入管线（单例，内存实现）
// 管线：要素抽取 → dedup 合并 → 权重评分 → 状态机演化 → 通知
// ============================================================

class MockSourceAdapter implements SourceAdapter {
  readonly name = 'mock';
  async fetchLatest(): Promise<RawSourceItem[]> {
    return SEED_RAW_ITEMS;
  }
  async fetchByTarget(code: string): Promise<RawSourceItem[]> {
    const target = SEED_TARGETS.find((t) => t.code === code);
    if (!target) return [];
    const names = [target.name, ...(target.aliases ?? [])];
    return SEED_RAW_ITEMS.filter((r) => names.some((n) => `${r.title}${r.content}`.includes(n)));
  }
}

export interface IngestOptions {
  extractorMode?: 'rules' | 'llm';
  forwardHeaders?: Record<string, string>;
  /** 实时检索接入：必须能识别事件主体，否则抛错跳过（防止「未知主体」垃圾事件） */
  requireSubject?: boolean;
}

interface TransitionPlan {
  to: EventStatus;
  reason: string;
  diffNote?: string;
}

class EventStore {
  private events = new Map<string, InvestmentEvent>();
  private evidenceMap = new Map<string, Evidence>();
  private notifications = new Map<string, AppNotification>();
  private targets = new Map<string, Target>();
  private favorites = new Set<string>();
  private counters = { event: 0, evidence: 0, notification: 0 };
  private seeded = false;
  private entities: EntityInfo[] = [];

  // ----------------------------------------------------------
  // 初始化 / 种子数据
  // ----------------------------------------------------------
  async seed(): Promise<void> {
    if (this.seeded) return;
    this.seeded = true;
    registerAdapter(new MockSourceAdapter());
    for (const t of SEED_TARGETS) this.targets.set(t.code, t);
    this.entities = entitiesFromTargets(SEED_TARGETS);
    // 通过真实管线路径灌入样例数据，保证合并/状态机/通知逻辑一致
    for (const raw of SEED_RAW_ITEMS) {
      await this.ingest(raw, { extractorMode: 'rules' });
    }
  }

  private nextId(kind: keyof EventStore['counters']): string {
    this.counters[kind] += 1;
    const prefix = kind === 'event' ? 'EVT' : kind === 'evidence' ? 'EVD' : 'NTF';
    return `${prefix}-${String(this.counters[kind]).padStart(4, '0')}`;
  }

  // ----------------------------------------------------------
  // 接入管线主入口
  // ----------------------------------------------------------
  async ingest(raw: RawSourceItem, opts?: IngestOptions): Promise<IngestResult> {
    const warnings: string[] = [];
    const fullText = `${raw.title}\n${raw.content}`;

    // 1) 要素抽取（默认规则；llm 模式失败时显式降级并标注）
    let extracted: LlmExtraction;
    if (opts?.extractorMode === 'llm') {
      try {
        extracted = await new LlmExtractor(opts.forwardHeaders).extract(fullText, this.entities);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`LLM 语义抽取失败，已降级为规则抽取：${msg}`);
        extracted = extractByRules(fullText, this.entities);
      }
    } else {
      extracted = extractByRules(fullText, this.entities);
    }

    // 1.5) 真实来源（巨潮/媒体/iFinD）附带的证券代码注入 + 未知标的自动建档
    // rawFields.stockCodes/secName 由实时适配器写入：抽取主体与该证券简称匹配时补齐代码，
    // 使「宁德时代」这类库外真实公司也能获得代码并进入标的维度。
    const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '').trim();
    const stockCodes = ((raw.rawFields?.stockCodes as string[] | undefined) ?? []).map(stripHtml);
    const secNameRaw =
      (raw.rawFields?.secName as string | undefined) ?? (raw.rawFields?.companyName as string | undefined);
    const secName = secNameRaw ? stripHtml(secNameRaw) : undefined;
    const norm = (s: string) => normalizeName(s);
    if (extracted.subject && !extracted.subjectCode && stockCodes.length > 0 && secName) {
      const a = norm(extracted.subject);
      const b = norm(secName);
      if (a === b || a.includes(b) || b.includes(a)) {
        extracted.subjectCode = stockCodes[0];
        extracted.subject = extracted.subject.length <= secName.length + 2 ? secName : extracted.subject;
      }
    }
    if (!extracted.subject && secName) {
      extracted.subject = secName;
      extracted.subjectCode = extracted.subjectCode ?? stockCodes[0] ?? null;
    }
    // 实时检索路径要求可归属主体：散文式资讯无法识别主体时拒绝接入，
    // 避免产生「未知主体」垃圾事件污染事件库（演示/种子路径不受影响）。
    if (opts?.requireSubject && !extracted.subject) {
      throw new Error('无法识别事件主体，已跳过接入');
    }
    this.ensureTarget(extracted.subjectCode, extracted.subject);
    this.ensureTarget(extracted.objectCode, extracted.object);

    // 2) 证据类型判定（来源方标注 > LLM 判断 > 规则推断）
    const evidenceType: EvidenceType =
      raw.meta.evidenceType ?? extracted.evidenceType ?? inferEvidenceType(fullText, raw.sourceType);

    // 3) dedup 合并
    const dedupKey = buildDedupKey({
      subject: extracted.subject,
      subjectCode: extracted.subjectCode,
      action: extracted.action,
      object: extracted.object,
      objectCode: extracted.objectCode,
      time: extracted.time,
    });
    const match = findMatchingEvent([...this.events.values()], extracted, dedupKey, fullText);

    const decision: IngestDecision = {
      dedupKey,
      matchType: match.matchType,
      matchedEventId: match.event?.id,
      similarity: match.similarity,
    };

    let event: InvestmentEvent;

    if (!match.event) {
      // 4a) 新事件
      event = this.createEvent(extracted, dedupKey, raw);
    } else {
      event = match.event;
      // 事件时间窗口未知时，用新证据的发生时间补齐并刷新 dedup_key
      if (!event.eventTime && extracted.time) {
        event.eventTime = extracted.time;
        event.dedupKey = buildDedupKey({
          subject: event.subject,
          subjectCode: event.subjectCode,
          action: event.action,
          object: event.object,
          objectCode: event.objectCode,
          time: extracted.time,
        });
      }
    }

    // 版本号：v0 为收录占位，首个证据版本为 v1，之后每次合并 +1
    const version = event.versions.length;

    // 4) 权重评分（多源印证数以事件内独立来源数计）
    const existingEvidence = this.evidenceOf(event.id);
    const sourceNames = new Set(existingEvidence.map((e) => e.sourceName));
    sourceNames.add(raw.sourceName);
    const weight = scoreEvidence({
      sourceType: raw.sourceType,
      extracted,
      corroborationCount: sourceNames.size,
      sourceHitRate: raw.meta.sourceHitRate ?? 0.5,
      officialConfirm: raw.meta.officialConfirm ?? false,
      interestRelated: raw.meta.interestRelated ?? false,
    });

    const evidence: Evidence = {
      id: this.nextId('evidence'),
      eventId: event.id,
      externalId: raw.externalId,
      sourceType: raw.sourceType,
      sourceName: raw.sourceName,
      title: raw.title,
      content: raw.content,
      url: raw.url,
      announcementNo: raw.announcementNo,
      evidenceType,
      extracted,
      weight,
      disclosedAt: raw.disclosedAt,
      fetchedAt: raw.fetchedAt,
      eventOccurredAt: extracted.time,
      updatedAt: raw.fetchedAt,
      version,
      officialConfirm: raw.meta.officialConfirm ?? false,
      interestRelated: raw.meta.interestRelated ?? false,
      corroborationCount: sourceNames.size,
      sourceHitRate: raw.meta.sourceHitRate ?? 0.5,
      rawFields: {
        externalId: raw.externalId,
        sourceType: raw.sourceType,
        sourceName: raw.sourceName,
        bulletinType: raw.meta.bulletinType ?? '',
        disclosedAt: raw.disclosedAt,
        fetchedAt: raw.fetchedAt,
        url: raw.url ?? '',
        announcementNo: raw.announcementNo ?? '',
        origin: raw.origin ?? 'remote',
        ...(raw.rawSnapshot !== undefined ? { rawSnapshot: JSON.stringify(raw.rawSnapshot) } : {}),
      },
    };

    this.evidenceMap.set(evidence.id, evidence);
    event.evidenceIds.push(evidence.id);

    // 5) 状态机演化
    const plan = this.planTransition(event, match.matchType, raw, extracted, evidence, decision);

    let diffNote: string | undefined;
    let transitionReason = '新增证据合并（状态不变）';
    if (plan) {
      const check = checkTransition(event.status, plan.to);
      decision.transition = { from: event.status, to: plan.to, legal: check.legal, reason: plan.reason, blockedReason: check.blockedReason };
      if (check.legal) {
        const from = event.status;
        event.status = plan.to;
        transitionReason = plan.reason;
        diffNote = plan.diffNote;
        if (plan.to === 'denied') {
          event.hasDenialRecord = true;
          event.denialRecord = { at: raw.disclosedAt, sourceName: raw.sourceName, note: raw.title };
        }
        const change: StatusChange = {
          from,
          to: plan.to,
          at: raw.disclosedAt,
          reason: plan.reason,
          diffNote,
          notificationId: '',
        };
        const notification = this.createNotification(event, change, raw.fetchedAt);
        change.notificationId = notification.id;
        event.statusHistory.push(change);
        decision.notificationId = notification.id;
      } else {
        // 非法转换被阻止：证据归档但状态不变
        warnings.push(`状态转换被阻止：${check.blockedReason ?? ''}。证据已归档至事件 ${event.id}，状态保持 ${event.status}`);
        transitionReason = `状态转换被阻止（${check.blockedReason}），仅归档证据`;
      }
    }

    // 6) 版本快照 + 事件字段刷新
    const versionSnap: EventVersion = {
      version,
      status: event.status,
      summary: raw.title,
      changedAt: raw.disclosedAt,
      reason: transitionReason,
      diffNote,
      triggerEvidenceId: evidence.id,
      evidenceSnapshot: [...event.evidenceIds],
    };
    event.versions.push(versionSnap);
    event.summary = raw.title;
    // 要素补全：原事件对象缺失/泛指、新证据带来明确对象 → 补齐并刷新标题。
    // 典型：公告「宁德时代：关于签署战略合作协议的公告」先建档（无对象），
    // 新闻「宁德时代与赛力斯签署长期战略合作协议」后并入，对象补为「赛力斯」。
    if (
      (!event.object || event.object === '未指明') &&
      extracted.object &&
      normalizeObjectName(extracted.object) !== 'SELF' &&
      normalizeObjectName(extracted.object) !== 'unknown' &&
      !EventStore.GENERIC_OBJECT_NAMES.has(extracted.object.trim().toLowerCase()) &&
      !EventStore.GENERIC_OBJECT_NAMES.has(normalizeName(extracted.object).toLowerCase())
    ) {
      event.object = extracted.object;
      event.objectCode = extracted.objectCode ?? event.objectCode;
      event.title = eventTitle(event.subject, event.action, extracted.object);
    }
    event.targets = this.deriveTargets(event, fullText);
    event.updatedAt = raw.disclosedAt;

    // 多源印证数变化后，重算事件内既有证据印证分与事件可信度
    this.refreshCorroboration(event);
    const cred = computeEventCredibility(event.status, this.evidenceOf(event.id));
    event.credibilityScore = cred.score;
    event.credibility = cred.level;

    // 既有证据 updated_at 刷新（上一版本保留在 versions 快照中）
    for (const id of event.evidenceIds) {
      const e = this.evidenceMap.get(id);
      if (e) e.updatedAt = raw.fetchedAt;
    }

    return {
      evidence,
      event,
      extraction: { ...extracted, evidenceType, reasoning: extracted.reasoning },
      decision,
      warnings,
    };
  }

  // ----------------------------------------------------------
  // 状态转换决策
  // ----------------------------------------------------------
  private planTransition(
    event: InvestmentEvent,
    matchType: IngestDecision['matchType'],
    raw: RawSourceItem,
    extracted: ExtractedElements,
    evidence: Evidence,
    decision: IngestDecision,
  ): TransitionPlan | null {
    const bulletin = raw.meta.bulletinType ?? '';

    // denied 事件收到同事件新证据：进入复活门槛校验
    if (event.status === 'denied' && matchType !== 'deny_ref') {
      const check = checkRevivalThreshold(evidence, this.evidenceOf(event.id).filter((e) => e.id !== evidence.id));
      decision.revivalCheck = { passed: check.passed, via: check.via, detail: check.detail };
      if (check.passed) {
        const denial = event.denialRecord;
        return {
          to: 'revived',
          reason: check.detail,
          diffNote: `该事件曾于 ${denial?.at.slice(0, 10) ?? '此前'} 被${denial?.sourceName ?? '公司'}否认（${denial?.note ?? '澄清公告'}）。${check.detail}，事件反转；此前否认记录永久保留，请结合双方证据独立判断`,
        };
      }
      // 未达门槛：状态不变，但生成提示通知（禁止无声归档）
      const notification = this.createPlainNotification(
        event,
        'status_info',
        `反转门槛未达：${event.title}`,
        check.detail,
        raw.fetchedAt,
      );
      decision.notificationId = notification.id;
      return null;
    }

    if (/更正/.test(bulletin)) {
      return {
        to: 'corrected',
        reason: `${raw.sourceName}发布更正公告（${raw.announcementNo ?? raw.title}）`,
        diffNote: buildCorrectionDiff(raw.content),
      };
    }
    if (extracted.action === 'DENY' || /澄清/.test(bulletin)) {
      return {
        to: 'denied',
        reason: `${raw.sourceName}发布澄清/否认公告（${raw.announcementNo ?? raw.title}）`,
        diffNote: `此前市场传闻及媒体报道称「${event.title}」，现经${raw.sourceName}澄清：不存在相关事宜、相关报道不属实，事件转为“已否认”。若后续出现官方再次确认或 ≥3 个独立高质量来源印证，事件可反转`,
      };
    }
    if (extracted.action === 'TERMINATE' || /(结果|届满|到期)/.test(bulletin)) {
      return { to: 'expired', reason: `${raw.sourceName}披露计划届满/实施结果，事件过期` };
    }
    if (matchType === 'reactivate') {
      return {
        to: 'updated',
        reason: `事件过期后出现新进展（${raw.sourceName}：${raw.title}），重新激活并关联原事件`,
      };
    }
    if (event.status === 'revived' && (raw.sourceType === 'announcement' || raw.sourceType === 'exchange')) {
      return { to: 'updated', reason: `反转后获官方文件进一步确认（${raw.sourceName}）` };
    }
    if (/(进展|补充)/.test(bulletin)) {
      return { to: 'updated', reason: `${raw.sourceName}发布${raw.meta.bulletinType}（${raw.announcementNo ?? raw.title}）` };
    }
    return null;
  }

  // ----------------------------------------------------------
  // 事件 / 通知构造
  // ----------------------------------------------------------
  private createEvent(extracted: ExtractedElements, dedupKey: string, raw: RawSourceItem): InvestmentEvent {
    const id = this.nextId('event');
    const title = eventTitle(extracted.subject ?? '未知主体', extracted.action, extracted.object);
    const event: InvestmentEvent = {
      id,
      dedupKey,
      title,
      subject: extracted.subject ?? '未知主体',
      subjectCode: extracted.subjectCode,
      action: extracted.action,
      // 泛指对象（合作方/交易对方等）不落入事件要素，保持「未指明」等待后续证据补全
      object:
        extracted.object && normalizeObjectName(extracted.object) !== 'unknown'
          ? extracted.object
          : '未指明',
      objectCode: extracted.objectCode,
      eventTime: extracted.time,
      status: 'published',
      hasDenialRecord: false,
      credibilityScore: 0,
      credibility: 'low',
      summary: raw.title,
      targets: [],
      evidenceIds: [],
      versions: [
        {
          version: 0,
          status: 'published',
          summary: raw.title,
          changedAt: raw.disclosedAt,
          reason: '事件首次收录（初始发布）',
          evidenceSnapshot: [],
        },
      ],
      statusHistory: [],
      createdAt: raw.disclosedAt,
      updatedAt: raw.disclosedAt,
    };
    event.targets = this.deriveTargets(event, `${raw.title}\n${raw.content}`);
    this.events.set(id, event);
    return event;
  }

  private createNotification(event: InvestmentEvent, change: StatusChange, at: string): AppNotification {
    const kindMap: Record<EventStatus, NotificationKind> = {
      published: 'status_info',
      updated: 'fact_update',
      corrected: 'fact_revocation',
      denied: 'fact_revocation',
      expired: 'status_info',
      revived: 'fact_revocation',
    };
    const titleMap: Record<EventStatus, string> = {
      published: `新事件收录：${event.title}`,
      updated: `事实更新：${event.title}`,
      corrected: `事实更正：${event.title}`,
      denied: `事实否认：${event.title}`,
      expired: `事件过期：${event.title}`,
      revived: `否认后反转：${event.title}`,
    };
    const notification: AppNotification = {
      id: this.nextId('notification'),
      eventId: event.id,
      eventTitle: event.title,
      kind: kindMap[change.to],
      fromStatus: change.from,
      toStatus: change.to,
      title: titleMap[change.to],
      body: change.reason,
      diffNote: change.diffNote,
      createdAt: at,
      read: false,
    };
    this.notifications.set(notification.id, notification);
    return notification;
  }

  private createPlainNotification(
    event: InvestmentEvent,
    kind: NotificationKind,
    title: string,
    body: string,
    at: string,
  ): AppNotification {
    const notification: AppNotification = {
      id: this.nextId('notification'),
      eventId: event.id,
      eventTitle: event.title,
      kind,
      fromStatus: event.status,
      toStatus: event.status,
      title,
      body,
      createdAt: at,
      read: false,
    };
    this.notifications.set(notification.id, notification);
    return notification;
  }

  /** 泛指短语黑名单：公告常用语（本公司股份/A股 等）不是真实标的，禁止建档 */
  private static readonly GENERIC_OBJECT_NAMES = new Set([
    '本公司', '本公司股份', '公司股份', '公司', '未指明', '未知', '未知主体', '标的',
    '标的公司', '上述公司', '相关公司', 'a股', 'h股', '本股份', '股份', 'a股股份',
    '合作方', '交易对方', '战略合作方', '相关方',
  ]);

  /** 未知真实标的自动建档：有代码用代码作主键，无代码用 NAME-<规范名> 兜底主键 */
  private ensureTarget(code: string | null, name: string | null): void {
    if (!code && !name) return;
    // 仅拦截无代码兜底建档；带证券代码的必然来自真实源结构化字段
    if (!code && name && EventStore.GENERIC_OBJECT_NAMES.has(name.trim().toLowerCase())) return;
    if (!code && name && EventStore.GENERIC_OBJECT_NAMES.has(normalizeName(name).toLowerCase())) return;
    const key = code ?? `NAME-${normalizeName(name!)}`;
    if (this.targets.has(key)) return;
    const display = name ?? code!;
    this.targets.set(key, { code: key, name: display, market: '实时建档', industry: '待识别' });
    this.entities.push({ code: key, name: display, aliases: [] });
  }

  private deriveTargets(event: InvestmentEvent, text: string): RelatedTarget[] {
    const map = new Map<string, RelatedTarget>();
    const put = (code: string | null, name: string | null, role: RelatedTarget['role']): void => {
      if (!code && !name) return;
      const key = code ?? `NAME-${normalizeName(name!)}`;
      if (map.has(key)) return;
      const t = this.targets.get(key);
      map.set(key, { code: key, name: t?.name ?? name ?? key, role });
    };
    put(event.subjectCode, event.subject, 'subject');
    put(event.objectCode, event.object, 'object');
    for (const t of this.targets.values()) {
      if (map.has(t.code)) continue;
      const names = [t.name, ...(t.aliases ?? [])];
      if (names.some((n) => text.includes(n) || normalizeName(event.title).includes(normalizeName(n)))) {
        map.set(t.code, { code: t.code, name: t.name, role: 'mentioned' });
      }
    }
    return [...map.values()];
  }

  private refreshCorroboration(event: InvestmentEvent): void {
    const list = this.evidenceOf(event.id);
    const count = new Set(list.map((e) => e.sourceName)).size;
    for (const e of list) {
      e.corroborationCount = count;
      const next = scoreEvidence({
        sourceType: e.sourceType,
        extracted: e.extracted,
        corroborationCount: count,
        sourceHitRate: e.sourceHitRate,
        officialConfirm: e.officialConfirm,
        interestRelated: e.interestRelated,
      });
      e.weight = next;
    }
  }

  // ----------------------------------------------------------
  // 查询
  // ----------------------------------------------------------
  evidenceOf(eventId: string): Evidence[] {
    const event = this.events.get(eventId);
    if (!event) return [];
    return event.evidenceIds
      .map((id) => this.evidenceMap.get(id))
      .filter((e): e is Evidence => Boolean(e))
      .sort((a, b) => a.disclosedAt.localeCompare(b.disclosedAt));
  }

  listEvents(filter?: { status?: EventStatus; target?: string; q?: string }): InvestmentEvent[] {
    let list = [...this.events.values()];
    if (filter?.status) list = list.filter((e) => e.status === filter.status);
    if (filter?.target) list = list.filter((e) => e.targets.some((t) => t.code === filter.target));
    if (filter?.q) {
      const q = filter.q;
      list = list.filter((e) => e.title.includes(q) || e.summary.includes(q));
    }
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getEvent(id: string): InvestmentEvent | undefined {
    return this.events.get(id);
  }

  notificationsOf(eventId: string): AppNotification[] {
    return [...this.notifications.values()]
      .filter((n) => n.eventId === eventId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listNotifications(): AppNotification[] {
    return [...this.notifications.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ----------------------------------------------------------
  // 收藏（只有已收藏的事件才会在通知中心推送状态变更通知）
  // ----------------------------------------------------------
  /** 事件证据来源名（去重，供搜索结果卡片展示来源徽标） */
  sourceNamesOf(eventId: string): string[] {
    return [...new Set(this.evidenceOf(eventId).map((e) => e.sourceName))];
  }

  /** 主体识别候选名单（实时消息按公司归组用）：已建档标的 + 抽取实体库，含别名 */
  subjectCandidates(): Array<{ code: string | null; name: string; aliases: string[] }> {
    const out = new Map<string, { code: string | null; name: string; aliases: string[] }>();
    for (const t of this.targets.values()) {
      out.set(t.name, { code: t.code ?? null, name: t.name, aliases: [] });
    }
    for (const e of this.entities) {
      const hit = out.get(e.name);
      if (hit) {
        hit.code = hit.code ?? e.code ?? null;
        hit.aliases = [...new Set([...hit.aliases, ...(e.aliases ?? [])])];
      } else {
        out.set(e.name, { code: e.code ?? null, name: e.name, aliases: [...(e.aliases ?? [])] });
      }
    }
    return [...out.values()];
  }

  /** 按 externalId 反查已接入事件（实时消息"已接入"回标） */
  findEventIdByExternalId(externalId: string): string | undefined {
    for (const ev of this.evidenceMap.values()) {
      if (ev.externalId === externalId) return ev.eventId;
    }
    return undefined;
  }

  isFavorited(eventId: string): boolean {
    return this.favorites.has(eventId);
  }

  /** 切换收藏状态；事件不存在返回 undefined */
  toggleFavorite(eventId: string): boolean | undefined {
    if (!this.events.has(eventId)) return undefined;
    if (this.favorites.has(eventId)) {
      this.favorites.delete(eventId);
      return false;
    }
    this.favorites.add(eventId);
    return true;
  }

  favoriteCount(): number {
    return this.favorites.size;
  }

  /** 通知中心数据源：仅已收藏事件的通知 */
  listFavoriteNotifications(): AppNotification[] {
    return this.listNotifications().filter((n) => this.favorites.has(n.eventId));
  }

  /** 未读角标：仅统计已收藏事件的未读通知 */
  unreadFavoriteNotifications(): number {
    return [...this.notifications.values()].filter((n) => !n.read && this.favorites.has(n.eventId)).length;
  }

  markNotificationRead(id: string): AppNotification | undefined {
    const n = this.notifications.get(id);
    if (n) n.read = true;
    return n;
  }

  markAllNotificationsRead(): number {
    let count = 0;
    for (const n of this.notifications.values()) {
      if (!n.read) {
        n.read = true;
        count++;
      }
    }
    return count;
  }

  listTargets(): Array<Target & { eventCount: number; activeCount: number }> {
    return [...this.targets.values()]
      .map((t) => {
        const related = this.listEvents({ target: t.code });
        return {
          ...t,
          eventCount: related.length,
          activeCount: related.filter((e) => e.status !== 'expired' && e.status !== 'denied').length,
        };
      })
      .filter((t) => t.eventCount > 0)
      .sort((a, b) => b.eventCount - a.eventCount);
  }

  getTarget(code: string): Target | undefined {
    return this.targets.get(code);
  }

  stats(): Record<EventStatus, number> & { total: number; unreadNotifications: number } {
    const byStatus: Record<EventStatus, number> = {
      published: 0,
      updated: 0,
      corrected: 0,
      denied: 0,
      expired: 0,
      revived: 0,
    };
    for (const e of this.events.values()) byStatus[e.status] += 1;
    return { ...byStatus, total: this.events.size, unreadNotifications: this.unreadFavoriteNotifications() };
  }
}

// ------------------------------------------------------------
// 差异标注生成
// ------------------------------------------------------------

/** 更正差异：从更正公告正文提取“此前说X有误，正确的是Y” */
function buildCorrectionDiff(content: string): string {
  const wrong = content.match(/([一-龥A-Za-z]{2,8}[\d.,]+\s*[万亿千百]?[股元%/]+)\s*有误/);
  const right = content.match(/正确(?:的)?(?:数量|金额|比例|数值)?(?:为)?[：:]?\s*([\d.,]+\s*[万亿千百]?[股元%/]+)/);
  if (wrong && right) {
    return `此前披露「${wrong[1]}」有误，正确的是「${right[1]}」。以更正后披露为准`;
  }
  if (wrong) {
    return `此前披露「${wrong[1]}」有误，以更正后公告内容为准（详见更正公告原文）`;
  }
  return '此前披露信息有误，以更正后披露为准（详见更正公告原文）';
}

// ------------------------------------------------------------
// 单例（globalThis 缓存，避免 HMR 重复播种；
// SEED_VERSION 在种子/抽取/合并规则变更时递增，触发自动重建）
// ------------------------------------------------------------
const SEED_VERSION = 'v17';

const globalStore = globalThis as unknown as {
  __eventStore?: EventStore;
  __eventStoreSeeded?: Promise<void>;
  __eventStoreVersion?: string;
};

export async function getStore(): Promise<EventStore> {
  if (!globalStore.__eventStore || globalStore.__eventStoreVersion !== SEED_VERSION) {
    globalStore.__eventStore = new EventStore();
    globalStore.__eventStoreVersion = SEED_VERSION;
    globalStore.__eventStoreSeeded = globalStore.__eventStore.seed();
  }
  await globalStore.__eventStoreSeeded;
  return globalStore.__eventStore;
}

export type { EventStore };
