import { useState, useEffect } from 'react';
import { chipsApi } from '../../services/api';

interface ChipDay {
  date: string;
  foreignNet: number;
  trustNet: number;
  dealerNet: number;
}

interface Props {
  symbol: string;
  market: 'TW' | 'US';
}

// ── 白話解讀 ─────────────────────────────────────────────────────
function generateCommentary(fSum: number, tSum: number, dSum: number, days: number): string {
  const total = fSum + tSum + dSum;
  const parts: string[] = [];

  if (fSum > 5000)       parts.push(`外資大幅買超 ${fSum.toLocaleString()} 張`);
  else if (fSum > 500)   parts.push(`外資買超 ${fSum.toLocaleString()} 張`);
  else if (fSum < -5000) parts.push(`外資大幅賣超 ${Math.abs(fSum).toLocaleString()} 張`);
  else if (fSum < -500)  parts.push(`外資賣超 ${Math.abs(fSum).toLocaleString()} 張`);

  if (tSum > 500)        parts.push(`投信買超 ${tSum.toLocaleString()} 張`);
  else if (tSum < -500)  parts.push(`投信賣超 ${Math.abs(tSum).toLocaleString()} 張`);

  if (dSum > 500)        parts.push(`自營商買超 ${dSum.toLocaleString()} 張`);
  else if (dSum < -500)  parts.push(`自營商賣超 ${Math.abs(dSum).toLocaleString()} 張`);

  const prefix = parts.length > 0 ? parts.join('，') + '。' : '';

  if (total > 5000)  return `${prefix}近 ${days} 日三大法人合計買超 ${total.toLocaleString()} 張，籌碼偏向多方，主力積極布局中。`;
  if (total > 500)   return `${prefix}三大法人小幅淨買超，籌碼面中性偏多，可持續追蹤方向。`;
  if (total < -5000) return `${prefix}近 ${days} 日三大法人合計賣超 ${Math.abs(total).toLocaleString()} 張，籌碼偏向空方，需留意下行風險。`;
  if (total < -500)  return `${prefix}三大法人小幅淨賣超，籌碼面中性偏空，建議觀望。`;
  return `近 ${days} 日三大法人買賣相抵（合計 ${total >= 0 ? '+' : ''}${total.toLocaleString()} 張），籌碼面中性，等待明確方向。`;
}

// ── 外資歷史走勢 SVG 圖表（歷史 Tab 保留）──────────────────────────────────────
function ForeignHistoryChart({ days }: { days: ChipDay[] }) {
  const maxVal = Math.max(...days.map(d => Math.abs(d.foreignNet)), 1);
  const n = days.length;
  const chartH = 72;
  const midY = chartH / 2;

  if (n === 0) return null;

  const latest = days[n - 1];
  const isLatestPos = latest.foreignNet >= 0;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="section-label">外資近 {n} 日買賣超</span>
        <div className="flex items-center gap-1.5">
          <span className="section-label">今日</span>
          <span className={`text-xs font-bold tabular ${isLatestPos ? 'text-red-400' : 'text-green-400'}`}>
            {isLatestPos ? '+' : ''}{latest.foreignNet.toLocaleString()} 張
          </span>
        </div>
      </div>

      <div className="rounded overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }}>
        <svg width="100%" height={chartH} preserveAspectRatio="none" viewBox={`0 0 ${n} ${chartH}`}>
          <line x1="0" y1={midY} x2={n} y2={midY} stroke="rgba(255,255,255,0.15)" strokeWidth="0.3" />
          {days.map((d, i) => {
            const isPos = d.foreignNet >= 0;
            const isLatestBar = i === n - 1;
            const barH = Math.max(0.5, (Math.abs(d.foreignNet) / maxVal) * (midY - 3));
            const barY = isPos ? midY - barH : midY;
            const alpha = isLatestBar ? 0.9 : 0.4;
            const color = isPos ? `rgba(248,113,113,${alpha})` : `rgba(74,222,128,${alpha})`;
            return (
              <rect key={d.date} x={i + 0.1} y={barY} width={0.8} height={barH} fill={color} />
            );
          })}
          {(() => {
            const i = n - 1;
            const d = days[i];
            const isPos = d.foreignNet >= 0;
            const barH = Math.max(0.5, (Math.abs(d.foreignNet) / maxVal) * (midY - 3));
            const barY = isPos ? midY - barH : midY;
            return (
              <rect x={i + 0.05} y={barY - 0.1} width={0.9} height={barH + 0.2}
                fill="none"
                stroke={isPos ? 'rgba(248,113,113,0.9)' : 'rgba(74,222,128,0.9)'}
                strokeWidth="0.15" />
            );
          })()}
        </svg>
      </div>

      <div className="flex justify-between text-xs text-slate-500 mt-0.5">
        <span>{days[0]?.date.slice(5)}</span>
        <span className="text-slate-500">
          <span className="text-red-400/60">■</span> 買超
          <span className="text-green-400/60 ml-2">■</span> 賣超
          <span className="text-slate-500 ml-2">|</span>
          <span className="text-slate-500 ml-2">最右 = 今日</span>
        </span>
        <span>{days[n - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

// ── 分組 SVG 長條圖（三色並排，近 20 天）──────────────────────────────────────
function GroupedBarChart({ days }: { days: ChipDay[] }) {
  const recent = days.slice(-20);
  const n = recent.length;
  if (n === 0) return null;

  const maxVal = Math.max(
    ...recent.map(d => Math.abs(d.foreignNet)),
    ...recent.map(d => Math.abs(d.trustNet)),
    ...recent.map(d => Math.abs(d.dealerNet)),
    1
  );

  const chartH = 100;
  const midY = chartH / 2;
  // 每天寬度（viewBox 寬度 = n * 4，每天佔 4 單位）
  const dayW = 4;
  const barW = 1.1;
  const totalW = n * dayW;

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="section-label">近 20 日三方籌碼走勢</span>
        <div className="flex items-center gap-3 text-xs">
          <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: '#60a5fa' }} />外資</span>
          <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: '#fb923c' }} />投信</span>
          <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: '#a78bfa' }} />自營</span>
        </div>
      </div>

      <div className="rounded overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }}>
        <svg width="100%" height={chartH} preserveAspectRatio="none" viewBox={`0 0 ${totalW} ${chartH}`}>
          {/* 零線 */}
          <line x1="0" y1={midY} x2={totalW} y2={midY} stroke="rgba(255,255,255,0.15)" strokeWidth="0.4" />

          {recent.map((d, i) => {
            const baseX = i * dayW;

            const drawBar = (val: number, offsetX: number, colorPos: string, colorNeg: string) => {
              const isPos = val >= 0;
              const barH = Math.max(0.5, (Math.abs(val) / maxVal) * (midY - 4));
              const barY = isPos ? midY - barH : midY;
              return (
                <rect
                  key={offsetX}
                  x={baseX + offsetX}
                  y={barY}
                  width={barW}
                  height={barH}
                  fill={isPos ? colorPos : colorNeg}
                  opacity={i === n - 1 ? 1 : 0.65}
                />
              );
            };

            return (
              <g key={d.date}>
                {drawBar(d.foreignNet, 0.1,  'rgba(96,165,250,0.85)',  'rgba(96,165,250,0.35)')}
                {drawBar(d.trustNet,   1.3,  'rgba(251,146,60,0.85)', 'rgba(251,146,60,0.35)')}
                {drawBar(d.dealerNet,  2.5,  'rgba(167,139,250,0.85)','rgba(167,139,250,0.35)')}
              </g>
            );
          })}
        </svg>
      </div>

      {/* X 軸日期標籤（隔 5 天顯示一個） */}
      <div className="flex justify-between text-xs text-slate-500 mt-0.5 px-0.5">
        {recent.map((d, i) => (
          i % 5 === 0 || i === n - 1
            ? <span key={d.date} style={{ minWidth: 0 }}>{d.date.slice(5)}</span>
            : <span key={d.date} />
        ))}
      </div>
    </div>
  );
}

// ── 主元件 ─────────────────────────────────────────────────────────
export default function ChipAnalysis({ symbol, market }: Props) {
  const [days, setDays] = useState<ChipDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'overview' | 'history'>('overview');

  useEffect(() => {
    if (market !== 'TW') { setLoading(false); return; }
    setLoading(true);
    chipsApi.get(symbol, 60)
      .then(res => setDays(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [symbol, market]);

  if (market !== 'TW') {
    return (
      <div className="glass-card rounded-lg p-5 text-sm text-slate-500 text-center">
        籌碼分析（三大法人）目前僅支援台股
      </div>
    );
  }

  if (loading) {
    return (
      <div className="glass-card rounded-lg p-5">
        <div className="h-5 rounded w-1/3 mb-4 animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
        <div className="h-3 rounded w-full mb-2 animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="h-3 rounded w-4/5 mb-2 animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="h-3 rounded w-3/5 animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <p className="text-xs text-slate-500 mt-4">正在向證交所取得三大法人資料，約需 5–15 秒…</p>
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <div className="glass-card rounded-lg p-5 text-sm text-slate-500 text-center">
        無法取得籌碼資料<br />
        <span className="text-xs">（盤中尚未更新，或該股非交易所上市）</span>
      </div>
    );
  }

  // ── 計算邏輯 ──
  const recent = days.slice(-10);
  const fSum = recent.reduce((a, b) => a + b.foreignNet, 0);
  const tSum = recent.reduce((a, b) => a + b.trustNet, 0);
  const dSum = recent.reduce((a, b) => a + b.dealerNet, 0);

  const players = [
    { name: '外資',  sum: fSum, role: '長線法人', desc: '通常持股期長，為市場主要定價者',  color: '#60a5fa' },
    { name: '投信',  sum: tSum, role: '中期布局', desc: '按基金策略操作，布局週期數週至數月', color: '#fb923c' },
    { name: '自營商', sum: dSum, role: '短進短出', desc: '以套利為主，單日進出，方向不具持久性', color: '#a78bfa' },
  ].sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum));

  const today = days[days.length - 1];
  const todayTotal = (today?.foreignNet ?? 0) + (today?.trustNet ?? 0) + (today?.dealerNet ?? 0);
  const todayPos = todayTotal >= 0;

  // 歷史 tab 使用的舊式明細表（保留）
  const recentDays = days.slice(-10);
  const totalForeign = recentDays.reduce((s, d) => s + d.foreignNet, 0);
  const totalTrust   = recentDays.reduce((s, d) => s + d.trustNet, 0);
  const totalDealer  = recentDays.reduce((s, d) => s + d.dealerNet, 0);
  const totalAll     = totalForeign + totalTrust + totalDealer;

  const rankBadge = (i: number) => {
    if (i === 0) return <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.25)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.4)' }}>主力</span>;
    if (i === 1) return <span className="text-xs px-1.5 py-0.5 rounded text-slate-400" style={{ background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.2)' }}>#2</span>;
    return <span className="text-xs px-1.5 py-0.5 rounded text-slate-500" style={{ background: 'rgba(100,116,139,0.1)' }}>#3</span>;
  };

  return (
    <div className="glass-card rounded-lg overflow-hidden">
      {/* 標題列 + Tab */}
      <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between glass-header">
        <h3 className="text-sm font-bold text-slate-200 tracking-widest uppercase">籌碼分析</h3>
        <div className="flex gap-1">
          {(['overview', 'history'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="px-2.5 py-0.5 rounded text-xs font-medium transition-all"
              style={view === v
                ? { background: 'rgba(96,165,250,0.15)', color: '#93c5fd', border: '1px solid rgba(96,165,250,0.35)' }
                : { background: 'transparent', color: '#64748b', border: '1px solid transparent' }}
            >
              {v === 'overview' ? '近期概覽' : '歷史走勢'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {view === 'overview' ? (
          <>
            {/* ── Section A：今日走向卡 ── */}
            <div className="rounded-lg p-4 mb-4" style={{
              background: todayPos ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
              border: `1px solid ${todayPos ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.25)'}`,
            }}>
              <div className="section-label mb-2">今日三大法人合計</div>
              <div className="flex items-center gap-3 mb-3">
                <span className={`text-4xl font-bold ${todayPos ? 'text-red-400' : 'text-green-400'}`}>
                  {todayPos ? '▲' : '▼'}
                </span>
                <span className={`text-2xl font-bold tabular ${todayPos ? 'text-red-400' : 'text-green-400'}`}>
                  {todayPos ? '+' : ''}{todayTotal.toLocaleString()} 張
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: '外資', val: today?.foreignNet ?? 0 },
                  { label: '投信', val: today?.trustNet ?? 0 },
                  { label: '自營', val: today?.dealerNet ?? 0 },
                ].map(item => (
                  <div key={item.label} className="text-center rounded py-1.5" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-xs text-slate-500 mb-0.5">{item.label}</div>
                    <div className={`text-sm font-bold tabular ${item.val >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {item.val >= 0 ? '+' : ''}{item.val.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Section B：10 日主力排行 ── */}
            <div className="section-label mb-2">近 10 日主力排行</div>
            <div className="space-y-2 mb-4">
              {players.map((p, i) => (
                <div key={p.name} className={`rounded-lg px-3 py-2.5 flex items-center gap-3 ${i === 0 ? 'ring-1' : ''}`}
                  style={{
                    background: i === 0 ? 'rgba(245,158,11,0.06)' : 'rgba(255,255,255,0.03)',
                    ringColor: i === 0 ? 'rgba(245,158,11,0.3)' : undefined,
                    border: i === 0 ? '1px solid rgba(245,158,11,0.25)' : '1px solid rgba(255,255,255,0.08)',
                  }}>
                  <div className="shrink-0">{rankBadge(i)}</div>
                  <div className="w-2 h-8 rounded-full shrink-0" style={{ background: p.color, opacity: 0.7 }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${i === 0 ? 'text-slate-100' : 'text-slate-300'} text-sm`}>{p.name}</span>
                      <span className="text-xs text-slate-500">{p.role}</span>
                    </div>
                    <div className="text-xs text-slate-500 truncate">{p.desc}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`font-bold tabular text-sm ${p.sum >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {p.sum >= 0 ? '+' : ''}{p.sum.toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-500">張</div>
                  </div>
                </div>
              ))}
            </div>

            {/* ── 白話解讀 ── */}
            {(() => {
              const commentary = generateCommentary(fSum, tSum, dSum, recent.length);
              return (
                <div className="rounded px-3 py-2.5 mb-4" style={{ background: 'rgba(148,163,184,0.07)', border: '1px solid rgba(148,163,184,0.15)' }}>
                  <div className="section-label mb-1">籌碼解讀</div>
                  <p className="text-xs text-slate-300 leading-relaxed">{commentary}</p>
                </div>
              );
            })()}

            {/* ── Section C：分組 SVG 長條圖 ── */}
            <GroupedBarChart days={days} />

            {/* 10 日合計 */}
            <div className="flex justify-between items-center py-2 mt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">近 10 日三方合計</span>
              <span className={`text-base font-bold tabular ${totalAll >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                {totalAll >= 0 ? '+' : ''}{totalAll.toLocaleString()} 張
              </span>
            </div>
          </>
        ) : (
          /* ── 歷史走勢 Tab（保留原始）── */
          <>
            <ForeignHistoryChart days={days} />

            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="section-label">投信近 {days.length} 日買賣超</span>
                <div className="flex items-center gap-1.5">
                  <span className="section-label">今日</span>
                  {(() => {
                    const v = days[days.length - 1].trustNet;
                    const isPos = v >= 0;
                    return <span className={`text-xs font-bold tabular ${isPos ? 'text-red-400' : 'text-green-400'}`}>{isPos ? '+' : ''}{v.toLocaleString()} 張</span>;
                  })()}
                </div>
              </div>
              {(() => {
                const trustMax = Math.max(...days.map(d => Math.abs(d.trustNet)), 1);
                const n = days.length;
                const chartH = 48;
                const midY = chartH / 2;
                return (
                  <div className="rounded overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }}>
                    <svg width="100%" height={chartH} preserveAspectRatio="none" viewBox={`0 0 ${n} ${chartH}`}>
                      <line x1="0" y1={midY} x2={n} y2={midY} stroke="rgba(255,255,255,0.15)" strokeWidth="0.3" />
                      {days.map((d, i) => {
                        const isPos = d.trustNet >= 0;
                        const isLatest = i === n - 1;
                        const barH = Math.max(0.5, (Math.abs(d.trustNet) / trustMax) * (midY - 2));
                        const barY = isPos ? midY - barH : midY;
                        const alpha = isLatest ? 0.9 : 0.45;
                        return (
                          <rect key={d.date} x={i + 0.1} y={barY} width={0.8} height={barH}
                            fill={isPos ? `rgba(251,191,36,${alpha})` : `rgba(74,222,128,${alpha})`} />
                        );
                      })}
                    </svg>
                  </div>
                );
              })()}
            </div>

            {/* 每日明細表（近 10 天） */}
            <div className="mt-4">
              <div className="section-label mb-2">近 10 日每日明細</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <th className="text-left pb-1.5">日期</th>
                      <th className="text-right pb-1.5">外資</th>
                      <th className="text-right pb-1.5">投信</th>
                      <th className="text-right pb-1.5">自營</th>
                      <th className="text-right pb-1.5">合計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDays.map((d, i) => {
                      const sum = d.foreignNet + d.trustNet + d.dealerNet;
                      const isToday = i === recentDays.length - 1;
                      const cell = (v: number) => (
                        <span className={`tabular ${v > 0 ? 'text-red-400' : v < 0 ? 'text-green-400' : 'text-slate-600'}`}>
                          {v > 0 ? '+' : ''}{v.toLocaleString()}
                        </span>
                      );
                      return (
                        <tr key={d.date} className="glass-hover"
                          style={{
                            borderTop: '1px solid rgba(255,255,255,0.07)',
                            background: isToday ? 'rgba(96,165,250,0.08)' : undefined,
                          }}>
                          <td className={`py-1.5 ${isToday ? 'text-blue-300 font-semibold' : 'text-slate-500'}`}>
                            {d.date.slice(5)}{isToday && <span className="ml-1 text-xs text-blue-400/70">今</span>}
                          </td>
                          <td className="py-1.5 text-right">{cell(d.foreignNet)}</td>
                          <td className="py-1.5 text-right">{cell(d.trustNet)}</td>
                          <td className="py-1.5 text-right">{cell(d.dealerNet)}</td>
                          <td className="py-1.5 text-right font-semibold">{cell(sum)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-xs text-slate-500 mt-3">單位：張 · 資料來源：台灣證券交易所</p>
          </>
        )}

        <p className="text-xs text-slate-500 mt-2">單位：張（1張 = 1000股）· 台灣證券交易所</p>
      </div>
    </div>
  );
}
