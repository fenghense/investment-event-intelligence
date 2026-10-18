import type { RawSourceItem, Target } from '@/lib/domain/types';

// ============================================================
// 内置样例数据（Mock 数据源语料）
// 覆盖：公告 / 交易所披露 / 财经新闻 / 研报 / 传闻
// 案例：同一事件多来源且表述差异大、否认后反转、更正、过期、过期后重新激活
//
// 日期策略：全部时间戳相对「当前时间」动态生成（ago(n) = n 天前），
// 保证演示数据在任何时刻打开都是「最近发生」的新鲜数据；
// 事件链内部的先后间隔固定，维持状态机演化语义不变。
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000;

/** n 天前（负数 = n 天后）的 ISO 时间戳，hour/minute 为本地时分 */
function ago(days: number, hour = 18, minute = 0): string {
  const d = new Date(Date.now() - days * DAY_MS);
  d.setHours(hour, minute, 30, 0);
  return d.toISOString();
}

/** n 天前的「YYYY年M月D日」中文日期文本（用于正文叙述，可被要素抽取识别） */
function agoText(days: number): string {
  const d = new Date(Date.now() - days * DAY_MS);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** n 天前所在年份（用于公告编号） */
function agoYear(days: number): number {
  return new Date(Date.now() - days * DAY_MS).getFullYear();
}

export const SEED_TARGETS: Target[] = [
  { code: '688301', name: '华锐科技', market: '上交所科创板', industry: '半导体设备' },
  { code: '832001', name: '星辉数据', market: '新三板', industry: '大数据服务' },
  { code: '600982', name: '恒远能源', market: '上交所主板', industry: '电力' },
  { code: '300458', name: '明州智能', market: '深交所创业板', industry: '智能制造' },
  { code: '601788', name: '金鼎控股', market: '上交所主板', industry: '综合控股' },
  { code: '688221', name: '蓝湾生物', market: '上交所科创板', industry: '生物医药' },
  { code: 'ENT-ZJGZ', name: '浙江国资运营', market: '非上市', industry: '国有资本运营', aliases: ['省国资运营公司', '浙江国资运营公司'] },
];

export const SEED_RAW_ITEMS: RawSourceItem[] = [
  // ----------------------------------------------------------
  // 事件A：华锐科技收购星辉数据（多来源合并，表述差异大；published→updated）
  // 时间线：42 天前传闻 → 39 天前媒体 → 36 天前公告 → 34 天前研报 → 26 天前进展公告
  // ----------------------------------------------------------
  {
    externalId: 'A1',
    sourceType: 'personal',
    sourceName: '雪球用户·风口观察员',
    title: '小道消息：华锐科技好像在谈一笔收购',
    content:
      '听说华锐科技最近在密切接触星辉数据，好像要拿下控股权，金额不小。本人持有该股，消息不保真，各位自行判断。',
    url: 'https://xueqiu.com/statuses/demo-a1',
    disclosedAt: ago(42, 21, 14),
    fetchedAt: ago(42, 21, 40),
    meta: { evidenceType: 'rumor', interestRelated: true, sourceHitRate: 0.35 },
  },
  {
    externalId: 'A2',
    sourceType: 'media',
    sourceName: '每日经济新闻',
    title: '据悉华锐科技拟收购星辉数据控股权 交易金额或超10亿元',
    content:
      '记者近日从多位接近交易的人士处获悉，华锐科技拟收购星辉数据控股权，交易金额或超10亿元，目前双方仍在谈判中，存在不确定性。',
    url: 'https://www.nbd.com.cn/articles/demo-a2',
    disclosedAt: ago(39, 9, 32),
    fetchedAt: ago(39, 9, 35),
    meta: { evidenceType: 'speculation', sourceHitRate: 0.78 },
  },
  {
    externalId: 'A3',
    sourceType: 'announcement',
    sourceName: '华锐科技董事会',
    title: '华锐科技关于收购星辉数据70%股权的公告',
    content: `华锐科技股份有限公司于${agoText(38)}与星辉数据股东签署《股权转让协议》，拟以现金12.6亿元收购星辉数据70%股权。本次交易不构成重大资产重组，尚需履行相关审议程序。`,
    url: 'https://www.sse.com.cn/disclosure/demo-a3',
    announcementNo: `华锐科技公告〔${agoYear(36)}〕018号`,
    disclosedAt: ago(36, 18, 5),
    fetchedAt: ago(36, 18, 6),
    meta: { evidenceType: 'fact', officialConfirm: true, sourceHitRate: 0.98 },
  },
  {
    externalId: 'A4',
    sourceType: 'research',
    sourceName: '中信建投研究部',
    title: '华锐科技并购星辉数据点评：数据资产协同显著，上调至“买入”',
    content:
      '我们认为华锐科技收购星辉数据70%股权将显著增强其工业数据服务能力，协同效应可期。预计并表后显著增厚EPS，上调评级至“买入”。',
    url: 'https://research.csc.com.cn/demo-a4',
    disclosedAt: ago(34, 8, 20),
    fetchedAt: ago(34, 8, 21),
    meta: { evidenceType: 'opinion', sourceHitRate: 0.85 },
  },
  {
    externalId: 'A5',
    sourceType: 'announcement',
    sourceName: '华锐科技董事会',
    title: '华锐科技关于收购星辉数据股权的进展公告',
    content: `公司收购星辉数据70%股权事项已完成尽职调查与审计评估，交易双方于${agoText(28)}签署正式《股权转让协议》，交易对价维持12.6亿元不变，后续将推进交割。`,
    url: 'https://www.sse.com.cn/disclosure/demo-a5',
    announcementNo: `华锐科技公告〔${agoYear(26)}〕024号`,
    disclosedAt: ago(26, 18, 10),
    fetchedAt: ago(26, 18, 11),
    meta: { bulletinType: '进展公告', evidenceType: 'fact', officialConfirm: true, sourceHitRate: 0.98 },
  },

  // ----------------------------------------------------------
  // 事件B：浙江国资运营收购恒远能源（传闻→媒体报道→公司否认→多源印证反转→官方确认更新）
  // 时间线：30 天前传闻 → 27 天前媒体 → 23 天前否认 → 6 天前独家+交易所公告 → 5 天前跟进（近一周热点）
  // ----------------------------------------------------------
  {
    externalId: 'B1',
    sourceType: 'personal',
    sourceName: '股吧用户·钱塘潮',
    title: '传恒远能源大股东要转让控制权了',
    content:
      '据传恒远能源大股东正与浙江国资运营公司洽谈，或涉及控制权转让，消息来自圈内朋友，真假未知。',
    url: 'https://guba.eastmoney.com/demo-b1',
    disclosedAt: ago(30, 22, 3),
    fetchedAt: ago(30, 22, 10),
    meta: { evidenceType: 'rumor', sourceHitRate: 0.4 },
  },
  {
    externalId: 'B2',
    sourceType: 'media',
    sourceName: '证券时报',
    title: '恒远能源或迎国资入主 公司回应称“以公告为准”',
    content:
      '市场有消息称浙江国资运营公司拟受让恒远能源控制权。记者致电恒远能源，公司回应称“不清楚相关情况，一切以公告为准”。',
    url: 'https://www.stcn.com/demo-b2',
    disclosedAt: ago(27, 10, 15),
    fetchedAt: ago(27, 10, 17),
    meta: { evidenceType: 'speculation', sourceHitRate: 0.82 },
  },
  {
    externalId: 'B3',
    sourceType: 'announcement',
    sourceName: '恒远能源董事会',
    title: '恒远能源澄清公告：不存在控制权转让事宜',
    content:
      '针对近期媒体关于“浙江国资运营公司拟受让恒远能源控制权”的报道，公司澄清：经向控股股东核实，不存在控制权转让事宜，相关报道不属实。公司提醒广大投资者注意风险。',
    url: 'https://www.sse.com.cn/disclosure/demo-b3',
    announcementNo: `恒远能源公告〔${agoYear(23)}〕003号`,
    disclosedAt: ago(23, 18, 0),
    fetchedAt: ago(23, 18, 1),
    meta: { bulletinType: '澄清公告', evidenceType: 'fact', officialConfirm: true, sourceHitRate: 0.97 },
  },
  {
    externalId: 'B4',
    sourceType: 'media',
    sourceName: '财新网',
    title: '独家：浙江国资运营公司已与恒远集团签署股权转让意向协议',
    content: `财新记者从两个独立信源确认，浙江国资运营公司已于${agoText(8)}与恒远能源控股股东恒远集团签署股权转让意向协议，拟受让恒远能源控制权，尽调正在进行中。`,
    url: 'https://www.caixin.com/demo-b4',
    disclosedAt: ago(6, 7, 50),
    fetchedAt: ago(6, 7, 52),
    meta: { evidenceType: 'fact', sourceHitRate: 0.88 },
  },
  {
    externalId: 'B6',
    sourceType: 'exchange',
    sourceName: '上海证券交易所',
    title: '恒远能源关于股东签署股份转让协议暨控制权变更的提示性公告',
    content: `公司控股股东恒远集团于${agoText(6)}与浙江国资运营公司签署《股份转让协议》，拟转让其所持恒远能源51%股份。本次转让完成后，公司控股股东将变更为浙江国资运营公司。`,
    url: 'https://www.sse.com.cn/disclosure/demo-b6',
    announcementNo: `恒远能源公告〔${agoYear(6)}〕021号`,
    disclosedAt: ago(6, 18, 2),
    fetchedAt: ago(6, 18, 3),
    meta: { evidenceType: 'fact', officialConfirm: true, sourceHitRate: 0.99 },
  },
  {
    externalId: 'B5',
    sourceType: 'media',
    sourceName: '上海证券报',
    title: '恒远能源控制权或生变 多方信源指向浙江国资运营公司',
    content:
      '记者从多方信源获悉，浙江国资运营公司受让恒远能源控制权一事已进入实质推进阶段，转让比例或达51%，相关方案已报监管部门沟通。',
    url: 'https://www.cnstock.com/demo-b5',
    disclosedAt: ago(5, 9, 5),
    fetchedAt: ago(5, 9, 6),
    meta: { evidenceType: 'fact', sourceHitRate: 0.84 },
  },

  // ----------------------------------------------------------
  // 事件C：明州智能认购金鼎控股定增（表述差异合并 + 更正案例）
  // 时间线：55 天前公告+媒体 → 53 天前更正
  // ----------------------------------------------------------
  {
    externalId: 'C1',
    sourceType: 'announcement',
    sourceName: '明州智能董事会',
    title: '明州智能关于认购金鼎控股非公开发行股票的公告',
    content: `明州智能于${agoText(57)}审议通过，拟以自有资金认购金鼎控股非公开发行股票2000万股，认购价格8.5元/股，认购金额1.7亿元。`,
    url: 'https://www.szse.cn/disclosure/demo-c1',
    announcementNo: `明州智能公告〔${agoYear(55)}〕006号`,
    disclosedAt: ago(55, 19, 30),
    fetchedAt: ago(55, 19, 31),
    meta: { evidenceType: 'fact', officialConfirm: true, sourceHitRate: 0.96 },
  },
  {
    externalId: 'C2',
    sourceType: 'media',
    sourceName: '中国证券报',
    title: '明州智能1.7亿元认购金鼎控股定增股份',
    content: `${agoText(55)}晚间，明州智能披露公告称，公司拟以1.7亿元认购金鼎控股定增股份，进一步深化产业链协同。`,
    url: 'https://www.cs.com.cn/demo-c2',
    disclosedAt: ago(55, 21, 12),
    fetchedAt: ago(55, 21, 13),
    meta: { evidenceType: 'fact', sourceHitRate: 0.86 },
  },
  {
    externalId: 'C3',
    sourceType: 'announcement',
    sourceName: '明州智能董事会',
    title: '明州智能关于认购金鼎控股非公开发行股票公告的更正公告',
    content: `因工作人员疏忽，公司${agoText(55)}披露的公告中认购数量2000万股有误，正确数量为1500万股，对应认购金额由1.7亿元更正为1.275亿元。除上述更正外，原公告其他内容不变。`,
    url: 'https://www.szse.cn/disclosure/demo-c3',
    announcementNo: `明州智能公告〔${agoYear(53)}〕008号`,
    disclosedAt: ago(53, 8, 55),
    fetchedAt: ago(53, 8, 56),
    meta: { bulletinType: '更正公告', evidenceType: 'fact', officialConfirm: true, sourceHitRate: 0.96 },
  },

  // ----------------------------------------------------------
  // 事件D：蓝湾生物控股股东增持计划（计划→届满过期）
  // 时间线：200 天前计划 → 20 天前届满
  // ----------------------------------------------------------
  {
    externalId: 'D1',
    sourceType: 'announcement',
    sourceName: '蓝湾生物董事会',
    title: '蓝湾生物关于控股股东增持公司股份计划的公告',
    content: `公司控股股东蓝湾集团计划自${agoText(200)}起6个月内，以自有资金增持不超过公司总股本2%的股份。`,
    url: 'https://www.sse.com.cn/disclosure/demo-d1',
    announcementNo: `蓝湾生物公告〔${agoYear(200)}〕041号`,
    disclosedAt: ago(200, 18, 20),
    fetchedAt: ago(200, 18, 21),
    meta: { evidenceType: 'fact', officialConfirm: true, sourceHitRate: 0.95 },
  },
  {
    externalId: 'D2',
    sourceType: 'announcement',
    sourceName: '蓝湾生物董事会',
    title: '蓝湾生物关于控股股东增持计划实施结果的公告',
    content: `截至${agoText(21)}，本次增持计划期限届满，控股股东蓝湾集团累计增持公司股份占总股本的0.8%，本次增持计划到期结束。`,
    url: 'https://www.sse.com.cn/disclosure/demo-d2',
    announcementNo: `蓝湾生物公告〔${agoYear(20)}〕009号`,
    disclosedAt: ago(20, 18, 0),
    fetchedAt: ago(20, 18, 1),
    meta: { bulletinType: '结果公告', evidenceType: 'fact', officialConfirm: true, sourceHitRate: 0.95 },
  },

  // ----------------------------------------------------------
  // 事件E：蓝湾生物股东减持计划（计划→届满未实施过期→新计划重新激活）
  // 时间线：180 天前计划 → 90 天前届满 → 2 天前新计划（最新进展）
  // ----------------------------------------------------------
  {
    externalId: 'E1',
    sourceType: 'announcement',
    sourceName: '蓝湾生物董事会',
    title: '蓝湾生物持股5%以上股东减持股份计划公告',
    content: `持股5%以上股东蓝湾创投计划自${agoText(180)}起3个月内，通过集中竞价方式减持不超过公司总股本1.5%的股份。`,
    url: 'https://www.sse.com.cn/disclosure/demo-e1',
    announcementNo: `蓝湾生物公告〔${agoYear(180)}〕052号`,
    disclosedAt: ago(180, 18, 10),
    fetchedAt: ago(180, 18, 11),
    meta: { evidenceType: 'fact', officialConfirm: true, sourceHitRate: 0.95 },
  },
  {
    externalId: 'E2',
    sourceType: 'announcement',
    sourceName: '蓝湾生物董事会',
    title: '蓝湾生物股东减持计划期限届满暨实施结果公告',
    content: `截至${agoText(91)}，股东蓝湾创投减持计划期限届满，期间累计减持0股，未实施减持，本次减持计划到期结束。`,
    url: 'https://www.sse.com.cn/disclosure/demo-e2',
    announcementNo: `蓝湾生物公告〔${agoYear(90)}〕003号`,
    disclosedAt: ago(90, 18, 5),
    fetchedAt: ago(90, 18, 6),
    meta: { bulletinType: '结果公告', evidenceType: 'fact', officialConfirm: true, sourceHitRate: 0.95 },
  },
  {
    externalId: 'E3',
    sourceType: 'announcement',
    sourceName: '蓝湾生物董事会',
    title: '蓝湾生物持股5%以上股东新减持股份计划公告',
    content: `持股5%以上股东蓝湾创投计划自${agoText(-5)}起3个月内，通过集中竞价方式减持不超过公司总股本2%的股份，减持原因为自身资金需求。`,
    url: 'https://www.sse.com.cn/disclosure/demo-e3',
    announcementNo: `蓝湾生物公告〔${agoYear(2)}〕017号`,
    disclosedAt: ago(2, 18, 12),
    fetchedAt: ago(2, 18, 13),
    meta: { bulletinType: '减持计划', evidenceType: 'fact', officialConfirm: true, sourceHitRate: 0.95 },
  },

  // ----------------------------------------------------------
  // 事件G：金鼎控股资产转让传闻（传闻 → 公司公告否认，终态 denied，未反转对照组）
  // 时间线：15 天前传闻 → 11 天前澄清
  // ----------------------------------------------------------
  {
    externalId: 'G1',
    sourceType: 'social',
    sourceName: '雪球用户·价值猎手',
    title: '传金鼎控股拟剥离地产子公司 股权打包转让给神秘买家',
    content:
      '网传金鼎控股正在接触买家，拟将旗下地产子公司股权整体转让，交易对价或超20亿元，据传下周公告。',
    url: 'https://xueqiu.com/demo-g1',
    disclosedAt: ago(15, 13, 20),
    fetchedAt: ago(15, 13, 25),
    meta: { evidenceType: 'rumor', sourceHitRate: 0.35 },
  },
  {
    externalId: 'G2',
    sourceType: 'announcement',
    sourceName: '金鼎控股董事会',
    title: '金鼎控股澄清公告：不存在资产剥离及股权转让事宜',
    content:
      '针对网络关于“金鼎控股拟转让地产子公司股权”的传闻，公司澄清：经核实，公司不存在资产剥离及股权转让事宜，也未与任何方进行相关接洽，相关传闻严重不实。',
    url: 'https://www.sse.com.cn/disclosure/demo-g2',
    announcementNo: `金鼎控股公告〔${agoYear(11)}〕015号`,
    disclosedAt: ago(11, 18, 30),
    fetchedAt: ago(11, 18, 31),
    meta: { bulletinType: '澄清公告', evidenceType: 'fact', officialConfirm: true, sourceHitRate: 0.96 },
  },

  // ----------------------------------------------------------
  // 事件F：金鼎控股质押传闻（单一低质来源，低可信度对照组，3 天前）
  // ----------------------------------------------------------
  {
    externalId: 'F1',
    sourceType: 'social',
    sourceName: '微博用户·财经闲聊',
    title: '听说金鼎控股大股东要质押股份？',
    content:
      '听说金鼎控股大股东要把手里股份都质押了去搞地产项目，不知道靠不靠谱，有了解内情的吗？',
    url: 'https://weibo.com/demo-f1',
    disclosedAt: ago(3, 14, 26),
    fetchedAt: ago(3, 14, 30),
    meta: { evidenceType: 'rumor', sourceHitRate: 0.2 },
  },
];
