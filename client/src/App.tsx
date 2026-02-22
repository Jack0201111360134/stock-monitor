import { useState, Component, type ReactNode } from 'react';
import WatchList from './components/WatchList';
import StockDetail from './components/StockDetail';
import Portfolio from './components/Portfolio';
import MarketPanel from './components/MarketPanel';
import StockNewsFeed from './components/StockNewsFeed';
import GlobalSituationPanel from './components/GlobalSituationPanel';

type TabType = 'watchlist' | 'portfolio';

// ── 全域 Error Boundary：包在 StockDetail 外面，useEffect 的錯誤才攔得到 ──
interface EBState { error: Error | null; symbol: string }
class StockErrorBoundary extends Component<
  { children: ReactNode; stockKey: string },
  EBState
> {
  constructor(props: { children: ReactNode; stockKey: string }) {
    super(props);
    this.state = { error: null, symbol: props.stockKey };
  }

  // 換股票時重置錯誤狀態，讓新股票能正常顯示
  static getDerivedStateFromProps(
    props: { stockKey: string },
    state: EBState
  ) {
    if (props.stockKey !== state.symbol) {
      return { error: null, symbol: props.stockKey };
    }
    return null;
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="glass-card rounded-lg p-8 text-center border border-red-500/30">
          <div className="text-4xl mb-3">⚠️</div>
          <h3 className="text-red-400 font-bold text-lg mb-2">無法顯示此商品</h3>
          <p className="text-sm text-slate-400 mb-4">
            這支股票 / 期貨 / ETF 的資料格式可能不被支援，<br />
            或目前無法取得即時行情。
          </p>
          <p className="text-xs text-slate-500 mb-1">常見原因：</p>
          <ul className="text-xs text-slate-400 list-disc list-inside mb-4 text-left inline-block">
            <li>代號格式不正確（期貨請用 GC=F、SI=F 等）</li>
            <li>非交易時間，報價暫時無法取得</li>
            <li>該商品的歷史資料格式特殊</li>
          </ul>
          <details className="text-xs text-slate-500 text-left mt-2">
            <summary className="cursor-pointer hover:text-slate-300">技術錯誤訊息</summary>
            <pre className="mt-1 whitespace-pre-wrap bg-black/30 p-2 rounded text-left text-slate-400">
              {this.state.error.message}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('watchlist');
  const [selectedStock, setSelectedStock] = useState<{symbol: string; name: string; market: 'TW' | 'US'} | null>(null);

  return (
    <div className="min-h-screen">
      {/* 頂部導航 */}
      <header className="glass-card border-b sticky top-0 z-50" style={{ borderBottomColor: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-3">
              <h1 className="text-base font-bold tracking-[0.12em] uppercase text-slate-100">
                台股智慧監控
              </h1>
              {/* LIVE 指示器 */}
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)' }}>
                <span className="live-dot" />
                <span className="text-xs font-semibold" style={{ color: '#4ade80', letterSpacing: '0.08em' }}>LIVE</span>
              </div>
            </div>
            <div className="flex gap-1.5">
              {(['watchlist', 'portfolio'] as const).map((tab) => {
                const labels = { watchlist: '自選股', portfolio: '資產配置' };
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className="px-4 py-2 rounded text-sm font-medium transition-all duration-200"
                    style={isActive
                      ? { background: 'rgba(6,182,212,0.15)', color: '#67e8f9', border: '1px solid rgba(6,182,212,0.4)' }
                      : { background: 'transparent', color: '#64748b', border: '1px solid transparent' }
                    }
                  >
                    {labels[tab]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      {/* 主要內容區 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">

          {/* 資產配置：佔 3 欄，右側保留 MarketPanel */}
          {activeTab === 'portfolio' ? (
            <div className="lg:col-span-3">
              <Portfolio />
            </div>
          ) : (
            <>
              {/* 左側：自選股（含新聞） */}
              <div className="lg:col-span-1 space-y-4">
                {activeTab === 'watchlist' && (
                  <>
                    <WatchList onSelectStock={setSelectedStock} />
                    {selectedStock && (
                      <StockNewsFeed stock={selectedStock} />
                    )}
                  </>
                )}
              </div>

              {/* 中間：個股詳情 */}
              <div className="lg:col-span-2">
                {activeTab === 'watchlist' && selectedStock ? (
                  <StockErrorBoundary stockKey={selectedStock.symbol}>
                    <StockDetail key={selectedStock.symbol} stock={selectedStock} />
                  </StockErrorBoundary>
                ) : activeTab === 'watchlist' ? (
                  <div className="glass-card rounded-lg p-8 text-center text-slate-500">
                    請從左側選擇一檔股票查看詳細資訊
                  </div>
                ) : null}
              </div>
            </>
          )}

          {/* 右側：國際市場 + 國際局勢（所有 Tab 永遠顯示） */}
          <div className="lg:col-span-1 space-y-4">
            <MarketPanel />
            <GlobalSituationPanel />
          </div>

        </div>
      </main>
    </div>
  );
}

export default App;
