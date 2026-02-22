import { useState, useEffect, useCallback } from 'react';

// 新聞懶人包摘要生成（多段落版）
function buildNewsDigest(news: Array<{title: string; url: string; publishTime: string}>): { themes: string[]; digest: string } {
  if (news.length === 0) return { themes: [], digest: '' };

  const titles = news.map(n => n.title);
  const all = titles.join(' ');
  const themes: string[] = [];
  if (/漲|創高|突破|強勢|買超|看多|反彈|升|bull|rise|gain|high/i.test(all))   themes.push('📈 多方訊號');
  if (/跌|下跌|回落|賣超|看空|警告|跌破|bear|fall|drop|loss|down/i.test(all)) themes.push('📉 空方訊號');
  if (/聯準會|Fed|升息|降息|利率|央行|FOMC/i.test(all))                       themes.push('🏦 貨幣政策');
  if (/財報|EPS|盈餘|earnings|revenue|獲利/i.test(all))                        themes.push('📊 財報消息');
  if (/CPI|通膨|通貨膨脹|inflation/i.test(all))                               themes.push('💹 通膨數據');
  if (/黃金|白銀|gold|silver|原油|oil|銅|copper/i.test(all))                  themes.push('🪙 商品市場');
  if (/裁員|倒閉|破產|law|訴訟|罰款/i.test(all))                              themes.push('⚠️ 風險事件');

  const bull = (all.match(/漲|創高|突破|beat|買超|成長|surge|growth/gi) ?? []).length;
  const bear = (all.match(/跌|下修|賣超|miss|裁員|decline/gi) ?? []).length;
  const net = bull - bear;
  const sentStr = net >= 2 ? '消息面偏正向' : net <= -2 ? '消息面偏負向' : '消息面中性';

  let digest = `${sentStr}，共 ${news.length} 則報導。\n`;

  const bullT = titles.filter(t => /漲|創高|突破|beat|買超|回購|成長|surge/i.test(t));
  if (bullT.length > 0) digest += `\n【正向】${bullT.slice(0, 2).join('；')}。`;

  const bearT = titles.filter(t => /跌|下修|裁員|miss|賣超|關稅|警告/i.test(t));
  if (bearT.length > 0) digest += `\n【風險】${bearT.slice(0, 2).join('；')}。`;

  digest += `\n\n【頭條】${titles[0]}`;

  return { themes, digest: digest.trim() };
}
import { portfolioApi, portfolioGroupsApi, quotesApi } from '../../services/api';
import type { PortfolioDetail, PortfolioGroup, RebalanceAction } from '../../types';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, LineChart, Line, XAxis, YAxis } from 'recharts';

const PIE_COLORS = ['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316'];

// ─── 市場判斷工具 ──────────────────────────────────────────────
const isTW = (symbol: string) => /^\d+$/.test(symbol);
const unitLabel = (symbol: string) => isTW(symbol) ? '張' : '股';

// ─── 行內編輯欄位 ─────────────────────────────────────────────
interface EditState {
  shares: string;
  cost_price: string;
  target_allocation: string;
}

export default function Portfolio() {
  // 組合群組
  const [groups, setGroups] = useState<PortfolioGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<number>(1);

  // 持股
  const [holdings, setHoldings] = useState<PortfolioDetail[]>([]);
  const [actions, setActions] = useState<RebalanceAction[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // 行內編輯
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState>({ shares: '', cost_price: '', target_allocation: '' });

  // 新增表單
  const [showAddForm, setShowAddForm] = useState(false);
  const [newHolding, setNewHolding] = useState({
    symbol: '', name: '', shares: '', cost_price: '', target_allocation: '',
  });

  // 群組 modal
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupModalMode, setGroupModalMode] = useState<'add' | 'rename'>('add');
  const [groupModalValue, setGroupModalValue] = useState('');

  // 再平衡模式
  const [rebalMode, setRebalMode] = useState<'all' | 'buy_only' | 'sell_only'>('all');

  // 新聞狀態
  const [newsOpen, setNewsOpen] = useState<Set<string>>(new Set());
  const [newsData, setNewsData] = useState<Record<string, Array<{title: string; url: string; publishTime: string}>>>({});
  const [newsLoading, setNewsLoading] = useState<Set<string>>(new Set());

  // 美元匯率 & 各組合市值總覽
  const [usdTwdRate, setUsdTwdRate] = useState<number>(0);
  const [groupValues, setGroupValues] = useState<Record<number, number>>({});
  const [exRateHistory, setExRateHistory] = useState<{date: string; close: number}[]>([]);

  useEffect(() => { loadGroups(); fetchExchangeRate(); }, []);

  useEffect(() => {
    quotesApi.getHistory('USDTWD=X', 'US', 90, '1d')
      .then(r => {
        setExRateHistory(
          r.data
            .filter((d: any) => d.close > 0 && isFinite(d.close))
            .map((d: any) => ({ date: d.date.slice(5, 10), close: d.close }))
        );
      })
      .catch(() => {});
  }, []);
  useEffect(() => { if (activeGroupId) loadPortfolio(activeGroupId); }, [activeGroupId]);

  const fetchExchangeRate = async () => {
    try {
      const res = await quotesApi.getExchangeRate();
      setUsdTwdRate(res.data.rate);
    } catch { /* 匯率取得失敗時不影響其他功能 */ }
  };

  const loadGroups = async () => {
    try {
      const res = await portfolioGroupsApi.getAll();
      setGroups(res.data);
      if (res.data.length > 0) setActiveGroupId(res.data[0].id);
    } catch { /* ignore */ }
  };

  const loadPortfolio = useCallback(async (groupId: number, silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const [detailRes, rebalRes] = await Promise.all([
        portfolioApi.getDetails(groupId),
        portfolioApi.getRebalance(groupId, rebalMode),
      ]);
      setHoldings(detailRes.data.holdings);
      setTotalValue(detailRes.data.totalMarketValue);
      setActions(rebalRes.data.actions);
      setLastUpdated(new Date());
      // 記錄此組合的市值，供頂部總覽使用
      setGroupValues(prev => ({ ...prev, [groupId]: detailRes.data.totalMarketValue }));
    } catch { /* ignore */ }
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [rebalMode]);

  // ─── 群組操作 ─────────────────────────────────────────────
  const openAddGroup    = () => { setGroupModalMode('add');    setGroupModalValue('');                                      setShowGroupModal(true); };
  const openRenameGroup = () => { setGroupModalMode('rename'); setGroupModalValue(groups.find(g=>g.id===activeGroupId)?.name??''); setShowGroupModal(true); };

  const confirmGroupModal = async () => {
    const name = groupModalValue.trim();
    if (!name) return;
    if (groupModalMode === 'add') {
      const res = await portfolioGroupsApi.add(name);
      await loadGroups();
      setActiveGroupId(res.data.id);
    } else {
      await portfolioGroupsApi.update(activeGroupId, name);
      await loadGroups();
    }
    setShowGroupModal(false);
  };

  const deleteGroup = async () => {
    if (groups.length <= 1) { alert('至少要保留一個投資組合'); return; }
    if (!confirm(`確定要刪除「${groups.find(g=>g.id===activeGroupId)?.name}」？`)) return;
    await portfolioGroupsApi.remove(activeGroupId);
    await loadGroups();
  };

  // ─── 新增持股 ─────────────────────────────────────────────
  const handleAdd = async () => {
    if (!newHolding.symbol || !newHolding.name || newHolding.shares === '' || newHolding.cost_price === '') {
      alert('請填寫股票代號、名稱、持股數量和成本價（尚未買入可填 0）');
      return;
    }
    await portfolioApi.add(
      activeGroupId,
      newHolding.symbol.toUpperCase(),
      newHolding.name,
      parseFloat(newHolding.shares),
      parseFloat(newHolding.cost_price),
      parseFloat(newHolding.target_allocation || '0'),
    );
    setNewHolding({ symbol: '', name: '', shares: '', cost_price: '', target_allocation: '' });
    setShowAddForm(false);
    loadPortfolio(activeGroupId);
  };

  // ─── 行內編輯 ─────────────────────────────────────────────
  const startEdit = (h: PortfolioDetail) => {
    setEditingId(h.id);
    setEditState({
      shares:            String(h.shares),
      cost_price:        String(h.cost_price),
      target_allocation: String(h.target_allocation),
    });
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id: number) => {
    const shares = parseFloat(editState.shares);
    const cost   = parseFloat(editState.cost_price);
    const target = parseFloat(editState.target_allocation || '0');
    if (isNaN(shares) || isNaN(cost) || shares < 0 || cost < 0) { alert('數量和成本價不可為負數'); return; }
    await portfolioApi.update(id, shares, cost, target);
    setEditingId(null);
    loadPortfolio(activeGroupId, true);
  };

  const handleRemove = async (id: number, name: string) => {
    if (!confirm(`確定要刪除「${name}」？`)) return;
    await portfolioApi.remove(id);
    loadPortfolio(activeGroupId);
  };

  // ─── 新聞展開/收合 ────────────────────────────────────────
  const toggleNews = async (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const market = isTW(symbol) ? 'TW' : 'US';
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

  // ─── 計算摘要 ─────────────────────────────────────────────
  const totalCost    = holdings.reduce((s, h) => s + h.cost_price * h.shares * (isTW(h.symbol) ? 1000 : 1), 0);
  const totalPL      = holdings.reduce((s, h) => s + h.profit_loss, 0);
  const totalPLPct   = totalCost > 0 ? (totalPL / totalCost) * 100 : 0;
  const totalTarget  = holdings.reduce((s, h) => s + h.target_allocation, 0);
  const hasTarget    = holdings.some(h => h.target_allocation > 0);

  // ─── 跨組合總計（換算為台幣）──────────────────────────────
  // 各組合市值已載入的部分加總；US 股用匯率換算
  const grandTotalTWD = groups.reduce((sum, g) => {
    const val = groupValues[g.id] ?? 0;
    return sum + val;
  }, 0);
  const loadedGroupCount = Object.keys(groupValues).length;

  // 圓餅圖資料
  const pieData = holdings.map((h, i) => ({
    name: h.name,
    value: parseFloat(h.current_allocation.toFixed(1)),
    color: PIE_COLORS[i % PIE_COLORS.length],
  }));

  return (
    <div className="space-y-4">

      {/* ══ 頂部總覽橫幅 ══ */}
      <div className="glass-card rounded-lg p-4" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.08), rgba(99,102,241,0.10))' }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* 左：總市值 */}
          <div>
            <div className="text-xs text-slate-300 mb-1">
              所有組合總市值
              {loadedGroupCount < groups.length && (
                <span className="ml-1 text-yellow-300">（{loadedGroupCount}/{groups.length} 組合已計算）</span>
              )}
            </div>
            <div className="text-2xl font-bold tracking-tight">
              {grandTotalTWD > 0
                ? grandTotalTWD.toLocaleString(undefined, { maximumFractionDigits: 0 })
                : '—'}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              切換各組合後數字會更新完整
            </div>
          </div>

          {/* 右：各組合拆分 + 匯率 */}
          <div className="flex flex-col items-end gap-1.5">
            {/* 各組合市值小標籤 */}
            <div className="flex flex-wrap gap-1.5 justify-end">
              {groups.map(g => (
                <button key={g.id}
                  onClick={() => setActiveGroupId(g.id)}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    g.id === activeGroupId
                      ? 'bg-white text-slate-800 font-semibold'
                      : 'bg-slate-600 text-slate-200 hover:bg-slate-500'
                  }`}>
                  {g.name}：{groupValues[g.id] != null
                    ? groupValues[g.id].toLocaleString(undefined, { maximumFractionDigits: 0 })
                    : '—'}
                </button>
              ))}
            </div>
            {/* 匯率顯示 */}
            <div className="text-xs text-slate-400">
              {usdTwdRate > 0
                ? `💱 1 USD ＝ ${usdTwdRate.toFixed(2)} TWD`
                : '💱 匯率載入中...'}
            </div>
          </div>
        </div>
      </div>

      {/* ══ 群組標籤列 ══ */}
      <div className="glass-card rounded-lg p-3 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-slate-400 mr-1">投資組合：</span>
        {groups.map(g => (
          <button key={g.id} onClick={() => setActiveGroupId(g.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              g.id === activeGroupId ? 'text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
            style={g.id === activeGroupId ? { background: 'rgba(59,130,246,0.7)' } : { background: 'rgba(255,255,255,0.06)' }}>
            {g.name}
          </button>
        ))}
        <button onClick={openAddGroup}
          className="px-3 py-1.5 rounded-full text-sm text-slate-500 hover:text-blue-400 transition-colors"
          style={{ border: '2px dashed rgba(255,255,255,0.15)' }}>
          + 新增組合
        </button>
        <div className="ml-auto flex gap-2">
          <button onClick={openRenameGroup}
            className="px-3 py-1.5 text-xs text-slate-400 rounded hover:text-slate-200 transition-colors"
            style={{ background: 'rgba(255,255,255,0.06)' }}>重命名</button>
          {groups.length > 1 && (
            <button onClick={deleteGroup}
              className="px-3 py-1.5 text-xs text-red-400 rounded hover:text-red-300 transition-colors"
              style={{ background: 'rgba(239,68,68,0.1)' }}>刪除組合</button>
          )}
        </div>
      </div>

      {/* ══ 群組 Modal ══ */}
      {showGroupModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="glass-card rounded-xl p-6 w-80" style={{ backdropFilter: 'blur(20px)' }}>
            <h3 className="font-bold text-slate-100 mb-4">{groupModalMode === 'add' ? '新增投資組合' : '重命名組合'}</h3>
            <input type="text" placeholder="組合名稱" value={groupModalValue}
              onChange={e => setGroupModalValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmGroupModal()}
              autoFocus className="w-full px-3 py-2 rounded mb-4 text-sm" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowGroupModal(false)}
                className="px-4 py-2 rounded text-sm text-slate-400 transition-colors"
                style={{ background: 'rgba(255,255,255,0.07)' }}>取消</button>
              <button onClick={confirmGroupModal}
                className="px-4 py-2 rounded text-sm text-white transition-colors"
                style={{ background: 'rgba(59,130,246,0.7)' }}>確認</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ 操作列 ══ */}
      <div className="glass-card rounded-lg p-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h2 className="font-bold text-slate-100">💼 {groups.find(g=>g.id===activeGroupId)?.name ?? '投資組合'}</h2>
          {lastUpdated && (
            <span className="text-xs text-slate-500">
              報價更新：{lastUpdated.toLocaleTimeString('zh-TW')}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => loadPortfolio(activeGroupId, true)} disabled={refreshing}
            className="px-3 py-2 rounded text-sm text-slate-400 disabled:opacity-50 hover:text-slate-200 transition-colors"
            style={{ background: 'rgba(255,255,255,0.06)' }}
            title="刷新最新股價">
            {refreshing ? '更新中...' : '🔄 刷新報價'}
          </button>
          <button onClick={() => setShowAddForm(!showAddForm)}
            className="px-4 py-2 rounded text-sm text-white transition-colors"
            style={{ background: 'rgba(59,130,246,0.7)' }}>
            + 新增持股
          </button>
        </div>
      </div>

      {/* ══ 兩欄主區域：左側操作 + 右側摘要圓餅 ══ */}
      <div className="flex gap-4 items-start">

        {/* 左側：新增表單 + 再平衡 + 持股明細 */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* ══ 新增表單 ══ */}
          {showAddForm && (
            <div className="glass-card rounded-lg p-5">
              <h3 className="font-semibold text-slate-100 mb-3">新增持股</h3>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">股票代號</label>
                  <input type="text" placeholder="例: 2330 / AAPL / GC=F / XAUUSD=X"
                    value={newHolding.symbol}
                    onChange={e => setNewHolding({...newHolding, symbol: e.target.value.toUpperCase()})}
                    className="w-full px-3 py-2 rounded text-sm" />
                  <div className="text-xs text-slate-500 mt-0.5">
                    黃金期貨 <code className="px-1 rounded" style={{ background: 'rgba(255,255,255,0.08)' }}>GC=F</code>　白銀期貨 <code className="px-1 rounded" style={{ background: 'rgba(255,255,255,0.08)' }}>SI=F</code>　原油期貨 <code className="px-1 rounded" style={{ background: 'rgba(255,255,255,0.08)' }}>CL=F</code>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">股票名稱</label>
                  <input type="text" placeholder="例: 台積電"
                    value={newHolding.name}
                    onChange={e => setNewHolding({...newHolding, name: e.target.value})}
                    className="w-full px-3 py-2 rounded text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    持股數量（台股填<b className="text-slate-300">張</b>，美股填<b className="text-slate-300">股</b>；尚未買入填 <b className="text-slate-300">0</b>）
                  </label>
                  <input type="number" placeholder="0"
                    value={newHolding.shares}
                    onChange={e => setNewHolding({...newHolding, shares: e.target.value})}
                    className="w-full px-3 py-2 rounded text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">買入成本價（每股/每張；未買入可填 0）</label>
                  <input type="number" placeholder="0"
                    value={newHolding.cost_price}
                    onChange={e => setNewHolding({...newHolding, cost_price: e.target.value})}
                    className="w-full px-3 py-2 rounded text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">目標配置比例（%，可留 0）</label>
                  <input type="number" placeholder="0" min="0" max="100"
                    value={newHolding.target_allocation}
                    onChange={e => setNewHolding({...newHolding, target_allocation: e.target.value})}
                    className="w-full px-3 py-2 rounded text-sm" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleAdd}
                  className="px-4 py-2 rounded text-sm text-white transition-colors"
                  style={{ background: 'rgba(59,130,246,0.7)' }}>確認新增</button>
                <button onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 rounded text-sm text-slate-400 transition-colors"
                  style={{ background: 'rgba(255,255,255,0.07)' }}>取消</button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="glass-card rounded-lg p-10 text-center text-slate-500">載入中，正在取得最新報價...</div>
          ) : (
            <>
              {/* ══ 再平衡提醒（有操作時常駐顯示）══ */}
          {hasTarget && (actions.length > 0 || rebalMode !== 'all') && (
            <div className="rounded-lg p-4" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-lg">⚡</span>
                <h3 className="font-bold text-amber-300">再平衡建議</h3>
                <span className="text-xs text-amber-500">（依最新報價計算）</span>

                {/* 模式切換 */}
                <div className="flex gap-1 ml-auto">
                  {([
                    { key: 'all',       label: '買賣都做' },
                    { key: 'buy_only',  label: '只補倉' },
                    { key: 'sell_only', label: '只減碼' },
                  ] as const).map(m => (
                    <button key={m.key}
                      onClick={() => {
                        setRebalMode(m.key);
                        loadPortfolio(activeGroupId, true);
                      }}
                      className={`text-xs px-2 py-1 rounded transition-colors ${
                        rebalMode === m.key
                          ? 'text-white font-semibold'
                          : 'text-amber-400 hover:text-amber-200'
                      }`}
                      style={rebalMode === m.key ? { background: 'rgba(245,158,11,0.6)' } : { background: 'rgba(245,158,11,0.15)' }}>
                      {m.label}
                    </button>
                  ))}
                  <button onClick={() => loadPortfolio(activeGroupId, true)} disabled={refreshing}
                    className="text-xs px-2 py-1 text-amber-400 hover:text-amber-200 underline disabled:opacity-50">
                    {refreshing ? '更新中...' : '重算'}
                  </button>
                </div>
              </div>

              {/* 模式說明 */}
              <div className="text-xs text-amber-400 rounded px-2 py-1 mb-3" style={{ background: 'rgba(245,158,11,0.1)' }}>
                {rebalMode === 'all'      && '目前模式：買賣都做 — 同時賣掉超配的、買入低配的，達到目標比例'}
                {rebalMode === 'buy_only' && '目前模式：只補倉 — 只建議買入，適合想加碼不想賣出的情況'}
                {rebalMode === 'sell_only'&& '目前模式：只減碼 — 只建議賣出，適合想降低持股不想動用現金的情況'}
              </div>
              {actions.length === 0 && (
                <div className="text-sm text-amber-400 rounded px-3 py-2 text-center" style={{ background: 'rgba(245,158,11,0.08)' }}>
                  在目前模式下沒有需要操作的項目 ✓
                </div>
              )}
              <div className="grid gap-2">
                {actions.map((a, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg px-4 py-3 text-sm"
                    style={a.action === 'buy'
                      ? { background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)' }
                      : { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                    <div className="flex items-center gap-2">
                      <span className={`font-bold text-base ${a.action === 'buy' ? 'text-blue-400' : 'text-red-400'}`}>
                        {a.action === 'buy' ? '▲ 買入' : '▼ 賣出'}
                      </span>
                      <span className="font-semibold text-slate-200">{a.name}</span>
                      <span className="text-slate-500">({a.symbol})</span>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-slate-100">
                        {a.shares} {unitLabel(a.symbol)}
                      </div>
                      <div className="text-xs text-slate-400">
                        約 {Math.abs(a.amount).toLocaleString(undefined, {maximumFractionDigits: 0})} 元
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs text-slate-500 rounded px-3 py-2" style={{ background: 'rgba(255,255,255,0.05)' }}>
                📌 {actions.filter(a=>a.action==='buy').length > 0
                  ? `買入合計約 ${actions.filter(a=>a.action==='buy').reduce((s,a)=>s+a.amount,0).toLocaleString(undefined,{maximumFractionDigits:0})} 元`
                  : ''}
                {actions.filter(a=>a.action==='sell').length > 0
                  ? `　賣出合計約 ${actions.filter(a=>a.action==='sell').reduce((s,a)=>s+a.amount,0).toLocaleString(undefined,{maximumFractionDigits:0})} 元`
                  : ''}
              </div>
            </div>
          )}

          {/* ══ 持股明細 ══ */}
          <div className="glass-card rounded-lg overflow-hidden">
            <div className="p-4 border-b border-white/10 glass-header flex items-center justify-between">
              <h3 className="font-semibold text-slate-200">📋 持股明細</h3>
              {hasTarget && (
                <span className="text-xs text-slate-500">點擊「編輯」可直接修改持股數量和目標配置</span>
              )}
            </div>

            {holdings.length === 0 ? (
              <div className="p-10 text-center text-slate-500">
                此組合尚無持股<br />
                <span className="text-sm">點擊上方「+ 新增持股」來加入</span>
              </div>
            ) : (
              <div className="dark-divide">
                {holdings.map(h => {
                  const up      = h.profit_loss >= 0;
                  const isEdit  = editingId === h.id;
                  const action  = actions.find(a => a.symbol === h.symbol);
                  const diffAbs = Math.abs(h.allocation_diff);

                  return (
                    <div key={h.id} className="p-4 transition-colors glass-hover"
                      style={isEdit ? { background: 'rgba(59,130,246,0.1)' } : {}}>

                      {/* 標題行 */}
                      <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-100">{h.name}</span>
                          <span className="text-sm text-slate-500">({h.symbol})</span>
                          <span className="text-xs px-1.5 py-0.5 rounded text-slate-500" style={{ background: 'rgba(255,255,255,0.06)' }}>
                            {isTW(h.symbol) ? '台股' : '美股'}
                          </span>
                          {h.shares === 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium text-yellow-300" style={{ background: 'rgba(234,179,8,0.2)' }}>
                              計劃買入
                            </span>
                          )}
                          {h.target_allocation > 0 && diffAbs > 1 && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              h.allocation_diff > 0 ? 'text-orange-300' : 'text-blue-300'
                            }`}
                              style={h.allocation_diff > 0 ? { background: 'rgba(249,115,22,0.2)' } : { background: 'rgba(59,130,246,0.2)' }}>
                              {h.allocation_diff > 0 ? `超配 +${h.allocation_diff.toFixed(1)}%` : `低配 ${h.allocation_diff.toFixed(1)}%`}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2 items-center">
                          {isEdit ? (
                            <>
                              <button onClick={() => saveEdit(h.id)}
                                className="text-xs px-3 py-1.5 rounded font-medium text-white transition-colors"
                                style={{ background: 'rgba(59,130,246,0.7)' }}>
                                儲存
                              </button>
                              <button onClick={cancelEdit}
                                className="text-xs px-3 py-1.5 rounded text-slate-400 transition-colors"
                                style={{ background: 'rgba(255,255,255,0.07)' }}>
                                取消
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={e => toggleNews(h.symbol, e)}
                                className={`text-xs px-2 py-1.5 rounded transition-colors ${
                                  newsOpen.has(h.symbol) ? 'text-indigo-300' : 'text-slate-500 hover:text-indigo-400'
                                }`}
                                style={newsOpen.has(h.symbol) ? { background: 'rgba(99,102,241,0.2)' } : {}}
                                title="查看相關新聞"
                              >
                                {newsLoading.has(h.symbol) ? '⌛' : newsOpen.has(h.symbol) ? '📰 收合' : '📰'}
                              </button>
                              <button onClick={() => startEdit(h)}
                                className="text-xs px-3 py-1.5 rounded text-slate-400 hover:text-blue-300 transition-colors"
                                style={{ background: 'rgba(255,255,255,0.06)' }}>
                                ✏️ 編輯
                              </button>
                              <button onClick={() => handleRemove(h.id, h.name)}
                                className="text-xs px-2 py-1.5 text-red-400 hover:text-red-300 rounded transition-colors">
                                刪除
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* 編輯模式 */}
                      {isEdit ? (
                        <div className="grid grid-cols-3 gap-3 mt-2">
                          <div>
                            <label className="text-xs text-slate-400 block mb-1">
                              持股數量（{unitLabel(h.symbol)}）
                            </label>
                            <input type="number" value={editState.shares} min="0"
                              onChange={e => setEditState({...editState, shares: e.target.value})}
                              className="w-full px-2 py-1.5 rounded text-sm" />
                          </div>
                          <div>
                            <label className="text-xs text-slate-400 block mb-1">成本價</label>
                            <input type="number" value={editState.cost_price} min="0"
                              onChange={e => setEditState({...editState, cost_price: e.target.value})}
                              className="w-full px-2 py-1.5 rounded text-sm" />
                          </div>
                          <div>
                            <label className="text-xs text-slate-400 block mb-1">目標配置 (%)</label>
                            <input type="number" value={editState.target_allocation} min="0" max="100"
                              onChange={e => setEditState({...editState, target_allocation: e.target.value})}
                              className="w-full px-2 py-1.5 rounded text-sm" />
                          </div>
                        </div>
                      ) : (
                        /* 顯示模式 */
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                          <div>
                            <div className="text-slate-500 text-xs">持股 / 現價</div>
                            <div className="font-medium text-slate-200">
                              {h.shares}{unitLabel(h.symbol)}
                              <span className={`ml-1.5 text-xs ${h.current_price > 0 ? 'text-slate-500' : 'text-orange-400'}`}>
                                現價 {h.current_price > 0 ? h.current_price.toFixed(2) : '無法取得'}
                              </span>
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs">成本價 / 市值</div>
                            <div className="font-medium text-slate-200">
                              {h.cost_price.toFixed(2)}
                              <span className="text-slate-500 text-xs ml-1">
                                ({h.market_value.toLocaleString(undefined,{maximumFractionDigits:0})})
                              </span>
                            </div>
                            {!isTW(h.symbol) && usdTwdRate > 0 && h.shares > 0 && (
                              <div className="text-xs text-blue-400 mt-0.5">
                                ≈ TWD {(h.market_value * usdTwdRate).toLocaleString(undefined, {maximumFractionDigits: 0})}
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs">損益</div>
                            <div className={`font-semibold ${up ? 'text-red-400' : 'text-green-400'}`}>
                              {up?'+':''}{h.profit_loss.toFixed(0)}
                              <span className="text-xs ml-1">({up?'+':''}{h.profit_loss_percent.toFixed(2)}%)</span>
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs">配置（目標）</div>
                            <div className="font-medium text-slate-200">
                              <span className={diffAbs > 3 ? (h.allocation_diff > 0 ? 'text-orange-400' : 'text-blue-400') : ''}>
                                {h.current_allocation.toFixed(1)}%
                              </span>
                              {h.target_allocation > 0 && (
                                <span className="text-slate-500 text-xs ml-1">/ {h.target_allocation}%</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 再平衡提示（行內） */}
                      {!isEdit && action && (
                        <div className={`mt-2 flex items-center gap-2 text-xs rounded px-3 py-1.5 ${
                          action.action === 'buy' ? 'text-blue-300' : 'text-red-300'
                        }`}
                          style={action.action === 'buy'
                            ? { background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)' }
                            : { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                          <span>{action.action === 'buy' ? '💡 建議加碼' : '💡 建議減碼'}：</span>
                          <span className="font-semibold">{action.action === 'buy' ? '+' : '-'}{action.shares} {unitLabel(action.symbol)}</span>
                          <span>（約 {Math.abs(action.amount).toLocaleString(undefined,{maximumFractionDigits:0})} 元）</span>
                        </div>
                      )}

                      {/* 新聞懶人包展開區 */}
                      {newsOpen.has(h.symbol) && (
                        <div className="mt-2 px-3 py-2 rounded" style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
                          <div className="text-xs font-semibold text-indigo-400 mb-1.5">📰 新聞懶人包</div>
                          {newsLoading.has(h.symbol) ? (
                            <div className="text-xs text-slate-500 py-1">載入中...</div>
                          ) : (newsData[h.symbol] ?? []).length === 0 ? (
                            <div className="text-xs text-slate-500 py-1">目前無相關新聞</div>
                          ) : (() => {
                              const news = newsData[h.symbol] ?? [];
                              const { themes, digest } = buildNewsDigest(news);
                              return (
                                <div className="space-y-2">
                                  {themes.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {themes.map((t, i) => (
                                        <span key={i} className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: '#a5b4fc' }}>{t}</span>
                                      ))}
                                    </div>
                                  )}
                                  {digest && (
                                    <div className="text-xs text-slate-300 rounded px-2 py-1.5 whitespace-pre-line leading-relaxed" style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)' }}>
                                      {digest}
                                    </div>
                                  )}
                                  <ul className="space-y-1">
                                    {news.map((n, i) => (
                                      <li key={i} className="flex items-start gap-1">
                                        <span className="text-slate-600 text-xs mt-0.5 shrink-0">▸</span>
                                        {n.url ? (
                                          <a href={n.url} target="_blank" rel="noopener noreferrer"
                                            className="text-xs text-blue-400 hover:text-blue-300 hover:underline leading-snug">
                                            {n.title}
                                            {n.publishTime && <span className="text-slate-600 ml-1">· {n.publishTime}</span>}
                                          </a>
                                        ) : (
                                          <span className="text-xs text-slate-400 leading-snug">{n.title}</span>
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
                })}
              </div>
            )}
          </div>
            </>
          )}
        </div>

        {/* 右側：摘要 + 圓餅圖（常駐顯示） */}
        {!loading && holdings.length > 0 && (
          <div className="w-64 shrink-0 space-y-4">

            {/* ══ 本組合總覽 ══ */}
            <div className="glass-card rounded-lg p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">📊 本組合概覽</h3>
              <div className="space-y-3">
                <div className="text-center">
                  <div className="text-xs text-slate-500 mb-1">總市值</div>
                  <div className="text-lg font-bold text-slate-100">
                    {totalValue.toLocaleString(undefined, {maximumFractionDigits: 0})}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-slate-500 mb-1">總損益</div>
                  <div className={`text-lg font-bold ${totalPL >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {totalPL >= 0 ? '+' : ''}{totalPL.toLocaleString(undefined, {maximumFractionDigits: 0})}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-slate-500 mb-1">報酬率</div>
                  <div className={`text-2xl font-bold ${totalPLPct >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {totalPLPct >= 0 ? '+' : ''}{totalPLPct.toFixed(2)}%
                  </div>
                </div>
              </div>
              {hasTarget && Math.abs(totalTarget - 100) > 0.5 && (
                <div className={`text-xs text-center rounded px-2 py-1 mt-3 ${
                  Math.abs(totalTarget - 100) > 5 ? 'text-orange-300' : 'text-yellow-300'
                }`}
                  style={{ background: Math.abs(totalTarget - 100) > 5 ? 'rgba(249,115,22,0.15)' : 'rgba(234,179,8,0.15)' }}>
                  ⚠️ 目標合計 {totalTarget.toFixed(1)}%
                </div>
              )}
            </div>

            {/* ══ 配置圓餅圖（常駐顯示）══ */}
            {pieData.length > 0 && (() => {
              // 自訂 label：在圓餅外側顯示百分比，小於 5% 不顯示避免擁擠
              const renderLabel = ({ cx, cy, midAngle, outerRadius, value }: any) => {
                if (value < 5) return null;
                const RADIAN = Math.PI / 180;
                const r = outerRadius + 22;
                const x = cx + r * Math.cos(-midAngle * RADIAN);
                const y = cy + r * Math.sin(-midAngle * RADIAN);
                return (
                  <text x={x} y={y} fill="#64748b" textAnchor={x > cx ? 'start' : 'end'}
                    dominantBaseline="central" fontSize={10} fontWeight={600}>
                    {value}%
                  </text>
                );
              };
              return (
                <div className="glass-card rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-slate-300 mb-2">配置圓餅圖</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="45%" outerRadius={55} dataKey="value"
                        label={renderLabel} labelLine={false}>
                        {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => `${v}%`} contentStyle={{ background: '#0f1923', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0', fontSize: '12px' }} />
                      <Legend wrapperStyle={{ fontSize: '11px', color: '#64748b' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}

            {/* ══ USD/TWD 匯率走勢圖 ══ */}
            {exRateHistory.length > 0 && (
              <div className="glass-card rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="section-label">USD / TWD 近 3 個月</div>
                  <div className="flex items-center gap-1.5">
                    <span className="live-dot" />
                    <span className="text-lg font-bold tabular text-slate-100">{usdTwdRate > 0 ? usdTwdRate.toFixed(2) : '—'}</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={90}>
                  <LineChart data={exRateHistory}>
                    <Line type="monotone" dataKey="close" stroke="#60a5fa" dot={false} strokeWidth={1.5} />
                    <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#64748b' }} width={32} />
                    <Tooltip
                      contentStyle={{ background: '#0f1923', border: '1px solid rgba(255,255,255,0.12)', fontSize: 11, borderRadius: 4, color: '#e2e8f0' }}
                      formatter={(v: any) => [v.toFixed(3), 'USD/TWD']}
                      labelFormatter={(l: string) => l}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
