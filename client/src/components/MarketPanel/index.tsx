import { useState, useEffect, useCallback } from 'react';
import { quotesApi } from '../../services/api';
import type { QuoteData } from '../../types';

// ── 要顯示的市場指標（含分組）─────────────────────────────────────────────────
const MARKET_INDICES = [
  { symbol: '^VIX',    name: 'VIX',        note: '恐慌指數', group: 'vix'        },
  { symbol: '^TWII',   name: '台灣加權',   note: 'TAIEX',    group: '台股'       },
  { symbol: '^GSPC',   name: 'S&P 500',    note: '美股大盤', group: '美股'       },
  { symbol: '^IXIC',   name: 'NASDAQ',     note: '科技指數', group: '美股'       },
  { symbol: '^SOX',    name: '費城半導體', note: 'SOX',      group: '美股'       },
  { symbol: '^DJI',    name: '道瓊',       note: '藍籌指數', group: '美股'       },
  { symbol: 'GC=F',    name: '黃金',       note: '期貨',     group: '商品'       },
  { symbol: 'CL=F',    name: '原油 WTI',   note: '期貨',     group: '商品'       },
  { symbol: 'BTC-USD', name: 'Bitcoin',    note: 'USD',      group: '商品'       },
];

// ── VIX 恐慌等級說明 ─────────────────────────────────────────────────────────
function vixLevel(v: number): { text: string; cls: string; barPct: number } {
  const barPct = Math.min(100, (v / 50) * 100);
  if (v >= 40) return { text: '極度恐慌', cls: 'text-red-400 font-bold',     barPct };
  if (v >= 30) return { text: '高度恐慌', cls: 'text-red-400 font-semibold', barPct };
  if (v >= 20) return { text: '市場不安', cls: 'text-amber-400',             barPct };
  if (v >= 15) return { text: '正常波動', cls: 'text-slate-400',             barPct };
  return              { text: '市場平靜', cls: 'text-green-400',             barPct };
}

// ── 價格格式化：按商品自動選精度 ──────────────────────────────────────────────
function fmtPrice(price: number, symbol: string): string {
  if (symbol === 'BTC-USD')  return `$${Math.round(price).toLocaleString()}`;
  if (price >= 10000)        return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (price >= 1000)         return price.toFixed(1);
  if (price >= 100)          return price.toFixed(2);
  return price.toFixed(2);
}

// ── 主元件 ───────────────────────────────────────────────────────────────────
export default function MarketPanel() {
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState('');

  const fetchAll = useCallback(async () => {
    const results = await Promise.allSettled(
      MARKET_INDICES.map(idx =>
        quotesApi.getQuote(idx.symbol, 'US').then(r => ({ symbol: idx.symbol, data: r.data }))
      )
    );
    const next: Record<string, QuoteData> = {};
    for (const r of results) {
      if (r.status === 'fulfilled' && (r.value.data?.close ?? 0) > 0) {
        next[r.value.symbol] = r.value.data;
      }
    }
    setQuotes(next);
    setUpdatedAt(new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const timer = setInterval(fetchAll, 90000); // 每 90 秒自動更新
    return () => clearInterval(timer);
  }, [fetchAll]);

  const vixQuote = quotes['^VIX'];
  const vixInfo  = vixQuote ? vixLevel(vixQuote.close) : null;

  return (
    <div className="glass-card rounded-lg overflow-hidden">
      {/* 標題 */}
      <div className="px-3 py-2.5 border-b border-white/10 flex justify-between items-center glass-header">
        <h3 className="text-sm font-bold text-slate-200 tracking-widest uppercase">國際市場</h3>
        {updatedAt && (
          <button
            onClick={fetchAll}
            className="text-xs text-slate-500 hover:text-blue-400 transition-colors"
            title="立即更新"
          >
            {updatedAt} ↻
          </button>
        )}
      </div>

      {loading ? (
        <div className="p-4 text-center text-slate-500 text-xs animate-pulse">載入中...</div>
      ) : (
        <>
          {/* VIX 恐慌表計 */}
          {vixQuote && vixInfo && (
            <div className="p-3 border-b border-white/10 card-accent-amber" style={{ paddingLeft: '12px' }}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="section-label mb-0.5">VIX 恐慌指數</div>
                  <div className="text-2xl font-bold text-slate-100 tabular">{vixQuote.close.toFixed(2)}</div>
                </div>
                <div className="text-right flex flex-col items-end gap-1">
                  <div className={`text-sm ${vixInfo.cls}`}>{vixInfo.text}</div>
                  {(() => {
                    const pct = vixQuote.changePercent ?? 0;
                    const badgeCls = pct > 0.05 ? 'badge-up' : pct < -0.05 ? 'badge-down' : 'badge-flat';
                    const prefix = pct > 0 ? '+' : '';
                    return <span className={badgeCls}>{prefix}{pct.toFixed(2)}%</span>;
                  })()}
                </div>
              </div>
              {/* 顏色量表：綠→黃→紅 */}
              <div className="relative h-2 rounded-full overflow-hidden bg-gradient-to-r from-green-500 via-yellow-400 to-red-500" style={{ opacity: 0.7 }}>
                <div
                  className="absolute top-1/2 w-3 h-3 bg-white rounded-full shadow-sm"
                  style={{
                    left: `${vixInfo.barPct}%`,
                    transform: 'translate(-50%, -50%)',
                    boxShadow: '0 0 6px rgba(255,255,255,0.8)',
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-600 mt-1">
                <span>平靜</span>
                <span>15</span>
                <span>20</span>
                <span>30</span>
                <span>40+</span>
              </div>
            </div>
          )}

          {/* 其他市場指標（按分組顯示） */}
          {(() => {
            const groups = ['台股', '美股', '商品'] as const;
            const nonVix = MARKET_INDICES.filter(idx => idx.symbol !== '^VIX');
            return groups.map(group => {
              const items = nonVix.filter(idx => idx.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group}>
                  {/* 分組標籤 */}
                  <div className="px-3 pt-2 pb-1">
                    <span className="section-label">{group}</span>
                  </div>
                  {items.map(idx => {
                    const q = quotes[idx.symbol];
                    const pct = q?.changePercent ?? 0;
                    const badgeCls = pct > 0.05 ? 'badge-up' : pct < -0.05 ? 'badge-down' : 'badge-flat';
                    const prefix = pct > 0 ? '+' : '';
                    return (
                      <div key={idx.symbol} className="px-3 py-2 flex justify-between items-center glass-hover border-t border-white/5">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-200 truncate">{idx.name}</div>
                          <div className="text-xs text-slate-600">{idx.note}</div>
                        </div>
                        <div className="text-right shrink-0 ml-2 flex flex-col items-end gap-0.5">
                          {q ? (
                            <>
                              <div className="text-xs font-semibold text-slate-100 tabular">{fmtPrice(q.close, idx.symbol)}</div>
                              <span className={badgeCls}>{prefix}{pct.toFixed(2)}%</span>
                            </>
                          ) : (
                            <div className="text-xs text-slate-700">—</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}

          {/* 恐慌指數說明 */}
          <div className="px-3 py-2 border-t border-white/10 glass-header">
            <div className="text-xs text-slate-600 leading-relaxed">
              VIX &lt;15 平靜 · 15-20 正常 · 20-30 不安 · 30-40 恐慌 · 40+ 極恐
            </div>
          </div>
        </>
      )}
    </div>
  );
}
