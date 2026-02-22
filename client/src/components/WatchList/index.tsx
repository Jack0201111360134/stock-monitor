import { useState, useEffect, useRef, useCallback } from 'react';
import { watchlistApi, quotesApi, chipsApi } from '../../services/api';
import type { WatchlistItem } from '../../types';

interface WatchListProps {
  onSelectStock: (stock: { symbol: string; name: string; market: 'TW' | 'US' }) => void;
}

interface NewsItem {
  title: string;
  url: string;
  publishTime: string;
}

// 從新聞標題自動產生懶人包摘要 + 評價
function buildNewsDigest(news: NewsItem[]): {
  themes: string[];
  oneLine: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentLabel: string;
} {
  if (news.length === 0) return { themes: [], oneLine: '', sentiment: 'neutral', sentimentLabel: '⚪ 訊號中性' };
  const text = news.map(n => n.title).join(' ');

  const themes: string[] = [];
  if (/漲|創高|突破|強勢|買超|看多|反彈|升|bull|rise|gain|high/i.test(text))   themes.push('📈 多方');
  if (/跌|下跌|回落|賣超|看空|警告|跌破|bear|fall|drop|loss|down/i.test(text)) themes.push('📉 空方');
  if (/聯準會|Fed|升息|降息|利率|央行|FOMC/i.test(text))                       themes.push('🏦 貨幣政策');
  if (/財報|EPS|盈餘|earnings|revenue|獲利/i.test(text))                        themes.push('📊 財報');
  if (/CPI|通膨|通貨膨脹|inflation/i.test(text))                               themes.push('💹 通膨');
  if (/黃金|白銀|gold|silver|原油|oil|銅|copper/i.test(text))                  themes.push('🪙 商品');
  if (/裁員|倒閉|破產|訴訟|罰款/i.test(text))                                  themes.push('⚠️ 風險');

  // 評價：計算多空關鍵字出現次數
  const bullCount = (text.match(/漲|創高|突破|強勢|買超|看多|反彈|bull|rise|gain/gi) || []).length;
  const bearCount = (text.match(/跌|下跌|回落|賣超|看空|警告|跌破|bear|fall|drop|loss/gi) || []).length;
  const sentiment: 'bullish' | 'bearish' | 'neutral' =
    bullCount > bearCount + 1 ? 'bullish' :
    bearCount > bullCount + 1 ? 'bearish' : 'neutral';
  const sentimentLabel =
    sentiment === 'bullish' ? '🟢 整體偏多' :
    sentiment === 'bearish' ? '🔴 整體偏空' : '⚪ 訊號中性';

  const first = news[0].title;
  const oneLine = first.length > 44 ? first.slice(0, 44) + '…' : first;
  return { themes, oneLine, sentiment, sentimentLabel };
}

export default function WatchList({ onSelectStock }: WatchListProps) {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newStock, setNewStock] = useState({ symbol: '', name: '', market: 'TW' as 'TW' | 'US' });

  const [editingSymbol, setEditingSymbol] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editMarket, setEditMarket] = useState<'TW' | 'US'>('TW');
  const editInputRef = useRef<HTMLInputElement>(null);

  const [newsOpen, setNewsOpen] = useState<Set<string>>(new Set());
  const [newsData, setNewsData] = useState<Record<string, NewsItem[]>>({});
  const [newsLoading, setNewsLoading] = useState<Set<string>>(new Set());

  const [quotes, setQuotes] = useState<Record<string, { price: number; changePercent: number; isMarketClosed?: boolean }>>({});
  const [quotesLoading, setQuotesLoading] = useState(false);
  type ChipEntry = { foreignNet: number; trustNet: number; dealerNet: number };
  const [chipData, setChipData] = useState<Record<string, ChipEntry | null>>({});
  const watchlistRef = useRef<WatchlistItem[]>([]);

  useEffect(() => { loadWatchlist(); }, []);

  useEffect(() => {
    if (editingSymbol) editInputRef.current?.focus();
  }, [editingSymbol]);

  // 每 60 秒自動刷新報價
  useEffect(() => {
    const timer = setInterval(() => {
      if (watchlistRef.current.length > 0) fetchQuotes(watchlistRef.current);
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  const fetchChips = useCallback(async (list: WatchlistItem[]) => {
    const twList = list.filter(s => /^\d+$/.test(s.symbol));
    if (twList.length === 0) return;
    const results = await Promise.allSettled(
      twList.map(s => chipsApi.get(s.symbol, 10).then(r => ({ symbol: s.symbol, data: r.data })))
    );
    // null = 已嘗試但無資料；object = 有資料
    const finalMap: Record<string, ChipEntry | null> = {};
    results.forEach((r, i) => {
      const symbol = twList[i].symbol;
      if (r.status === 'fulfilled' && Array.isArray(r.value.data) && r.value.data.length > 0) {
        const latest = r.value.data[r.value.data.length - 1];
        finalMap[symbol] = {
          foreignNet: latest.foreignNet ?? 0,
          trustNet:   latest.trustNet   ?? 0,
          dealerNet:  latest.dealerNet  ?? 0,
        };
      } else {
        finalMap[symbol] = null; // 嘗試過但 TWSE 無當日資料
      }
    });
    setChipData(prev => ({ ...prev, ...finalMap }));
  }, []);

  const fetchQuotes = async (list: WatchlistItem[]) => {
    if (list.length === 0) return;
    setQuotesLoading(true);
    try {
      const results = await Promise.allSettled(
        list.map(s => quotesApi.getQuote(s.symbol, s.market))
      );
      const map: Record<string, { price: number; changePercent: number }> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value.data) {
          const d = r.value.data;
          if (d.close > 0 && isFinite(d.close)) {
            map[list[i].symbol] = { price: d.close, changePercent: d.changePercent ?? 0, isMarketClosed: d.isMarketClosed };
          }
        }
      });
      setQuotes(map);
    } catch {
      // 靜默失敗，保留舊資料
    } finally {
      setQuotesLoading(false);
    }
  };

  const loadWatchlist = async () => {
    try {
      const response = await watchlistApi.getAll();
      watchlistRef.current = response.data;
      setWatchlist(response.data);
      fetchQuotes(response.data);
      fetchChips(response.data);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newStock.symbol || !newStock.name) {
      alert('請填寫股票代號和名稱');
      return;
    }
    try {
      await watchlistApi.add(newStock.symbol, newStock.name, newStock.market);
      setNewStock({ symbol: '', name: '', market: 'TW' });
      setShowAddForm(false);
      loadWatchlist();
    } catch (error: any) {
      alert(error.response?.data?.error || '新增失敗');
    }
  };

  const handleRemove = async (symbol: string) => {
    if (!confirm('確定要刪除此股票？')) return;
    try {
      await watchlistApi.remove(symbol);
      loadWatchlist();
    } catch {
      alert('刪除失敗');
    }
  };

  const startEdit = (stock: WatchlistItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSymbol(stock.symbol);
    setEditName(stock.name);
    setEditMarket(stock.market);
  };

  const saveEdit = async () => {
    if (!editingSymbol || !editName.trim()) {
      setEditingSymbol(null);
      return;
    }
    try {
      await watchlistApi.update(editingSymbol, editName.trim(), editMarket);
      setEditingSymbol(null);
      loadWatchlist();
    } catch {
      alert('更新失敗');
      setEditingSymbol(null);
    }
  };

  const toggleNews = async (stock: WatchlistItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const { symbol, market } = stock;
    const next = new Set(newsOpen);

    if (next.has(symbol)) {
      next.delete(symbol);
      setNewsOpen(next);
      return;
    }

    next.add(symbol);
    setNewsOpen(next);

    if (!newsData[symbol]) {
      setNewsLoading(prev => new Set(prev).add(symbol));
      try {
        const res = await quotesApi.getNews(symbol, market);
        setNewsData(prev => ({ ...prev, [symbol]: res.data.slice(0, 3) }));
      } catch {
        setNewsData(prev => ({ ...prev, [symbol]: [] }));
      } finally {
        setNewsLoading(prev => { const s = new Set(prev); s.delete(symbol); return s; });
      }
    }
  };

  if (loading) {
    return <div className="glass-card rounded-lg p-6 text-slate-500">載入中...</div>;
  }

  return (
    <div className="glass-card rounded-lg overflow-hidden">
      {/* 標題列 */}
      <div className="px-4 py-3 border-b glass-header flex justify-between items-center" style={{ borderBottomColor: 'rgba(255,255,255,0.08)' }}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold tracking-widest uppercase text-slate-100">自選股</h2>
          <button
            onClick={() => fetchQuotes(watchlistRef.current)}
            disabled={quotesLoading}
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40"
            title="刷新報價"
          >{quotesLoading ? '···' : '↻'}</button>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-3 py-1 rounded text-xs font-medium transition-colors"
          style={{ background: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.35)', color: '#67e8f9' }}
        >
          + 新增
        </button>
      </div>

      {/* 新增表單 */}
      {showAddForm && (
        <div className="p-4 border-b glass-form" style={{ borderBottomColor: '#D3E0DC' }}>
          <div className="space-y-2">
            <input
              type="text"
              placeholder="股票代號 (例: 2330 / AAPL / GC=F)"
              value={newStock.symbol}
              onChange={(e) => setNewStock({ ...newStock, symbol: e.target.value })}
              className="w-full px-3 py-2 rounded text-sm"
            />
            <input
              type="text"
              placeholder="股票名稱 (例: 台積電)"
              value={newStock.name}
              onChange={(e) => setNewStock({ ...newStock, name: e.target.value })}
              className="w-full px-3 py-2 rounded text-sm"
            />
            <select
              value={newStock.market}
              onChange={(e) => setNewStock({ ...newStock, market: e.target.value as 'TW' | 'US' })}
              className="w-full px-3 py-2 rounded text-sm"
            >
              <option value="TW">台股（純數字代號）</option>
              <option value="US">美股 / 期貨 / 貴金屬（英文代號）</option>
            </select>
            <div className="text-xs rounded px-2 py-1.5 text-slate-400" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}>
              💡 期貨 / 貴金屬請選「美股」：黃金 <code className="px-1 rounded" style={{ background: 'rgba(255,255,255,0.08)' }}>GC=F</code>　白銀 <code className="px-1 rounded" style={{ background: 'rgba(255,255,255,0.08)' }}>SI=F</code>　原油 <code className="px-1 rounded" style={{ background: 'rgba(255,255,255,0.08)' }}>CL=F</code>
            </div>
            <div className="flex gap-2">
              <button onClick={handleAdd}
                className="flex-1 px-3 py-2 rounded text-sm font-medium transition-colors"
                style={{ background: 'rgba(6,182,212,0.18)', border: '1px solid rgba(6,182,212,0.4)', color: '#67e8f9' }}>
                確認新增
              </button>
              <button onClick={() => setShowAddForm(false)}
                className="flex-1 px-3 py-2 rounded text-sm transition-colors"
                style={{ background: 'rgba(255,255,255,0.06)', color: '#64748b' }}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 股票清單 */}
      <div className="dark-divide">
        {watchlist.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            尚無自選股<br />點擊上方「+ 新增」按鈕新增股票
          </div>
        ) : (
          watchlist.map((stock) => {
            const isEditing = editingSymbol === stock.symbol;
            const newsExpanded = newsOpen.has(stock.symbol);
            const isNewsLoading = newsLoading.has(stock.symbol);
            const news = newsData[stock.symbol] ?? [];

            return (
              <div key={stock.id}>
                {/* 主資訊列 */}
                <div
                  className="px-3.5 py-3 glass-hover cursor-pointer flex items-center group transition-colors gap-2"
                  onClick={() => !isEditing && onSelectStock(stock)}
                >
                  {/* 左側：名稱 + 代號（編輯模式時佔滿全寬） */}
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      /* 編輯模式：兩行佈局，確保 input 有足夠空間 */
                      <div className="space-y-1.5 w-full" onClick={e => e.stopPropagation()}>
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveEdit();
                            if (e.key === 'Escape') setEditingSymbol(null);
                          }}
                          className="w-full rounded px-2 py-1.5 text-sm"
                          placeholder="股票名稱"
                        />
                        <div className="flex gap-1.5 items-center">
                          <select
                            value={editMarket}
                            onChange={e => setEditMarket(e.target.value as 'TW' | 'US')}
                            className="flex-1 rounded px-2 py-1 text-xs"
                          >
                            <option value="TW">台股</option>
                            <option value="US">美股/期貨</option>
                          </select>
                          <button onClick={saveEdit}
                            className="shrink-0 px-2.5 py-1 rounded text-xs transition-colors"
                            style={{ background: 'rgba(6,182,212,0.18)', border: '1px solid rgba(6,182,212,0.4)', color: '#67e8f9' }}>
                            儲存
                          </button>
                          <button onClick={() => setEditingSymbol(null)}
                            className="shrink-0 px-2 py-1 rounded text-xs transition-colors"
                            style={{ background: 'rgba(255,255,255,0.06)', color: '#64748b' }}>
                            ✕
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-semibold text-sm text-slate-100 truncate">{stock.name}</span>
                          <button
                            onClick={e => startEdit(stock, e)}
                            className="hidden group-hover:inline-flex text-slate-500 hover:text-blue-400 transition-colors p-0.5 rounded shrink-0"
                            title="修改名稱"
                          >
                            ✏️
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-xs text-slate-500 tabular">{stock.symbol}</span>
                          <span className="section-label">{stock.market}</span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* 右側：編輯模式完全隱藏 */}
                  {!isEditing && (
                    <div className="flex flex-col items-end gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                      {/* 上行：報價 + 操作按鈕 */}
                      <div className="flex items-center gap-1.5">
                        {/* 報價 + 漲跌幅 */}
                        {(() => {
                          const q = quotes[stock.symbol];
                          if (!q) return quotesLoading
                            ? <span className="text-xs text-slate-600 animate-pulse">···</span>
                            : null;
                          const rawPct = q.changePercent;
                          const pct = isFinite(rawPct) ? rawPct : 0;
                          const badgeCls = pct > 0.05 ? 'badge-up' : pct < -0.05 ? 'badge-down' : 'badge-flat';
                          const prefix = pct > 0 ? '+' : '';
                          return (
                            <div className="text-right">
                              <div className="flex items-center gap-1 justify-end">
                                {q.isMarketClosed && (
                                  <span className="text-xs px-1 rounded" style={{ background: 'rgba(100,116,139,0.2)', color: '#94a3b8', fontSize: '10px' }}>昨收</span>
                                )}
                                <span className="text-sm font-bold text-slate-100 tabular leading-tight">
                                  {q.price >= 1000
                                    ? q.price.toLocaleString('en-US', { maximumFractionDigits: 0 })
                                    : q.price.toFixed(2)}
                                </span>
                              </div>
                              {q.isMarketClosed
                                ? <span className="badge-flat text-xs">未開盤</span>
                                : <span className={badgeCls}>{prefix}{pct.toFixed(2)}%</span>
                              }
                            </div>
                          );
                        })()}

                        {/* 新聞按鈕：展開時常駐，否則 hover 才顯示 */}
                        <button
                          onClick={e => toggleNews(stock, e)}
                          className={`px-1.5 py-1 rounded text-xs transition-colors ${
                            newsExpanded
                              ? 'inline-flex'
                              : 'hidden group-hover:inline-flex text-slate-500 hover:text-indigo-400'
                          }`}
                          style={newsExpanded ? { background: 'rgba(99,102,241,0.15)', color: '#4f46e5' } : {}}
                          title="查看相關新聞"
                        >
                          {isNewsLoading ? '⌛' : newsExpanded ? '收合' : '📰'}
                        </button>

                        {/* 刪除按鈕：hover 才顯示 */}
                        <button
                          onClick={() => handleRemove(stock.symbol)}
                          className="hidden group-hover:inline-flex px-1.5 py-1 text-red-400 hover:text-red-300 rounded text-xs transition-colors"
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          ✕
                        </button>
                      </div>

                      {/* 外資法人方塊：台股限定，獨立於報價資料 */}
                      {/^\d+$/.test(stock.symbol) && (() => {
                        // undefined = 還在抓取；null = 抓完但無資料；object = 有資料
                        if (!(stock.symbol in chipData)) return (
                          <div className="text-xs" style={{ color: '#94a3b8' }}>籌碼載入中…</div>
                        );
                        const chip = chipData[stock.symbol];
                        if (!chip) return (
                          <div className="text-xs" style={{ color: '#b0b8c4' }}>今日暫無籌碼</div>
                        );
                        const totNet = chip.foreignNet + chip.trustNet + chip.dealerNet;
                        const totPos = totNet >= 0;
                        return (
                          <div className="rounded px-1.5 py-1 text-right"
                            style={{
                              background: totPos ? 'rgba(220,38,38,0.07)' : 'rgba(22,163,74,0.07)',
                              border: `1px solid ${totPos ? 'rgba(220,38,38,0.18)' : 'rgba(22,163,74,0.18)'}`,
                            }}>
                            {/* 三機構買賣超並排 */}
                            <div className="flex gap-2 justify-end text-xs tabular">
                              {[
                                { label: '外', val: chip.foreignNet },
                                { label: '投', val: chip.trustNet },
                                { label: '自', val: chip.dealerNet },
                              ].map(({ label, val }) => (
                                <div key={label} className="text-center" style={{ minWidth: 32 }}>
                                  <div className="text-slate-600" style={{ fontSize: 10 }}>{label}</div>
                                  <div className="font-semibold" style={{ color: val >= 0 ? '#dc2626' : '#16a34a', fontSize: 11 }}>
                                    {val >= 0 ? '+' : ''}{val >= 1000 ? `${(val/1000).toFixed(1)}K` : val.toLocaleString()}
                                  </div>
                                </div>
                              ))}
                            </div>
                            {/* 合計 */}
                            <div className="text-xs font-bold tabular mt-0.5" style={{ color: totPos ? '#dc2626' : '#16a34a' }}>
                              合計 {totPos ? '+' : ''}{totNet.toLocaleString()} 張
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* 新聞懶人包展開區塊 */}
                {newsExpanded && (
                  <div className="px-4 pb-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.15)' }}>
                    <div className="section-label pt-2 pb-1.5">近期新聞</div>
                    {isNewsLoading ? (
                      <div className="text-xs py-2" style={{ color: '#64748b' }}>載入中...</div>
                    ) : news.length === 0 ? (
                      <div className="text-xs py-1" style={{ color: '#64748b' }}>目前無相關新聞</div>
                    ) : (() => {
                        const { themes, oneLine, sentimentLabel } = buildNewsDigest(news);
                        return (
                          <div className="space-y-2">
                            {/* 主題標籤 + 評價 */}
                            <div className="flex flex-wrap items-center gap-1">
                              {themes.map((t, i) => (
                                <span key={i} className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.3)', color: '#67e8f9' }}>{t}</span>
                              ))}
                              <span className="text-xs px-1.5 py-0.5 rounded ml-auto shrink-0"
                                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' }}>
                                {sentimentLabel}
                              </span>
                            </div>
                            {oneLine && (
                              <div className="text-xs rounded px-2 py-1.5" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#cbd5e1' }}>
                                <span style={{ fontWeight: 600 }}>最新 → </span>{oneLine}
                              </div>
                            )}
                            <ul className="space-y-1">
                              {news.map((n, i) => (
                                <li key={i} className="flex items-start gap-1">
                                  <span className="text-xs mt-0.5 shrink-0" style={{ color: '#94a3b8' }}>▸</span>
                                  {n.url ? (
                                    <a href={n.url} target="_blank" rel="noopener noreferrer"
                                      className="text-xs hover:underline leading-snug" style={{ color: '#2563eb' }}>
                                      {n.title}
                                      {n.publishTime && <span className="ml-1" style={{ color: '#94a3b8' }}>· {n.publishTime}</span>}
                                    </a>
                                  ) : (
                                    <span className="text-xs leading-snug" style={{ color: '#64748b' }}>{n.title}</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })()
                    }
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
