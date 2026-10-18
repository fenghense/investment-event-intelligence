import type { ActionType, EvidenceType, ExtractedElements, SourceType, Target } from './types';

// ============================================================
// 事件要素抽取：主体/动作/对象/时间
// 默认确定性规则抽取；预留大模型语义抽取接口（LlmExtractor）
// ============================================================

export interface EntityInfo {
  code: string;
  name: string;
  aliases?: string[];
}

export function entitiesFromTargets(targets: Target[]): EntityInfo[] {
  return targets.map((t) => ({ code: t.code, name: t.name, aliases: t.aliases }));
}

interface ActionRule {
  action: ActionType;
  pattern: RegExp;
  /** 命中优先级（先匹配 DENY 等强信号） */
  priority: number;
}

/**
 * 动作归一化规则（受控词表）。
 * 注意：规则顺序即优先级，澄清/否认类必须先命中，
 * 因为澄清公告正文往往同时包含被否认的动作词（如“不存在股权转让事宜”）。
 */
const ACTION_RULES: ActionRule[] = [
  { action: 'DENY', pattern: /(澄清|否认|不存在[^。，]{0,16}(事宜|事项|计划|安排)|不属实|毫无关联|严重不实|传闻不实|予以否认)/, priority: 100 },
  { action: 'ACQUISITION', pattern: /(收购|并购|取得[^。，]{0,8}控制权|取得[^。，]{0,4}控股权|受让[^。，]{0,12}(股权|股份)|入主|要约收购)/, priority: 80 },
  { action: 'SUBSCRIBE', pattern: /(认购|申购|参与[^。，]{0,6}(定增|定向增发|非公开发行)|拟认购|定增|配股认购)/, priority: 75 },
  { action: 'TRANSFER', pattern: /(转让|出售|剥离|协议转让|出让[^。，]{0,8}(股权|股份))/, priority: 70 },
  // 届满/终止优先于增持/减持：如“增持计划期限届满，累计增持0.8%”语义是 TERMINATE 而非 INCREASE
  { action: 'TERMINATE', pattern: /(届满|到期|期满|终止|失效|不再实施|期限届满)/, priority: 68 },
  { action: 'INCREASE', pattern: /(增持|加仓|举牌|继续买入|累计买入)/, priority: 66 },
  { action: 'REDUCE', pattern: /(减持|清仓|抛售|减仓|拟减持)/, priority: 65 },
  // 回购视作公司侧买入（归 INCREASE 组），低于 TERMINATE：「回购期限届满」仍判终止
  { action: 'INCREASE', pattern: /(回购[^。，]{0,10}(股份|股票|A股)|股份回购|拟回购|回购进展)/, priority: 64 },
  { action: 'PLEDGE', pattern: /(质押|出质|解押|股权质押)/, priority: 60 },
  // 签署合作/战略合作：置于终止之后（“终止合作协议”仍判 TERMINATE）
  {
    action: 'COOPERATE',
    pattern: /(战略合作|签署[^。，]{0,12}合作协议|签订[^。，]{0,12}合作协议|合作协议|战略联盟|合资设立|合资成立|联手[^。，]{0,6}共建|签署[^。，]{0,12}框架协议|签订[^。，]{0,12}框架协议)/,
    priority: 55,
  },
];

/** 从文本中定位已知实体，返回按出现位置排序的命中 */
function findEntities(text: string, entities: EntityInfo[]): Array<{ entity: EntityInfo; index: number; matched: string }> {
  const hits: Array<{ entity: EntityInfo; index: number; matched: string }> = [];
  for (const entity of entities) {
    const names = [entity.name, ...(entity.aliases ?? [])];
    for (const name of names) {
      const idx = text.indexOf(name);
      if (idx >= 0) {
        hits.push({ entity, index: idx, matched: name });
        break;
      }
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** 抽取事件发生时间：yyyy年M月D日 → yyyy-MM-dd */
export function extractDate(text: string): string | null {
  const m = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** 对象兜底抽取：如“星辉数据70%股权”中的标的名 */
function extractObjectFallback(text: string, excludeNames: string[]): string | null {
  const m = text.match(/([一-龥A-Za-z0-9]{2,15}?)(?:的)?(\d+(?:\.\d+)?%\s*(?:股权|股份|控股权))/);
  if (m && !excludeNames.some((n) => m[1].includes(n))) {
    return m[1];
  }
  // “与X签署/合作/合资”模式：对象=“与”后的实体名，截止于合作类动词/句读。
  // 例：「宁德时代与赛力斯签署长期战略合作协议」→ 赛力斯
  const m2 = text.match(/与([一-龥A-Za-z0-9（）()]{2,20}?)(?:签署|签订|达成|开展|合资|合作|共同|成立|宣布|，|。|、|$)/);
  // 丢弃「产业战略」「深化合作」类被截断的伪实体（以合作/战略等泛词收尾）
  if (m2 && !/(合作|战略|战略合|产业)$/.test(m2[1]) && !excludeNames.some((n) => m2[1].includes(n) || n.includes(m2[1]))) {
    return m2[1];
  }
  return null;
}

/** 规则抽取器 */
export function extractByRules(text: string, entities: EntityInfo[]): ExtractedElements {
  const full = text;
  const hits = findEntities(full, entities);

  let action: ActionType = 'OTHER';
  let actionScore = 0;
  for (const rule of ACTION_RULES) {
    if (rule.pattern.test(full)) {
      action = rule.action;
      actionScore = rule.priority;
      break;
    }
  }

  const subjectHit = hits[0] ?? null;
  const objectHit = hits.find((h) => h.entity.code !== subjectHit?.entity.code) ?? null;
  let objectName =
    objectHit?.entity.name ??
    extractObjectFallback(full, subjectHit ? [subjectHit.entity.name, ...(subjectHit.entity.aliases ?? [])] : []);
  // 增持/减持/质押类常见表述的对象兜底：“本公司股份”
  if (!objectName && (action === 'INCREASE' || action === 'REDUCE' || action === 'PLEDGE') && /(股份|股权)/.test(full)) {
    objectName = '本公司股份';
  }

  const time = extractDate(full);

  let confidence = 0.35;
  if (subjectHit) confidence += 0.2;
  if (actionScore > 0) confidence += 0.2;
  if (objectName) confidence += 0.15;
  if (time) confidence += 0.1;

  return {
    subject: subjectHit?.entity.name ?? null,
    subjectCode: subjectHit?.entity.code ?? null,
    action,
    object: objectName,
    objectCode: objectHit?.entity.code ?? null,
    time,
    confidence: Math.min(1, confidence),
    extractor: 'rules',
  };
}

/** 证据类型推断（规则）：来源方 meta 标注优先，此处为兜底 */
export function inferEvidenceType(text: string, sourceType: SourceType): EvidenceType {
  if (sourceType === 'announcement' || sourceType === 'exchange') return 'fact';
  if (sourceType === 'research') return 'opinion';
  if (sourceType === 'personal') return 'rumor';
  if (/(传闻|据传|有消息称|小道消息|网传|听说|爆料)/.test(text)) return 'rumor';
  if (/(或将|有望|预计|或超|或迎|可能|大概率|或将|拟|或成)/.test(text)) return 'speculation';
  if (sourceType === 'social') return 'rumor';
  if (sourceType === 'official_social') return 'fact';
  return 'fact';
}

// ------------------------------------------------------------
// 大模型语义抽取（预留接口 + 提示词）
// ------------------------------------------------------------

/** 语义抽取提示词：要求语义级理解而非字面关键词匹配 */
export function buildLlmExtractPrompt(text: string, entities: EntityInfo[]): string {
  const entityLines = entities.map((e) => `- ${e.name}（代码 ${e.code}${e.aliases?.length ? `，别名：${e.aliases.join('/')}` : ''}）`).join('\n');
  return `你是一名金融事件要素抽取专家。请对下面的证据文本做【语义级】要素抽取（理解语义，而非字面关键词匹配）。
例如：“拟认购定增股份”动作应归一化为 SUBSCRIBE；“受让标的公司20%股权”与“收购20%股权”语义等价，都应归一化为 ACQUISITION；“澄清不存在转让事宜”动作是 DENY 而不是 TRANSFER。

【动作受控词表】ACQUISITION收购 / SUBSCRIBE认购 / TRANSFER转让 / INCREASE增持 / REDUCE减持 / PLEDGE质押 / DENY否认 / TERMINATE终止或届满 / OTHER其他

【已知实体清单】（若文本出现清单内实体或其别名，subjectCode/objectCode 填对应代码，否则填 null）
${entityLines}

【证据文本】
${text}

仅输出一个 JSON 对象（不要输出其他内容）：
{"subject": "主体名称或null", "subjectCode": "代码或null", "action": "受控词表中的动作", "object": "对象名称或null", "objectCode": "代码或null", "time": "事件发生时间yyyy-MM-dd或null", "evidenceType": "fact事实/opinion观点/speculation推测/rumor传闻", "reasoning": "一句话说明判断依据"}`;
}

export interface LlmExtraction extends ExtractedElements {
  evidenceType?: EvidenceType;
  reasoning?: string;
}

const VALID_ACTIONS: ActionType[] = ['ACQUISITION', 'SUBSCRIBE', 'TRANSFER', 'INCREASE', 'REDUCE', 'PLEDGE', 'DENY', 'TERMINATE', 'OTHER'];
const VALID_EVIDENCE_TYPES: EvidenceType[] = ['fact', 'opinion', 'speculation', 'rumor'];

/**
 * 大模型语义抽取器。
 * 真实调用 LLM（非流式 invoke，低温度保证结构化输出稳定）。
 * 调用失败时向上抛错，由调用方显式降级并标注 warnings，绝不做静默伪造。
 */
export class LlmExtractor {
  constructor(private readonly forwardHeaders?: Record<string, string>) {}

  async extract(text: string, entities: EntityInfo[]): Promise<LlmExtraction> {
    const { LLMClient, Config } = await import('coze-coding-dev-sdk');
    const client = new LLMClient(new Config(), this.forwardHeaders);
    const response = await client.invoke(
      [{ role: 'user', content: buildLlmExtractPrompt(text, entities) }],
      { temperature: 0.1 },
    );

    const raw = response.content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(`LLM 抽取输出非 JSON：${raw.slice(0, 120)}`);
    }

    const action = VALID_ACTIONS.includes(parsed.action as ActionType)
      ? (parsed.action as ActionType)
      : 'OTHER';
    const evidenceType = VALID_EVIDENCE_TYPES.includes(parsed.evidenceType as EvidenceType)
      ? (parsed.evidenceType as EvidenceType)
      : undefined;

    return {
      subject: typeof parsed.subject === 'string' ? parsed.subject : null,
      subjectCode: typeof parsed.subjectCode === 'string' ? parsed.subjectCode : null,
      action,
      object: typeof parsed.object === 'string' ? parsed.object : null,
      objectCode: typeof parsed.objectCode === 'string' ? parsed.objectCode : null,
      time: typeof parsed.time === 'string' ? parsed.time : null,
      confidence: 0.9,
      extractor: 'llm',
      evidenceType,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
    };
  }
}
