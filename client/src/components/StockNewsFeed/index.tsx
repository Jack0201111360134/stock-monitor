import { useState, useEffect } from 'react';
import { quotesApi } from '../../services/api';

interface NewsItem {
  title: string;
  url: string;
  publishTime: string;
  publisher?: string;
}

interface Props {
  stock: { symbol: string; name: string; market: 'TW' | 'US' };
}

// 從標題自動產生主題標籤
function getThemes(news: NewsItem[]): string[] {
  const text = news.map(n => n.title).join(' ');
  const themes: string[] = [];
  if (/漲|創高|突破|強勢|買超|看多|反彈|升|bull|rise|gain|high/i.test(text))   themes.push('📈 多方');
  if (/跌|下跌|回落|賣超|看空|警告|跌破|bear|fall|drop|loss|down/i.test(text)) themes.push('📉 空方');
  if (/聯準會|Fed|升息|降息|利率|央行|FOMC/i.test(text))                       themes.push('🏦 貨幣');
  if (/財報|EPS|盈餘|earnings|revenue|獲利/i.test(text))                        themes.push('📊 財報');
  if (/黃金|白銀|gold|silver|原油|oil|銅|copper/i.test(text))                  themes.push('🪙 商品');
  if (/裁員|倒閉|破產|訴訟|罰款|tariff|關稅/i.test(text))                      themes.push('⚠️ 風險');
  if (/AI|人工智慧|晶片|chip|半導體|semiconductor/i.test(text))                themes.push('🤖 科技');
  return themes;
}

// 客戶端版新聞懶人包（精簡版）
function buildDigest(news: NewsItem[]): string {
  if (news.length === 0) return '';
  const titles = news.map(n => n.title).join(' ');
  const bull = (titles.match(/漲|突破|強勢|買超|反彈|bull|rise|gain|high|rally/gi) ?? []).length;
  const bear = (titles.match(/跌|下跌|賣超|警告|跌破|bear|fall|drop|loss|decline/gi) ?? []).length;

  const themes: string[] = [];
  if (/聯準會|Fed|升息|降息|利率|FOMC/i.test(titles)) themes.push('Fed政策');
  if (/財報|EPS|盈餘|earnings|revenue/i.test(titles)) themes.push('財報');
  if (/AI|晶片|半導體|semiconductor/i.test(titles))   themes.push('AI科技');
  if (/通膨|CPI|inflation/i.test(titles))              themes.push('通膨');
  if (/關稅|tariff|貿易/i.test(titles))               themes.push('貿易');
  if (/裁員|破產|訴訟|風險/i.test(titles))            themes.push('風險');

  const net = bull - bear;
  let sentiment = net >= 2 ? '偏多' : net <= -2 ? '偏空' : '中性';

  let text = `消息面${sentiment}`;
  if (themes.length > 0) text += `，焦點：${themes.slice(0, 2).join('、')}`;
  text += `。`;
  return text;
}

export default function StockNewsFeed({ stock }: Props) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setNews([]);
    quotesApi.getNews(stock.symbol, stock.market)
      .then(r => setNews(r.data))
      .catch(() => setNews([]))
      .finally(() => setLoading(false));
  }, [stock.symbol, stock.market]);

  if (loading) {
    return (
      <div className="glass-card rounded-lg p-3 text-xs text-slate-500 animate-pulse text-center">
        載入新聞中...
      </div>
    );
  }

  if (news.length === 0) return null;

  const themes = getThemes(news);
  const digest = buildDigest(news);

  return (
    <div className="glass-card rounded-lg overflow-hidden">
      {/* 標題列 */}
      <div className="px-3 py-2 border-b border-white/10 glass-header flex items-center gap-1">
        <span className="text-xs font-bold text-slate-300">📰</span>
        <span className="text-xs font-bold text-slate-300 truncate">{stock.name} 消息</span>
      </div>

      {/* 🧠 懶人包摘要 */}
      {digest && (
        <div className="px-3 pt-2.5 pb-1.5">
          <div className="rounded px-2.5 py-2" style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)' }}>
            <div className="text-xs font-bold text-indigo-400 mb-1">🧠 懶人包</div>
            <p className="text-xs text-slate-300 leading-relaxed">{digest}</p>
          </div>
        </div>
      )}

      {/* 主題標籤 */}
      {themes.length > 0 && (
        <div className="px-3 pt-1.5 flex flex-wrap gap-1">
          {themes.map((t, i) => (
            <span key={i} className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', color: '#2563eb' }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {/* 新聞列表 */}
      <div className="dark-divide mt-1.5">
        {news.slice(0, 5).map((n, i) => (
          <div key={i} className="px-3 py-2">
            {n.url ? (
              <a
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 hover:underline leading-snug block line-clamp-2"
              >
                {n.title}
              </a>
            ) : (
              <span className="text-xs text-slate-400 leading-snug">{n.title}</span>
            )}
            <div className="text-xs text-slate-600 mt-0.5 truncate">
              {n.publisher && <span>{n.publisher} · </span>}
              {n.publishTime}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
