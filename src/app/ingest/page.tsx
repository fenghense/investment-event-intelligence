'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { IngestResult, SourceType } from '@/lib/domain/types';
import { ACTION_LABELS, SOURCE_TYPE_LABELS } from '@/lib/domain/vocabulary';
import { PageHeader, StatusSeal } from '@/components/app/ui-bits';
import { IfindPanel } from '@/components/app/ifind-panel';

interface PresetPayload {
  sourceType: SourceType;
  sourceName: string;
  title: string;
  content: string;
  bulletinType: string;
  disclosedAt: string;
}

interface Preset {
  name: string;
  desc: string;
  /** 点击时基于当前时间生成，保证演示数据永远新鲜（与种子语料时间线对齐） */
  build: () => PresetPayload;
  mode: 'rules' | 'llm';
}

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDaysAgo = (n: number): string => new Date(Date.now() - n * DAY_MS).toISOString();
const cnDaysAgo = (n: number): string => {
  const d = new Date(Date.now() - n * DAY_MS);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

const PRESETS: Preset[] = [
  {
    name: '表述差异合并（规则）',
    desc: '「拟认购定增股份」应合并入既有认购事件',
    mode: 'rules',
    build: () => ({
      sourceType: 'media',
      sourceName: '每日经济新闻',
      title: '明州智能拟认购金鼎控股定增股份',
      content: `${cnDaysAgo(54)}获悉，明州智能拟认购金鼎控股定向增发股份，认购数量约1500万股，与公司此前公告口径一致。`,
      bulletinType: '',
      disclosedAt: isoDaysAgo(54),
    }),
  },
  {
    name: '语义级抽取（大模型）',
    desc: '「受让20%股权」语义归一为收购',
    mode: 'llm',
    build: () => ({
      sourceType: 'media',
      sourceName: '界面新闻',
      title: '华锐科技深化布局，拟受让星辉数据20%股权',
      content: `${cnDaysAgo(25)}消息，华锐科技在业绩交流会上透露，拟在此前70%控股基础上进一步受让星辉数据20%股权，交易完成后持股比例将升至90%。`,
      bulletinType: '',
      disclosedAt: isoDaysAgo(25),
    }),
  },
  {
    name: '官方确认反转',
    desc: '被否认事件遇官方公告确认 → 反转',
    mode: 'rules',
    build: () => ({
      sourceType: 'announcement',
      sourceName: '恒远能源公告',
      title: '恒远能源关于控股股东协议转让公司股份暨控制权拟发生变更的提示性公告',
      content: `${cnDaysAgo(4)}，恒远能源公告称，控股股东恒远集团已与浙江国资运营公司签署正式股份转让协议，拟转让公司51%股份，公司控制权将发生变更。此前相关传闻以本公告为准。`,
      bulletinType: '提示性公告',
      disclosedAt: isoDaysAgo(4),
    }),
  },
  {
    name: '市场传闻（新事件）',
    desc: '单源传闻 → 低可信度新事件',
    mode: 'rules',
    build: () => ({
      sourceType: 'personal',
      sourceName: '股吧匿名用户',
      title: '听说蓝湾生物要被收购了',
      content: '群里有人爆料，蓝湾生物好像在跟一家外资谈收购，价格很夸张，不知真假，大家自己判断。',
      bulletinType: '',
      disclosedAt: isoDaysAgo(1),
    }),
  },
];

const SOURCE_TYPES: SourceType[] = [
  'announcement',
  'exchange',
  'media',
  'research',
  'official_social',
  'social',
  'personal',
];

export default function IngestPage() {
  const [sourceTab, setSourceTab] = useState<'manual' | 'ifind'>('manual');
  const EMPTY_FORM: PresetPayload = {
    sourceType: 'media',
    sourceName: '',
    title: '',
    content: '',
    bulletinType: '',
    disclosedAt: '',
  };
  const [form, setForm] = useState<PresetPayload>(EMPTY_FORM);
  const [mode, setMode] = useState<'rules' | 'llm'>('rules');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (p: Preset): void => {
    setForm(p.build());
    setMode(p.mode);
    setResult(null);
    setError(null);
  };

  // 挂载后填充默认预设（日期基于当前时间动态生成，避免 SSR 不一致）
  useEffect(() => {
    applyPreset(PRESETS[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, mode }),
      });
      const json = (await res.json()) as IngestResult & { error?: string };
      if (!res.ok) {
        setError(json.error ?? '接入失败');
        setResult(null);
      } else {
        setResult(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <PageHeader title="情报接入台" en="Ingestion Pipeline Console" />
      <p className="-mt-3 mb-5 text-[13px] text-[#6b7280]">
        提交一条证据文本，实时运行主链路：要素抽取 → 去重合并 → 状态机校验 → 通知生成。可选择确定性规则或大模型语义抽取。
      </p>

      {/* 数据源切换 */}
      <div className="mb-5 inline-flex overflow-hidden rounded-md border border-[#e5e7eb]">
        <button
          onClick={() => setSourceTab('manual')}
          className={`px-4 py-2 text-[13px] font-medium transition-colors ${
            sourceTab === 'manual' ? 'bg-[#c12a26] text-white' : 'bg-white text-[#6b7280] hover:bg-[#fdf3f3]'
          }`}
        >
          手动录入证据
        </button>
        <button
          onClick={() => setSourceTab('ifind')}
          className={`px-4 py-2 text-[13px] font-medium transition-colors ${
            sourceTab === 'ifind' ? 'bg-[#c12a26] text-white' : 'bg-white text-[#6b7280] hover:bg-[#fdf3f3]'
          }`}
        >
          iFinD 实时数据
        </button>
      </div>

      {sourceTab === 'ifind' ? (
        <IfindPanel />
      ) : (
      <>
      {/* 预设案例 */}
      <div className="mb-5 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            onClick={() => applyPreset(p)}
            className="rounded-md border border-[#e5e7eb] bg-white px-3 py-2 text-left transition-all hover:border-[#d93025] hover:bg-[#f6f8fb]"
          >
            <div className="text-[12.5px] font-semibold text-[#d93025]">{p.name}</div>
            <div className="text-[11px] text-[#6b7280]">{p.desc}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* 表单 */}
        <section className="paper-card p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[#6b7280]">来源类型</span>
              <select
                value={form.sourceType}
                onChange={(e) => setForm({ ...form, sourceType: e.target.value as SourceType })}
                className="w-full rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[#d93025]"
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SOURCE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[#6b7280]">来源名称</span>
              <input
                value={form.sourceName}
                onChange={(e) => setForm({ ...form, sourceName: e.target.value })}
                className="w-full rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[#d93025]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[#6b7280]">公告类型（可选，模拟巨潮字段）</span>
              <input
                value={form.bulletinType}
                onChange={(e) => setForm({ ...form, bulletinType: e.target.value })}
                placeholder="如：更正公告 / 澄清公告"
                className="w-full rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[#d93025]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[#6b7280]">抽取方式</span>
              <div className="flex overflow-hidden rounded-md border border-[#e5e7eb]">
                {(['rules', 'llm'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`flex-1 px-2 py-1.5 text-[12.5px] font-medium transition-colors ${
                      mode === m ? 'bg-[#d93025] text-white' : 'bg-white text-[#6b7280] hover:bg-[#f6f5f0]'
                    }`}
                  >
                    {m === 'rules' ? '确定性规则' : '大模型语义'}
                  </button>
                ))}
              </div>
            </label>
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-medium text-[#6b7280]">标题</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[#d93025]"
            />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-medium text-[#6b7280]">正文</span>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={4}
              className="w-full rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[13px] leading-relaxed outline-none focus:border-[#d93025]"
            />
          </label>
          <button
            onClick={submit}
            disabled={running}
            className="mt-4 w-full rounded-md bg-[#d93025] py-2 text-[13.5px] font-semibold text-white transition-all hover:bg-[#28405f] disabled:opacity-50"
          >
            {running ? '链路运行中…' : '运行接入链路 →'}
          </button>
          {error && <p className="mt-2 text-xs text-[#991b1b]">{error}</p>}
        </section>

        {/* 链路决策结果 */}
        <section>
          {!result ? (
            <div className="paper-card flex h-full min-h-40 items-center justify-center p-6 text-sm text-[#9ca3af]">
              运行后在此展示链路决策明细
            </div>
          ) : (
            <div className="space-y-3">
              {result.warnings.length > 0 && (
                <div className="rounded-md border border-[#e8d9ac] bg-[#fef3c7] px-3 py-2 text-xs text-[#92400e]">
                  {result.warnings.map((w, i) => (
                    <div key={i}>⚠ {w}</div>
                  ))}
                </div>
              )}

              {/* 1 抽取 */}
              <div className="paper-card p-3.5">
                <StepTitle n={1} title={`要素抽取（${result.extraction.extractor === 'llm' ? '大模型语义' : '确定性规则'}）`} />
                <div className="mono mt-2 rounded bg-[#1f2329] p-3 text-[11.5px] leading-relaxed text-[#cfccc2]">
                  subject: {result.extraction.subject ?? 'null'}
                  {'\n'}action:  {result.extraction.action}（{ACTION_LABELS[result.extraction.action]}）
                  {'\n'}object:  {result.extraction.object ?? 'null'}
                  {'\n'}time:    {result.extraction.time ?? 'null'}
                  {result.extraction.reasoning ? `\nreason:  ${result.extraction.reasoning}` : ''}
                </div>
              </div>

              {/* 2 合并 */}
              <div className="paper-card p-3.5">
                <StepTitle n={2} title="去重合并判定" />
                <div className="mt-2 space-y-1 text-[12.5px] text-[#4b5563]">
                  <div>
                    dedup_key：<span className="mono text-[#d93025]">{result.decision.dedupKey}</span>
                  </div>
                  <div>
                    匹配方式：
                    <b>
                      {result.decision.matchType === 'exact'
                        ? '精确匹配（合并入既有事件）'
                        : result.decision.matchType === 'fuzzy'
                          ? '文本相似度近似匹配（合并）'
                          : result.decision.matchType === 'deny_ref'
                            ? '否认指向既有事件'
                            : result.decision.matchType === 'reactivate'
                              ? '过期事件重新激活'
                              : '无匹配（新建事件）'}
                    </b>
                  </div>
                </div>
              </div>

              {/* 3 状态机 */}
              <div className="paper-card p-3.5">
                <StepTitle n={3} title="版本状态机" />
                {result.decision.transition ? (
                  <div className="mt-2 flex items-center gap-2 text-[13px]">
                    <span className="mono text-[#6b7280]">
                      {result.decision.transition.from} → {result.decision.transition.to}
                    </span>
                    <StatusSeal status={result.decision.transition.to} size="sm" />
                    <span className={result.decision.transition.legal ? 'text-[#0da678]' : 'text-[#991b1b]'}>
                      {result.decision.transition.legal ? '✓ 合法转换' : '✗ 非法转换已阻止'}
                    </span>
                  </div>
                ) : (
                  <p className="mt-2 text-[12.5px] text-[#6b7280]">未触发状态转换（仅追加证据/刷新版本）</p>
                )}
                {result.decision.transition && (
                  <p className="mt-1 text-xs text-[#6b7280]">{result.decision.transition.reason}</p>
                )}
                {result.decision.revivalCheck && (
                  <div className="mt-2 rounded bg-[#fdf3ec] px-3 py-2 text-xs text-[#8a4a1d]">
                    反转门槛校验：
                    {result.decision.revivalCheck.via === 'official_confirm'
                      ? '【官方再次确认】'
                      : result.decision.revivalCheck.via === 'multi_source'
                        ? '【多源印证】'
                        : ''}
                    {result.decision.revivalCheck.detail} →{' '}
                    <b>{result.decision.revivalCheck.passed ? '通过' : '未通过，维持否认状态'}</b>
                  </div>
                )}
              </div>

              {/* 4 通知 */}
              <div className="paper-card p-3.5">
                <StepTitle n={4} title="通知与去向" />
                <div className="mt-2 text-[12.5px] text-[#4b5563]">
                  {result.decision.notificationId ? (
                    <span className="text-[#0da678]">✓ 已生成状态变更通知（通知中心可查）</span>
                  ) : (
                    <span>本次未生成通知</span>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <Link
                    href={`/events/${result.event.id}`}
                    className="rounded-md bg-[#d93025] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#28405f]"
                  >
                    查看事件：{result.event.title} →
                  </Link>
                  <StatusSeal status={result.event.status} size="sm" />
                  <span className="mono text-[11px] text-[#6b7280]">
                    可信度 {result.event.credibilityScore}
                  </span>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
      </>
      )}
    </div>
  );
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="mono flex h-5 w-5 items-center justify-center rounded-full bg-[#d93025] text-[10px] font-semibold text-white">
        {n}
      </span>
      <span className="text-[13px] font-semibold text-[#1f2329]">{title}</span>
    </div>
  );
}
