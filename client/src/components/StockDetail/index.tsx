import { useState, useEffect, useRef, useCallback, Component, type ReactNode } from 'react';
import { quotesApi } from '../../services/api';
import type { QuoteData, PriceData, StockSummaryData } from '../../types';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, ColorType } from 'lightweight-charts';
import ChipAnalysis from '../ChipAnalysis';

// ─── 週期設定：各週期永遠抓最大可用天數 ─────────────────────────────────────
const INTERVAL_CONFIG: Record<string, {
  label: string;
  defaultDays: number;
}> = {
  '1m':  { label: '1分',  defaultDays: 2     },  // Yahoo Finance 1分線：期貨限 2 天內
  '5m':  { label: '5分',  defaultDays: 60    },  // 最多 60 天
  '15m': { label: '15分', defaultDays: 60    },
  '30m': { label: '30分', defaultDays: 60    },
  '60m': { label: '60分', defaultDays: 730   },  // 最多 2 年
  '1d':  { label: '日線', defaultDays: 18250 },  // 50 年，Yahoo 給多少就顯示多少
  '1wk': { label: '週線', defaultDays: 18250 },  // 同上
  '1mo': { label: '月線', defaultDays: 18250 },  // 月K棒
  '1y':  { label: '年線', defaultDays: 18250 },  // 年K棒（後端以月線聚合）
};
type IntervalKey = keyof typeof INTERVAL_CONFIG;
type ChartType = 'candle' | 'line';

// ── Error Boundary：任何子元件崩潰時顯示友善錯誤，而非整頁空白 ──
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err: Error) {
    return { error: err.message };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="glass-card rounded-lg p-6 text-center border border-red-500/30">
          <div className="text-red-400 text-lg mb-2">⚠️ 顯示發生錯誤</div>
          <div className="text-sm text-slate-400 mb-3">
            此股票/商品的資料格式可能不支援，建議確認代號是否正確。
          </div>
          <details className="text-xs text-slate-500 text-left">
            <summary className="cursor-pointer">技術細節</summary>
            <pre className="mt-1 whitespace-pre-wrap text-slate-400">{this.state.error}</pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── K 線 / 折線圖組件 ─────────────────────────────────────────────────────
interface KLineChartProps {
  history: PriceData[];
  interval: IntervalKey;
  chartType: ChartType;
}

interface HoverData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  isUp: boolean;
}

function KLineChart({ history, interval, chartType }: KLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<ReturnType<typeof createChart> | null>(null);
  const lineSeriesRef = useRef<any>(null);
  const historyRef = useRef<PriceData[]>(history);
  const [visibleReturn, setVisibleReturn] = useState<{ pct: number; days: number } | null>(null);
  const [hoverData, setHoverData] = useState<HoverData | null>(null);

  // 同步最新 history 到 ref（讓 range-change 回調能存取最新資料）
  useEffect(() => { historyRef.current = history; }, [history]);

  const intraday = isIntradayInterval(interval);

  // 把 PriceData.date 轉為 lightweight-charts 可用的 time
  // 盤中資料加 8 小時偏移（UTC → 台灣時間），讓時間軸顯示台灣當地時間
  const toChartTime = (date: string): any =>
    intraday ? Math.floor(new Date(date).getTime() / 1000) + 8 * 3600 : date;

  // 把 chart time 值轉回毫秒，供比較
  const toMs = (t: any): number => {
    if (typeof t === 'number') return t * 1000;
    if (typeof t === 'string') return new Date(t).getTime();
    if (t && typeof t === 'object' && t.year)
      return new Date(t.year, (t.month ?? 1) - 1, t.day ?? 1).getTime();
    return 0;
  };

  useEffect(() => {
    if (!containerRef.current || history.length === 0) return;
    let chart: ReturnType<typeof createChart> | null = null;

    try {
      chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: '#0c1220' },
          textColor: '#94a3b8',
          fontSize: 11,
        },
        grid: {
          vertLines: { color: 'rgba(255,255,255,0.06)' },
          horzLines: { color: 'rgba(255,255,255,0.06)' },
        },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.12)' },
        timeScale: {
          borderColor: 'rgba(255,255,255,0.12)',
          timeVisible: intraday,
          secondsVisible: false,
        },
        // crosshair 時間軸標籤格式：依週期顯示不同格式
        // v5 API：localization.timeFormatter 同時處理「UTCTimestamp 數字（盤中）」和「BusinessDay 物件（日線以上）」
        localization: {
          timeFormatter: (time: any) => {
            if (typeof time === 'number') {
              // 盤中：chart time = UTC + 8h offset，直接用 UTC 方法讀取即為台灣時間
              const d = new Date(time * 1000);
              return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
            }
            // 日/週/月/年：BusinessDay 物件 {year, month, day} 或 'YYYY-MM-DD' 字串
            let yr: string, mo: string, dy: string;
            if (typeof time === 'string') {
              [yr, mo, dy] = time.split('-');
            } else if (time && time.year) {
              yr = String(time.year);
              mo = String(time.month ?? 1).padStart(2, '0');
              dy = String(time.day ?? 1).padStart(2, '0');
            } else {
              return '';
            }
            if (interval === '1d') {
              return `${yr}-${mo}-${dy}`;
            } else if (interval === '1wk') {
              const start = new Date(Number(yr), Number(mo) - 1, Number(dy));
              const end = new Date(start);
              end.setDate(end.getDate() + 6);
              const emo = String(end.getMonth() + 1).padStart(2, '0');
              const edy = String(end.getDate()).padStart(2, '0');
              return `${yr} ${mo}/${dy}~${emo}/${edy}`;
            } else if (interval === '1mo') {
              return `${yr}-${mo}`;
            } else if (interval === '1y') {
              return yr;
            }
            return `${yr}-${mo}-${dy}`;
          },
        },
        width: containerRef.current.clientWidth,
        height: 300,
      });

      // 過濾合理資料
      const valid = history.filter(
        d => d.open > 0 && d.close > 0 && isFinite(d.open) && isFinite(d.close)
      );

      let candleSeries: ReturnType<typeof chart.addSeries> | null = null;
      let volSeries:    ReturnType<typeof chart.addSeries> | null = null;

      if (chartType === 'candle') {
        // ── K 線圖 ──
        candleSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#ef4444', downColor: '#22c55e',
          borderUpColor: '#ef4444', borderDownColor: '#22c55e',
          wickUpColor: '#ef4444', wickDownColor: '#22c55e',
        });
        candleSeries.setData(valid.map(d => ({
          time: toChartTime(d.date),
          open:  d.open,
          high:  Math.max(d.high, d.open, d.close),
          low:   Math.min(d.low > 0 ? d.low : d.close, d.open, d.close),
          close: d.close,
        })));
        lineSeriesRef.current = null;
      } else {
        // ── 折線圖（初始顏色依整段報酬決定）──
        const firstClose = valid[0]?.close ?? 0;
        const lastClose  = valid[valid.length - 1]?.close ?? 0;
        const initColor  = lastClose >= firstClose ? '#ef4444' : '#22c55e';

        const ls = chart.addSeries(LineSeries, {
          color: initColor,
          lineWidth: 2,
          priceLineVisible: false,
        });
        ls.setData(valid.map(d => ({ time: toChartTime(d.date), value: d.close })));
        lineSeriesRef.current = ls;
      }

      // ── 成交量（K線模式才顯示，避免折線圖太雜）──
      if (chartType === 'candle') {
        volSeries = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' },
          priceScaleId: 'vol',
        });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        volSeries.setData(
          history
            .filter(d => d.volume > 0 && isFinite(d.volume))
            .map(d => ({
              time: toChartTime(d.date),
              value: d.volume,
              color: d.close >= d.open ? '#fca5a5' : '#86efac',
            }))
        );
      }

      chart.timeScale().fitContent();

      // 把 chart 實例存到 ref，讓 onMouseMove 可以存取
      chartRef.current = chart;

      // ── 縮放時計算可見區間總報酬 ──
      chart.timeScale().subscribeVisibleTimeRangeChange((range: any) => {
        if (!range?.from || !range?.to) { setVisibleReturn(null); return; }
        // 盤中時間軸加了 +8h 偏移顯示台灣時間；比對 history UTC 時間時要還原
        const tzOffset = intraday ? 8 * 3600 * 1000 : 0;
        const fromMs = toMs(range.from) - tzOffset;
        const toMs2  = toMs(range.to)   - tzOffset + (intraday ? 0 : 86400000);
        const visible = historyRef.current.filter(d => {
          const t = new Date(d.date).getTime();
          return t >= fromMs && t <= toMs2 && d.close > 0;
        });
        if (visible.length < 2) { setVisibleReturn(null); return; }

        const startPrice = visible[0].close;
        const endPrice   = visible[visible.length - 1].close;
        const pct = ((endPrice - startPrice) / startPrice) * 100;

        // 折線顏色動態切換
        if (lineSeriesRef.current) {
          lineSeriesRef.current.applyOptions({ color: pct >= 0 ? '#ef4444' : '#22c55e' });
        }

        setVisibleReturn({ pct, days: visible.length });
      });

    } catch (chartErr) {
      console.warn('K線圖初始化失敗:', chartErr);
      try { chart?.remove(); } catch {}
      return;
    }

    const handleResize = () => {
      if (containerRef.current && chart) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chartRef.current = null;
      setHoverData(null);
      try { chart?.remove(); } catch {}
    };
  }, [history, chartType, interval]);

  const isPositive = (visibleReturn?.pct ?? 0) >= 0;
  const fmt = (v: number) => {
    if (!v || !isFinite(v) || isNaN(v)) return '—';
    if (v >= 10000) return v.toFixed(0);
    if (v >= 1000)  return v.toFixed(1);
    if (v >= 100)   return v.toFixed(2);
    return v.toFixed(2);
  };

  return (
    <div className="w-full">
      {/* 資訊列：hover 時 OHLC，否則區間報酬 */}
      <div className="h-6 mb-1 px-1 flex items-center">
        {hoverData ? (
          <div className="flex items-center gap-3 text-xs tabular flex-wrap">
            <span className="text-slate-500 font-medium">{hoverData.time}</span>
            {hoverData.open > 0 && hoverData.open !== hoverData.close && (
              <>
                <span className="text-slate-500">開 <span className={hoverData.isUp ? 'text-red-400' : 'text-green-400'}>{fmt(hoverData.open)}</span></span>
                <span className="text-slate-500">高 <span className="text-red-300">{fmt(hoverData.high)}</span></span>
                <span className="text-slate-500">低 <span className="text-green-300">{fmt(hoverData.low)}</span></span>
              </>
            )}
            <span className="text-slate-500">收 <span className={`font-bold ${hoverData.isUp ? 'text-red-400' : 'text-green-400'}`}>{fmt(hoverData.close)}</span></span>
            {hoverData.volume && hoverData.volume > 0 && (
              <span className="text-slate-500">量 {hoverData.volume >= 1_000_000 ? `${(hoverData.volume/1_000_000).toFixed(1)}M` : hoverData.volume >= 1000 ? `${(hoverData.volume/1000).toFixed(0)}K` : hoverData.volume.toFixed(0)}</span>
            )}
          </div>
        ) : (visibleReturn !== null && isFinite(visibleReturn.pct)) ? (
          <div className={`flex items-center gap-2 text-sm font-semibold ${isPositive ? 'text-red-400' : 'text-green-400'}`}>
            <span>區間報酬</span>
            <span>{isPositive ? '+' : ''}{visibleReturn.pct.toFixed(2)}%</span>
            <span className="text-xs font-normal text-slate-500">
              ({visibleReturn.days} 根 {INTERVAL_CONFIG[interval]?.label ?? ''}線)
            </span>
          </div>
        ) : null}
      </div>
      <div
        ref={containerRef}
        className="w-full"
        onMouseMove={(e) => {
          const chartInst = chartRef.current;
          if (!chartInst || !containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const x = e.clientX - rect.left;
          let rawTime: any;
          try { rawTime = chartInst.timeScale().coordinateToTime(x); } catch { return; }
          if (rawTime == null) { setHoverData(null); return; }

          const t = rawTime;
          let timeStr = '';
          const hist = historyRef.current;
          let match: PriceData | null = null;

          if (typeof t === 'number') {
            // 盤中：chart time = UTC + 8h；還原成 UTC ms 比對 history
            const origMs = (t - 8 * 3600) * 1000;
            const dTW = new Date(t * 1000);
            timeStr = `${dTW.getUTCFullYear()}-${String(dTW.getUTCMonth()+1).padStart(2,'0')}-${String(dTW.getUTCDate()).padStart(2,'0')} ${String(dTW.getUTCHours()).padStart(2,'0')}:${String(dTW.getUTCMinutes()).padStart(2,'0')}`;
            let minDiff = Infinity;
            for (const d of hist) {
              const diff = Math.abs(new Date(d.date).getTime() - origMs);
              if (diff < minDiff) { minDiff = diff; match = d; }
              if (diff === 0) break;
            }
            if (minDiff > 3 * 60 * 1000) match = null; // 超過 3 分鐘就不顯示
          } else {
            // 日/週/月/年：t 是 BusinessDay 物件或 string
            let dateKey = '';
            if (typeof t === 'string') {
              dateKey = t.slice(0, 10);
            } else if (t && (t as any).year) {
              const td = t as any;
              dateKey = `${td.year}-${String(td.month).padStart(2,'0')}-${String(td.day).padStart(2,'0')}`;
            }
            if (!dateKey) { setHoverData(null); return; }

            // 依週期格式化顯示文字
            const [yr, mo, dy] = dateKey.split('-');
            if (interval === '1d') {
              timeStr = dateKey;
            } else if (interval === '1wk') {
              const start = new Date(dateKey);
              const end = new Date(start);
              end.setDate(end.getDate() + 6);
              timeStr = `${mo}/${dy} ~ ${String(end.getMonth()+1).padStart(2,'0')}/${String(end.getDate()).padStart(2,'0')}`;
            } else if (interval === '1mo') {
              timeStr = `${yr}-${mo}`;
            } else if (interval === '1y') {
              timeStr = yr;
            } else {
              timeStr = dateKey;
            }

            match = hist.find(d => d.date.slice(0, 10) === dateKey) ?? null;
          }

          if (match && match.close > 0) {
            setHoverData({ time: timeStr, open: match.open, high: match.high, low: match.low, close: match.close, volume: match.volume, isUp: match.close >= match.open });
          } else {
            setHoverData(null);
          }
        }}
        onMouseLeave={() => setHoverData(null)}
      />
    </div>
  );
}

function isIntradayInterval(interval: string): boolean {
  return ['1m','2m','5m','15m','30m','60m','90m','1h'].includes(interval);
}

// 趨勢標籤（深色玻璃版）
function TrendBadge({ trend }: { trend: StockSummaryData['technicals']['trend'] }) {
  const config: Record<string, { label: string; style: React.CSSProperties }> = {
    strong_up:   { label: '強勢多頭 ↑↑', style: { background: 'rgba(239,68,68,0.1)',   border: '1px solid rgba(239,68,68,0.35)',   color: '#dc2626' } },
    up:          { label: '偏多 ↑',       style: { background: 'rgba(251,146,60,0.1)',  border: '1px solid rgba(251,146,60,0.35)',  color: '#b45309' } },
    neutral:     { label: '盤整觀望',     style: { background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.3)', color: '#64748b' } },
    down:        { label: '偏空 ↓',       style: { background: 'rgba(20,184,166,0.1)',  border: '1px solid rgba(20,184,166,0.35)',  color: '#0d9488' } },
    strong_down: { label: '強勢空頭 ↓↓', style: { background: 'rgba(34,197,94,0.1)',   border: '1px solid rgba(34,197,94,0.35)',   color: '#16a34a' } },
  };
  const c = config[trend] ?? config.neutral;
  return (
    <span className="inline-block px-3 py-1 rounded-full text-sm font-semibold" style={c.style}>
      {c.label}
    </span>
  );
}

interface StockDetailProps {
  stock: { symbol: string; name: string; market: 'TW' | 'US' };
}

export default function StockDetail({ stock }: StockDetailProps) {
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [history, setHistory] = useState<PriceData[]>([]);
  const [summary, setSummary] = useState<StockSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // 圖表控制（預設 1 分線，讓使用者看到即時盤中走勢）
  const [interval, setIntervalKey] = useState<IntervalKey>('1m');
  const [chartType, setChartType] = useState<ChartType>('line');

  useEffect(() => {
    loadQuoteAndSummary();
  }, [stock.symbol]);

  // 切換週期時重新抓圖表資料（永遠抓該週期的最大天數）
  useEffect(() => {
    loadHistory(interval, INTERVAL_CONFIG[interval].defaultDays);
  }, [stock.symbol, interval]);

  const loadQuoteAndSummary = async () => {
    setLoading(true);
    try {
      const quoteRes = await quotesApi.getQuote(stock.symbol, stock.market);
      setQuote(quoteRes.data);
    } catch (error) {
      console.error('載入報價失敗:', error);
    } finally {
      setLoading(false);
    }
    // 摘要非同步，不擋住報價
    setSummaryLoading(true);
    quotesApi.getSummary(stock.symbol, stock.market)
      .then(r => setSummary(r.data))
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
  };

  const loadHistory = useCallback(async (iv: IntervalKey, d: number) => {
    setHistoryLoading(true);
    try {
      const res = await quotesApi.getHistory(stock.symbol, stock.market, d, iv);
      setHistory(res.data);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [stock.symbol, stock.market]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // 同時刷新報價 + 圖表，確保兩邊數字一致
      const [quoteRes] = await Promise.all([
        quotesApi.getQuote(stock.symbol, stock.market),
        loadHistory(interval, INTERVAL_CONFIG[interval].defaultDays),
      ]);
      setQuote(quoteRes.data);
    } catch {}
    finally {
      setRefreshing(false);
    }
  };

  const handleIntervalChange = (iv: IntervalKey) => {
    setIntervalKey(iv);
  };

  if (loading) {
    return (
      <div className="glass-card rounded-lg p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 rounded w-1/3" style={{ background: 'rgba(255,255,255,0.08)' }}></div>
          <div className="h-4 rounded w-1/2" style={{ background: 'rgba(255,255,255,0.07)' }}></div>
          <div className="h-4 rounded w-2/3" style={{ background: 'rgba(255,255,255,0.06)' }}></div>
        </div>
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="glass-card rounded-lg p-6 text-center text-slate-500">
        無法取得股票資料
      </div>
    );
  }

  const isPositive = (quote.change ?? 0) >= 0;

  return (
    <ErrorBoundary>
    <div className="space-y-6">
      {/* 股票標題與即時報價 */}
      <div className="glass-card rounded-lg p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-100">
              {stock.name}
            </h2>
            <p className="text-sm text-slate-500">
              <span className="tabular">{stock.symbol}</span>
              {' · '}
              {stock.market === 'TW' ? '台灣證券交易所' : '美國股市'}
            </p>
          </div>
          <div className="text-right flex flex-col items-end gap-1.5">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-3 py-1 text-xs rounded disabled:opacity-50 transition-colors text-slate-400 hover:text-slate-200"
              style={{ background: 'rgba(255,255,255,0.06)' }}
            >
              {refreshing ? '更新中...' : '🔄 刷新報價'}
            </button>
            {/* 大字體股價 + 呼吸燈 */}
            <div className="flex items-center gap-2">
              <span className="live-dot" />
              <span className="price-hero text-slate-100 tabular">
                {stock.market === 'TW' ? '' : '$'}{quote.close.toFixed(2)}
              </span>
            </div>
            {/* 漲跌幅 pill */}
            {(() => {
              if (quote.isMarketClosed) {
                return (
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(100,116,139,0.2)', color: '#94a3b8' }}>
                      昨收參考價 · 市場未開盤
                    </span>
                  </div>
                );
              }
              const pct = isFinite(quote.changePercent ?? NaN) ? (quote.changePercent ?? 0) : 0;
              const chg = isFinite(quote.change ?? NaN) ? (quote.change ?? 0) : 0;
              const badgeCls = pct > 0.05 ? 'badge-up' : pct < -0.05 ? 'badge-down' : 'badge-flat';
              const prefix = pct > 0 ? '+' : '';
              return (
                <div className="flex items-center gap-2">
                  <span className="text-sm tabular" style={{ color: pct > 0 ? '#dc2626' : pct < 0 ? '#16a34a' : '#64748b' }}>
                    {chg !== 0 ? `${prefix}${chg.toFixed(2)}` : '—'}
                  </span>
                  <span className={badgeCls}>{pct !== 0 ? `${prefix}${pct.toFixed(2)}%` : '—'}</span>
                </div>
              );
            })()}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-slate-500">開盤</div>
            <div className="font-semibold text-slate-200">{isFinite(quote.open) && quote.open > 0 ? quote.open.toFixed(2) : '—'}</div>
          </div>
          <div>
            <div className="text-slate-500">最高</div>
            <div className="font-semibold text-slate-200">{isFinite(quote.high) && quote.high > 0 ? quote.high.toFixed(2) : '—'}</div>
          </div>
          <div>
            <div className="text-slate-500">最低</div>
            <div className="font-semibold text-slate-200">{isFinite(quote.low) && quote.low > 0 ? quote.low.toFixed(2) : '—'}</div>
          </div>
          <div>
            <div className="text-slate-500">成交量</div>
            <div className="font-semibold text-slate-200">
              {quote.volume > 0
                ? stock.market === 'TW'
                  ? `${(quote.volume / 1000).toFixed(0)}K 張`
                  : `${(quote.volume / 1_000_000).toFixed(2)}M`
                : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* 分析摘要 */}
      <div className="glass-card rounded-lg p-6 card-accent-indigo" style={{ border: '1px solid rgba(99,102,241,0.25)' }}>
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-sm font-bold text-slate-200 tracking-widest uppercase">分析摘要</h3>
          <span className="section-label px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b' }}>AI</span>
          {summaryLoading && (
            <span className="text-xs text-slate-500 animate-pulse ml-auto">分析中...</span>
          )}
        </div>

        {summaryLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 rounded w-3/4" style={{ background: 'rgba(255,255,255,0.07)' }}></div>
            <div className="h-4 rounded w-full" style={{ background: 'rgba(255,255,255,0.06)' }}></div>
            <div className="h-4 rounded w-2/3" style={{ background: 'rgba(255,255,255,0.05)' }}></div>
          </div>
        ) : summary ? (
          <div className="space-y-5">
            {/* 趨勢判斷 */}
            <div className="flex items-center gap-3">
              <span className="section-label">趨勢判斷</span>
              <TrendBadge trend={summary.technicals.trend} />
            </div>

            {/* 技術指標數字 */}
            <div>
              <div className="section-label mb-2">技術指標</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'MA5',     value: summary.technicals.ma5.toFixed(1),   isRsi: false },
                  { label: 'MA20',    value: summary.technicals.ma20.toFixed(1),  isRsi: false },
                  { label: 'MA60',    value: summary.technicals.ma60.toFixed(1),  isRsi: false },
                  { label: 'RSI(14)', value: summary.technicals.rsi14.toFixed(0), isRsi: true  },
                ].map(item => {
                  const rsiVal = item.isRsi ? summary.technicals.rsi14 : 50;
                  const rsiBg = item.isRsi
                    ? rsiVal > 70
                      ? 'rgba(239,68,68,0.1)'
                      : rsiVal < 30
                        ? 'rgba(34,197,94,0.1)'
                        : 'rgba(255,255,255,0.05)'
                    : 'rgba(255,255,255,0.05)';
                  const rsiBorder = item.isRsi
                    ? rsiVal > 70
                      ? 'rgba(239,68,68,0.3)'
                      : rsiVal < 30
                        ? 'rgba(34,197,94,0.25)'
                        : 'rgba(255,255,255,0.08)'
                    : 'rgba(255,255,255,0.08)';
                  const rsiTextCls = item.isRsi
                    ? rsiVal > 70 ? 'text-red-300' : rsiVal < 30 ? 'text-green-300' : 'text-slate-200'
                    : 'text-slate-200';
                  return (
                    <div key={item.label} className="rounded-lg p-3 text-center" style={{ background: rsiBg, border: `1px solid ${rsiBorder}` }}>
                      <div className="text-xs text-slate-500">{item.label}</div>
                      <div className={`font-bold mt-1 tabular ${rsiTextCls}`}>{item.value}</div>
                      {item.isRsi && rsiVal > 70 && <div className="text-xs text-red-400 mt-0.5">超買區</div>}
                      {item.isRsi && rsiVal < 30 && <div className="text-xs text-green-400 mt-0.5">超賣區</div>}
                    </div>
                  );
                })}
              </div>

              {/* 成交量比 & 52週位置 */}
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="text-xs text-slate-500 mb-1">成交量 vs 均量</div>
                  <div className={`font-bold ${summary.technicals.volumeRatio > 1.5 ? 'text-red-400' : summary.technicals.volumeRatio < 0.7 ? 'text-slate-500' : 'text-slate-300'}`}>
                    {summary.technicals.volumeRatio.toFixed(2)} 倍
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {summary.technicals.volumeRatio > 2 ? '爆量！' : summary.technicals.volumeRatio > 1.5 ? '量增' : summary.technicals.volumeRatio < 0.7 ? '量縮' : '量平'}
                  </div>
                </div>
                <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="text-xs text-slate-500 mb-1">52週位置</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-full h-2" style={{ background: 'rgba(255,255,255,0.1)' }}>
                      <div
                        className="bg-slate-400 h-2 rounded-full"
                        style={{ width: `${summary.technicals.week52Position}%` }}
                      ></div>
                    </div>
                    <span className="text-xs font-bold text-slate-300">
                      {summary.technicals.week52Position.toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 mt-0.5">
                    <span>低 {(summary.technicals.week52Low ?? 0).toFixed(1)}</span>
                    <span>高 {(summary.technicals.week52High ?? 0).toFixed(1)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 關鍵訊號 */}
            {summary.technicals.signals.length > 0 && (
              <div>
                <div className="section-label mb-2">關鍵訊號</div>
                <ul className="space-y-1">
                  {summary.technicals.signals.slice(0, 4).map((s, i) => (
                    <li key={i} className="text-sm text-slate-400 flex items-start gap-1.5">
                      <span className="text-slate-500 mt-0.5 shrink-0">▸</span> {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 基本面 */}
            {(() => {
              // 同業比較基準（hardcode 市場均值）
              const BENCH = {
                TW: { pe: 15, pb: 1.8, yield: 3.0, gross: 35, op: 12 },
                US: { pe: 25, pb: 4.5, yield: 1.5, gross: 50, op: 18 },
              };
              const bench = BENCH[summary.market as 'TW' | 'US'] ?? BENCH.TW;
              const f = summary.fundamentals;

              // 評估邏輯
              const evalPE = (val?: number) => {
                if (!val) return null;
                if (val < bench.pe) return { icon: '✅', text: '低於均值', color: '#16a34a' };
                if (val > bench.pe * 1.5) return { icon: '⚠️', text: '高於均值', color: '#c2410c' };
                return { icon: '—', text: '接近均值', color: '#64748b' };
              };
              const evalPB = (val?: number) => {
                if (!val) return null;
                if (val < bench.pb) return { icon: '✅', text: '低於均值', color: '#16a34a' };
                if (val > bench.pb * 1.5) return { icon: '⚠️', text: '高於均值', color: '#c2410c' };
                return { icon: '—', text: '接近均值', color: '#64748b' };
              };
              const evalYield = (val?: number) => {
                if (!val) return null;
                if (val > bench.yield) return { icon: '✅', text: '高息', color: '#16a34a' };
                return { icon: '—', text: '低於均值', color: '#64748b' };
              };
              const evalMargin = (val: number | undefined, benchVal: number) => {
                if (!val) return null;
                if (val > benchVal * 1.3) return { icon: '✅', text: '顯著優於均', color: '#16a34a' };
                if (val > benchVal) return { icon: '✅', text: '優於均值', color: '#16a34a' };
                return { icon: '—', text: '低於均值', color: '#64748b' };
              };

              const rows: Array<{
                label: string;
                stock: string;
                market: string;
                eval: { icon: string; text: string; color: string } | null;
              }> = [
                f.pe ? {
                  label: '本益比',
                  stock: `${f.pe.toFixed(1)}x`,
                  market: `~${bench.pe}x`,
                  eval: evalPE(f.pe),
                } : null,
                f.pb ? {
                  label: '股價淨值比',
                  stock: `${f.pb.toFixed(1)}x`,
                  market: `~${bench.pb}x`,
                  eval: evalPB(f.pb),
                } : null,
                f.dividendYield ? {
                  label: '殖利率',
                  stock: `${f.dividendYield.toFixed(2)}%`,
                  market: `~${bench.yield}%`,
                  eval: evalYield(f.dividendYield),
                } : null,
                f.latestGrossMargin ? {
                  label: '毛利率',
                  stock: `${f.latestGrossMargin.toFixed(1)}%`,
                  market: `~${bench.gross}%`,
                  eval: evalMargin(f.latestGrossMargin, bench.gross),
                } : null,
                f.latestOperatingMargin ? {
                  label: '營業利益率',
                  stock: `${f.latestOperatingMargin.toFixed(1)}%`,
                  market: `~${bench.op}%`,
                  eval: evalMargin(f.latestOperatingMargin, bench.op),
                } : null,
              ].filter(Boolean) as Array<{
                label: string; stock: string; market: string;
                eval: { icon: string; text: string; color: string } | null;
              }>;

              return (
            <div>
              <div className="section-label mb-2">基本面</div>

              {/* 基本面懶人包（AI 分析文字） */}
              {f.analysis && (
                <div className="rounded p-3 mb-4" style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}>
                  <div className="section-label mb-1">📋 基本面懶人包</div>
                  <p className="text-sm text-slate-300 leading-relaxed">{f.analysis}</p>
                </div>
              )}

              {/* 同業比較表格 */}
              {rows.length > 0 && (
                <div className="mb-4">
                  <div className="section-label mb-2">同業比較</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-500" style={{ borderBottom: '1px solid rgba(255,255,255,0.09)' }}>
                          <th className="text-left pb-1.5 pr-2">指標</th>
                          <th className="text-right pb-1.5 pr-2">本股</th>
                          <th className="text-right pb-1.5 pr-2">市場均值</th>
                          <th className="text-right pb-1.5">評估</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(row => (
                          <tr key={row.label} style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                            <td className="py-1.5 pr-2 text-slate-400">{row.label}</td>
                            <td className="py-1.5 pr-2 text-right font-semibold text-slate-200 tabular">{row.stock}</td>
                            <td className="py-1.5 pr-2 text-right text-slate-500 tabular">{row.market}</td>
                            <td className="py-1.5 text-right">
                              {row.eval && (
                                <span className="font-medium" style={{ color: row.eval.color }}>
                                  {row.eval.icon} {row.eval.text}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 月營收趨勢（台股） */}
              {f.monthlyRevenue.length > 0 && (
                <div className="mb-4">
                  <div className="section-label mb-2">近期月營收（億元）</div>
                  <div className="space-y-1">
                    {f.monthlyRevenue.map((m, i) => {
                      const isLatest = i === f.monthlyRevenue.length - 1;
                      const isUp = (m.yoyGrowth ?? 0) >= 0;
                      return (
                        <div key={m.yearMonth}
                          className={`flex items-center gap-2 text-xs ${isLatest ? 'font-semibold' : ''}`}>
                          <span className="text-slate-500 w-14">{m.yearMonth}</span>
                          <div className="flex-1 rounded-full h-2 relative overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                            <div
                              className="h-2 rounded-full bg-slate-400"
                              style={{
                                width: `${Math.min(100, (m.revenue / (f.monthlyRevenue.reduce((a, b) => Math.max(a, b.revenue), 0) || 1)) * 100)}%`,
                                opacity: 0.7,
                              }}
                            />
                          </div>
                          <span className="text-slate-300 w-12 text-right">{m.revenue.toLocaleString()}</span>
                          {m.yoyGrowth !== undefined && (
                            <span className={`w-16 text-right ${isUp ? 'text-red-400' : 'text-green-400'}`}>
                              {isUp ? '▲' : '▼'} {Math.abs(m.yoyGrowth).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">右側數字為 YoY 年增率</div>
                </div>
              )}

              {/* 季度財報（EPS + 毛利率） */}
              {f.quarterlyData.length > 0 && (
                <div>
                  <div className="section-label mb-2">
                    近期季報（{stock.market === 'TW' ? 'EPS 元' : 'EPS $'}）
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-500">
                          <th className="text-left py-1 pr-3">季度</th>
                          <th className="text-right py-1 pr-3">EPS</th>
                          {summary.market === 'TW' && <th className="text-right py-1 pr-3">營收(億)</th>}
                          {summary.market === 'US' && <th className="text-right py-1 pr-3">營收($B)</th>}
                          {f.quarterlyData.some(q => q.grossMargin) && (
                            <th className="text-right py-1">毛利率</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {f.quarterlyData.map((q, i) => {
                          const isLatest = i === f.quarterlyData.length - 1;
                          const prevEps = i > 0 ? f.quarterlyData[i - 1].eps : undefined;
                          const epsUp = q.eps !== undefined && prevEps !== undefined ? q.eps > prevEps : undefined;
                          return (
                            <tr key={q.period} className={`${isLatest ? 'font-semibold' : ''}`}
                              style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: isLatest ? 'rgba(96,165,250,0.08)' : '' }}>
                              <td className="py-1.5 pr-3 text-slate-400">{q.period}</td>
                              <td className="py-1.5 pr-3 text-right">
                                {q.eps !== undefined ? (
                                  <span className={epsUp === true ? 'text-red-400' : epsUp === false ? 'text-green-400' : 'text-slate-300'}>
                                    {epsUp === true && '▲ '}{epsUp === false && '▼ '}
                                    {stock.market === 'TW' ? q.eps.toFixed(2) : `$${q.eps.toFixed(2)}`}
                                  </span>
                                ) : '-'}
                              </td>
                              <td className="py-1.5 pr-3 text-right text-slate-400">
                                {q.revenue !== undefined ? q.revenue.toLocaleString() : '-'}
                              </td>
                              {f.quarterlyData.some(qd => qd.grossMargin) && (
                                <td className="py-1.5 text-right text-slate-400">
                                  {q.grossMargin !== undefined ? `${q.grossMargin.toFixed(1)}%` : '-'}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
              );
            })()}

            {/* 最新消息 */}
            {summary.news.length > 0 && (() => {
              const text = summary.news.map(n => n.title).join(' ');
              const themes: string[] = [];
              if (/聯準會|Fed|升息|降息|利率|FOMC/i.test(text))               themes.push('Fed 利率');
              if (/財報|EPS|盈餘|earnings|revenue|獲利/i.test(text))            themes.push('財報');
              if (/AI|人工智慧|晶片|chip|半導體|semiconductor/i.test(text))     themes.push('AI/半導體');
              if (/CPI|通膨|inflation/i.test(text))                              themes.push('通膨');
              if (/關稅|tariff|貿易|trade war|制裁/i.test(text))                themes.push('貿易政策');
              if (/黃金|gold|原油|oil|銀|silver/i.test(text))                   themes.push('商品');
              if (/裁員|倒閉|破產|訴訟|罰款/i.test(text))                       themes.push('風險');
              if (/新品|launch|acquisition|合作|buyback|回購/i.test(text))       themes.push('企業動態');
              return (
                <div>
                  <div className="section-label mb-2">近期消息</div>

                  {/* 新聞摘要（AI 產生） */}
                  {summary.newsDigest && (
                    <div className="rounded px-3 py-2.5 mb-3" style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)' }}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="section-label">摘要</span>
                        <span className="text-xs text-slate-500">來源：Yahoo Finance · {summary.news.length} 則</span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{summary.newsDigest}</p>
                    </div>
                  )}

                  {/* 主題標籤 */}
                  {themes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {themes.map((t, i) => (
                        <span key={i} className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.25)', color: '#64748b' }}>{t}</span>
                      ))}
                    </div>
                  )}

                  {/* 新聞清單 */}
                  <ul className="space-y-2">
                    {summary.news.slice(0, 5).map((n, i) => (
                      <li key={i} className="text-sm">
                        {n.url ? (
                          <a href={n.url} target="_blank" rel="noopener noreferrer"
                            className="text-slate-300 hover:text-slate-100 hover:underline line-clamp-2 leading-snug">
                            {n.title}
                          </a>
                        ) : (
                          <span className="text-slate-400">{n.title}</span>
                        )}
                        <div className="text-xs text-slate-500 mt-0.5">
                          {(n as any).publisher && <span>{(n as any).publisher} · </span>}
                          {n.publishTime}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </div>
        ) : (
          /* fallback：摘要載入失敗時用基本報價判斷 */
          <div className="space-y-3">
            <div>
              <div className="section-label mb-1">趨勢判斷</div>
              <div className="text-slate-400">{isPositive ? '今日上漲' : '今日下跌'}</div>
            </div>
            <div>
              <div className="section-label mb-1">關鍵數據</div>
              <div className="space-y-1 text-sm text-slate-400">
                <div>• 漲跌幅: {quote.changePercent?.toFixed(2)}%</div>
                <div>• 振幅: {(((quote.high - quote.low) / quote.previousClose) * 100).toFixed(2)}%</div>
              </div>
            </div>
            <p className="text-xs text-slate-500">詳細 AI 分析暫時不可用</p>
          </div>
        )}
      </div>

      {/* K 線圖區塊 */}
      <div className="glass-card rounded-lg p-4 card-accent-blue">
        {/* ── 控制列 ── */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {/* 週期按鈕 */}
          <div className="flex gap-1 flex-wrap">
            {(Object.keys(INTERVAL_CONFIG) as IntervalKey[]).map(iv => (
              <button
                key={iv}
                onClick={() => handleIntervalChange(iv)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  interval === iv
                    ? 'text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                style={interval === iv
                  ? { background: 'rgba(59,130,246,0.7)' }
                  : { background: 'rgba(255,255,255,0.07)' }}
              >
                {INTERVAL_CONFIG[iv].label}
              </button>
            ))}
          </div>

          {/* 分隔 */}
          <div className="w-px h-5" style={{ background: 'rgba(255,255,255,0.12)' }} />

          {/* 圖型切換 */}
          <div className="flex gap-1 ml-auto">
            <button
              onClick={() => setChartType('candle')}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                chartType === 'candle' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              style={chartType === 'candle'
                ? { background: 'rgba(100,116,139,0.6)' }
                : { background: 'rgba(255,255,255,0.07)' }}
            >
              K線
            </button>
            <button
              onClick={() => setChartType('line')}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                chartType === 'line' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              style={chartType === 'line'
                ? { background: 'rgba(100,116,139,0.6)' }
                : { background: 'rgba(255,255,255,0.07)' }}
            >
              折線
            </button>
          </div>
        </div>

        {/* 圖表主體 */}
        {historyLoading ? (
          <div className="h-[300px] flex items-center justify-center text-slate-500 text-sm">
            載入圖表資料中...
          </div>
        ) : history.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-center text-slate-500 text-sm px-4">
            <div>
              此週期目前無資料<br />
              <span className="text-xs text-slate-600">
                {['1m','5m','15m','30m','60m'].includes(interval)
                  ? '分線資料僅在交易時段可取得，請於開盤時間重試'
                  : '請確認代號是否正確，或嘗試其他週期'}
              </span>
            </div>
          </div>
        ) : (
          <KLineChart history={history} interval={interval} chartType={chartType} />
        )}

        <div className="flex justify-between text-xs text-slate-500 mt-2">
          <span>滑鼠滾輪縮放 · 拖曳平移 · 縮放後顯示區間報酬</span>
          {chartType === 'candle' && (
            <span>
              <span className="text-red-400">■</span> 紅K上漲
              <span className="text-green-400 ml-2">■</span> 綠K下跌（台灣慣例）
            </span>
          )}
          {chartType === 'line' && (
            <span className="text-slate-500">折線顏色：正報酬紅、負報酬綠</span>
          )}
        </div>
      </div>

      {/* 籌碼分析（三大法人，台股限定） */}
      <ChipAnalysis symbol={stock.symbol} market={stock.market} />
    </div>
    </ErrorBoundary>
  );
}
