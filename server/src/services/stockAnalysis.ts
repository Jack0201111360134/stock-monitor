import axios from 'axios';
import { PriceData } from '../types';

const yahooHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};
const edgarHeaders = {
  'User-Agent': 'StockMonitor/1.0 (personal project)',
  'Accept': 'application/json',
};

// ─── 型別定義 ──────────────────────────────────────────────

export interface MonthlyRevenue {
  yearMonth: string;   // "2026/01"
  revenue: number;     // 億元 (TW) 或 $B (US)
  yoyGrowth?: number;  // YoY 成長率 %
}

export interface QuarterlyFinancials {
  period: string;           // "2025Q3" 或 "CY2025Q4"
  eps?: number;
  revenue?: number;         // 億元 (TW) 或 $B (US)
  grossMargin?: number;     // %
  operatingMargin?: number; // %
}

export interface FundamentalsResult {
  pe?: number;
  pb?: number;
  dividendYield?: number;
  monthlyRevenue: MonthlyRevenue[];
  quarterlyData: QuarterlyFinancials[];
  latestGrossMargin?: number;
  latestOperatingMargin?: number;
  analysis: string;
}

// ─── 技術指標計算 ────────────────────────────────────────────

function calcMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] ?? 0;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function calcVolumeRatio(history: PriceData[]): number {
  if (history.length < 2) return 1;
  const last = history[history.length - 1];
  const avgPeriod = history.slice(-21, -1);
  if (avgPeriod.length === 0) return 1;
  const avgVol = avgPeriod.reduce((a, b) => a + b.volume, 0) / avgPeriod.length;
  return avgVol > 0 ? last.volume / avgVol : 1;
}

export interface TechnicalResult {
  ma5: number;
  ma20: number;
  ma60: number;
  rsi14: number;
  volumeRatio: number;
  week52High: number;
  week52Low: number;
  week52Position: number;
  trend: 'strong_up' | 'up' | 'neutral' | 'down' | 'strong_down';
  signals: string[];
  analysis: string;
}

export function calcTechnicals(history: PriceData[], currentPrice: number): TechnicalResult {
  const closes = history.map(d => d.close);
  const ma5  = calcMA(closes, 5);
  const ma20 = calcMA(closes, 20);
  const ma60 = calcMA(closes, 60);
  const rsi14 = calcRSI(closes);
  const volumeRatio = calcVolumeRatio(history);

  const week52High = closes.length > 0 ? Math.max(...closes) : currentPrice;
  const week52Low  = closes.length > 0 ? Math.min(...closes) : currentPrice;
  const week52Position = week52High > week52Low
    ? ((currentPrice - week52Low) / (week52High - week52Low)) * 100
    : 50;

  const signals: string[] = [];

  if (currentPrice > ma5 && ma5 > ma20 && ma20 > ma60) {
    signals.push('股價站在所有均線之上，多頭排列');
  } else if (currentPrice < ma5 && ma5 < ma20 && ma20 < ma60) {
    signals.push('股價跌破所有均線，空頭排列');
  } else if (currentPrice > ma20) {
    signals.push('股價站在月線（MA20）之上，短中線偏多');
  } else if (currentPrice < ma20) {
    signals.push('股價跌破月線（MA20），需觀察支撐');
  }

  if (closes.length >= 22) {
    const prevMA5  = calcMA(closes.slice(0, -1), 5);
    const prevMA20 = calcMA(closes.slice(0, -1), 20);
    if (prevMA5 < prevMA20 && ma5 > ma20) signals.push('MA5 剛突破 MA20，黃金交叉買進訊號');
    if (prevMA5 > prevMA20 && ma5 < ma20) signals.push('MA5 跌破 MA20，死亡交叉賣出訊號');
  }

  if (rsi14 > 80) signals.push(`RSI ${rsi14.toFixed(0)}，進入超買區（>80），注意回檔風險`);
  else if (rsi14 > 70) signals.push(`RSI ${rsi14.toFixed(0)}，偏強但接近超買`);
  else if (rsi14 < 20) signals.push(`RSI ${rsi14.toFixed(0)}，超賣區（<20），可能出現反彈`);
  else if (rsi14 < 30) signals.push(`RSI ${rsi14.toFixed(0)}，弱勢但接近超賣`);
  else signals.push(`RSI ${rsi14.toFixed(0)}，處於正常區間`);

  if (volumeRatio > 2) signals.push(`今日成交量是均量的 ${volumeRatio.toFixed(1)} 倍，爆量！`);
  else if (volumeRatio > 1.5) signals.push(`成交量放大（均量 ${volumeRatio.toFixed(1)} 倍），市場關注度提升`);
  else if (volumeRatio < 0.5) signals.push('成交量萎縮，市場觀望氣氛濃');

  if (week52Position > 90) signals.push('接近 52 週高點，注意壓力');
  else if (week52Position < 10) signals.push('接近 52 週低點，注意是否築底');

  let trend: TechnicalResult['trend'] = 'neutral';
  let score = 0;
  if (currentPrice > ma5) score++;
  if (currentPrice > ma20) score++;
  if (currentPrice > ma60) score++;
  if (ma5 > ma20) score++;
  if (rsi14 > 55) score++;
  score -= (rsi14 < 45 ? 2 : 0);
  if (currentPrice < ma5) score--;
  if (currentPrice < ma20) score--;

  if (score >= 4) trend = 'strong_up';
  else if (score >= 2) trend = 'up';
  else if (score <= -3) trend = 'strong_down';
  else if (score <= -1) trend = 'down';

  const trendText: Record<TechnicalResult['trend'], string> = {
    strong_up:   '強勢多頭',
    up:          '偏多趨勢',
    neutral:     '盤整觀望',
    down:        '偏空趨勢',
    strong_down: '強勢空頭',
  };

  const analysis = `技術面整體呈現「${trendText[trend]}」。` +
    `MA5=${ma5.toFixed(1)}、MA20=${ma20.toFixed(1)}、MA60=${ma60.toFixed(1)}。` +
    `目前股價在 52 週區間的 ${week52Position.toFixed(0)}% 位置` +
    `（年高 ${week52High.toFixed(1)}，年低 ${week52Low.toFixed(1)}）。`;

  return { ma5, ma20, ma60, rsi14, volumeRatio, week52High, week52Low, week52Position, trend, signals, analysis };
}

// ─── 台股基本面（FinMind + TWSE） ────────────────────────────

/** FinMind 月營收 → 最近 6 個月 + YoY */
async function getTWMonthlyRevenue(symbol: string): Promise<MonthlyRevenue[]> {
  try {
    // 抓 14 個月，讓最新 6 個月都能算 YoY
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 14);
    const start = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`;

    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMonthRevenue&data_id=${symbol}&start_date=${start}`;
    const res = await axios.get(url, { timeout: 8000 });
    if (!res.data?.data?.length) return [];

    // 建立 year/month → revenue 的 map
    const map = new Map<string, number>();
    for (const row of res.data.data) {
      const key = `${row.revenue_year}/${String(row.revenue_month).padStart(2, '0')}`;
      map.set(key, row.revenue);
    }

    // 取最近 6 個月
    const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const recent = sorted.slice(-6);

    return recent.map(([yearMonth, revenue]) => {
      const [y, m] = yearMonth.split('/');
      const prevYear = `${parseInt(y) - 1}/${m}`;
      const prevRevenue = map.get(prevYear);
      const yoyGrowth = prevRevenue && prevRevenue > 0
        ? ((revenue - prevRevenue) / prevRevenue) * 100
        : undefined;
      return {
        yearMonth,
        revenue: Math.round(revenue / 1e8),   // 轉為億元
        yoyGrowth,
      };
    });
  } catch {
    return [];
  }
}

/** FinMind 季度財務報表 → 最近 4 季 EPS、毛利率、營業利益率 */
async function getTWQuarterlyFinancials(symbol: string): Promise<QuarterlyFinancials[]> {
  try {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const start = `${twoYearsAgo.getFullYear()}-01-01`;

    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockFinancialStatements&data_id=${symbol}&start_date=${start}`;
    const res = await axios.get(url, { timeout: 10000 });
    if (!res.data?.data?.length) return [];

    // 按日期分組，每組是一個季度
    const byDate = new Map<string, Record<string, number>>();
    for (const row of res.data.data) {
      if (!byDate.has(row.date)) byDate.set(row.date, {});
      byDate.get(row.date)![row.type] = row.value;
    }

    // 取最近 4 季
    const quarters = [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-4);

    return quarters.map(([date, metrics]) => {
      // date 格式 "2025-09-30" → 轉成 "2025Q3"
      const d = new Date(date);
      const month = d.getMonth() + 1;
      const quarter = Math.ceil(month / 3);
      const period = `${d.getFullYear()}Q${quarter}`;

      const revenue = metrics['Revenue'] ?? 0;
      const grossProfit = metrics['GrossProfit'] ?? 0;
      const operatingIncome = metrics['OperatingIncome'] ?? 0;
      const eps = metrics['EPS'];

      return {
        period,
        eps,
        revenue: revenue > 0 ? Math.round(revenue / 1e8) : undefined, // 億元
        grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : undefined,
        operatingMargin: revenue > 0 ? (operatingIncome / revenue) * 100 : undefined,
      };
    });
  } catch {
    return [];
  }
}

/** TWSE BWIBBU → P/E、P/B、殖利率 */
async function getTWValuation(symbol: string): Promise<Pick<FundamentalsResult, 'pe' | 'pb' | 'dividendYield'>> {
  try {
    const today = new Date();
    const yyyymmdd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const url = `https://www.twse.com.tw/exchangeReport/BWIBBU?response=json&date=${yyyymmdd}&stockNo=${symbol}`;
    const res = await axios.get(url, { timeout: 6000 });
    if (!res.data?.data?.length) return {};
    const row = res.data.data[res.data.data.length - 1];
    // 欄位：[0]日期 [1]殖利率 [2]股利年度 [3]本益比 [4]股價淨值比
    return {
      dividendYield: parseFloat(row[1]) || undefined,
      pe:            parseFloat(row[3]) || undefined,
      pb:            parseFloat(row[4]) || undefined,
    };
  } catch {
    return {};
  }
}

export async function getTWFundamentals(symbol: string): Promise<FundamentalsResult> {
  const [monthlyRevenue, quarterlyData, valuation] = await Promise.all([
    getTWMonthlyRevenue(symbol),
    getTWQuarterlyFinancials(symbol),
    getTWValuation(symbol),
  ]);

  const latestQ = quarterlyData[quarterlyData.length - 1];
  const latestGrossMargin    = latestQ?.grossMargin;
  const latestOperatingMargin = latestQ?.operatingMargin;

  // 產生白話分析文字
  const parts: string[] = [];
  if (valuation.pe) parts.push(`本益比 ${valuation.pe.toFixed(1)}x`);
  if (valuation.pb) parts.push(`股價淨值比 ${valuation.pb.toFixed(1)}x`);
  if (valuation.dividendYield) parts.push(`殖利率 ${valuation.dividendYield.toFixed(2)}%`);
  if (latestGrossMargin) parts.push(`毛利率 ${latestGrossMargin.toFixed(1)}%`);
  if (latestOperatingMargin) parts.push(`營益率 ${latestOperatingMargin.toFixed(1)}%`);

  // 月營收趨勢判斷
  let revenueText = '';
  if (monthlyRevenue.length >= 2) {
    const latest = monthlyRevenue[monthlyRevenue.length - 1];
    const posCount = monthlyRevenue.filter(m => (m.yoyGrowth ?? 0) > 0).length;
    if (latest.yoyGrowth !== undefined) {
      revenueText = `最新月營收 ${latest.revenue} 億元，YoY ${latest.yoyGrowth > 0 ? '+' : ''}${latest.yoyGrowth.toFixed(1)}%。`;
      if (posCount >= 4) revenueText += '近期營收持續成長。';
    }
  }

  // EPS 趨勢判斷
  let epsText = '';
  const epsData = quarterlyData.filter(q => q.eps !== undefined);
  if (epsData.length >= 2) {
    const latestEps = epsData[epsData.length - 1].eps!;
    const prevEps   = epsData[epsData.length - 2].eps!;
    epsText = `最新季 EPS ${latestEps.toFixed(2)} 元（${latestEps > prevEps ? '↑ 優於上季' : '↓ 低於上季'}）。`;
  }

  const analysis = [
    parts.length > 0 ? `估值：${parts.join('、')}。` : '',
    revenueText,
    epsText,
  ].filter(Boolean).join(' ') || '基本面資料載入中...';

  return {
    ...valuation,
    monthlyRevenue,
    quarterlyData,
    latestGrossMargin,
    latestOperatingMargin,
    analysis,
  };
}

// ─── 美股基本面（SEC EDGAR XBRL） ────────────────────────────

// 記憶 ticker → CIK 對應，避免重複查詢
const cikCache = new Map<string, string>();

async function getEdgarCIK(ticker: string): Promise<string | null> {
  if (cikCache.has(ticker)) return cikCache.get(ticker)!;
  try {
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(ticker)}%22&forms=10-K&dateRange=custom&startdt=2020-01-01`;
    const res = await axios.get(url, { headers: edgarHeaders, timeout: 8000 });
    const cik: string | undefined = res.data?.hits?.hits?.[0]?._source?.ciks?.[0];
    if (!cik) return null;
    const padded = cik.replace(/^0+/, '').padStart(10, '0');
    cikCache.set(ticker, padded);
    return padded;
  } catch {
    return null;
  }
}

/** 從 EDGAR concept API 取得單季資料（帶 frame 欄位） */
async function getEdgarConcept(cik: string, concept: string): Promise<Array<{period: string; val: number; end: string}>> {
  try {
    const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`;
    const res = await axios.get(url, { headers: edgarHeaders, timeout: 10000 });
    const units = res.data?.units;
    if (!units) return [];

    // 找到第一個有資料的 unit（通常是 USD 或 USD/shares）
    const unitData: any[] = (Object.values(units)[0] as any[]) ?? [];

    // 只取有 frame 的（單期數字），例如 CY2025Q1、CY2025
    return unitData
      .filter((e: any) => e.frame && (e.form === '10-K' || e.form === '10-Q'))
      .map((e: any) => ({ period: e.frame as string, val: e.val as number, end: e.end as string }))
      .sort((a, b) => a.end.localeCompare(b.end));
  } catch {
    return [];
  }
}

export async function getUSFundamentals(symbol: string): Promise<FundamentalsResult> {
  // 取得 CIK 與基本 v8 chart 資訊（並行）
  const [cik, chartRes] = await Promise.all([
    getEdgarCIK(symbol),
    axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`, {
      headers: yahooHeaders, timeout: 6000,
    }).catch(() => null),
  ]);

  const meta = chartRes?.data?.chart?.result?.[0]?.meta ?? {};
  const high52 = meta.fiftyTwoWeekHigh as number | undefined;
  const low52  = meta.fiftyTwoWeekLow  as number | undefined;
  const price  = meta.regularMarketPrice as number | undefined;
  const longName = (meta.longName ?? symbol) as string;

  // 沒有 CIK → 僅回傳 52 週資訊
  if (!cik) {
    const analysis = buildUSAnalysis(longName, meta.exchangeName, high52, low52, price, [], []);
    return { monthlyRevenue: [], quarterlyData: [], analysis };
  }

  // 並行取 EPS 與 Revenue
  const [epsData, revDataMain, revDataAlt] = await Promise.all([
    getEdgarConcept(cik, 'EarningsPerShareBasic'),
    getEdgarConcept(cik, 'RevenueFromContractWithCustomerExcludingAssessedTax'),
    getEdgarConcept(cik, 'Revenues'),
  ]);

  const revData = revDataMain.length > 0 ? revDataMain : revDataAlt;

  // 取最近 4 季
  const recentEps = epsData.filter(e => /CY\d{4}Q\d/.test(e.period)).slice(-4);
  const recentRev = revData.filter(e => /CY\d{4}Q\d/.test(e.period)).slice(-4);

  // 合併成 QuarterlyFinancials
  const periods = [...new Set([
    ...recentEps.map(e => e.period),
    ...recentRev.map(r => r.period),
  ])].sort().slice(-4);

  const quarterlyData: QuarterlyFinancials[] = periods.map(period => {
    const eps = recentEps.find(e => e.period === period);
    const rev = recentRev.find(r => r.period === period);
    return {
      period,
      eps: eps?.val,
      revenue: rev ? Math.round(rev.val / 1e9 * 10) / 10 : undefined, // $B，保留 1 位小數
    };
  });

  const analysis = buildUSAnalysis(longName, meta.exchangeName, high52, low52, price, recentEps, recentRev);

  return { monthlyRevenue: [], quarterlyData, analysis };
}

function buildUSAnalysis(
  name: string,
  exchange: string | undefined,
  high52: number | undefined,
  low52: number | undefined,
  price: number | undefined,
  epsData: Array<{period: string; val: number}>,
  revData: Array<{period: string; val: number}>,
): string {
  const parts: string[] = [];

  if (high52 && low52 && price) {
    const pos = Math.round(((price - low52) / (high52 - low52)) * 100);
    parts.push(`52週區間 $${low52.toFixed(2)}~$${high52.toFixed(2)}（目前 ${pos}% 位置）`);
  }

  if (epsData.length >= 2) {
    const latest = epsData[epsData.length - 1];
    const prev   = epsData[epsData.length - 2];
    const dir = latest.val > prev.val ? '↑' : '↓';
    parts.push(`最新季 EPS $${latest.val.toFixed(2)} (${dir} vs 前季 $${prev.val.toFixed(2)})`);
  }

  if (revData.length >= 2) {
    const latest = revData[revData.length - 1];
    const prev   = revData[revData.length - 2];
    const growth = ((latest.val - prev.val) / Math.abs(prev.val)) * 100;
    parts.push(`最新季營收 $${(latest.val / 1e9).toFixed(1)}B（${growth > 0 ? '+' : ''}${growth.toFixed(1)}% 季比）`);
  }

  return parts.length > 0
    ? `${name}${exchange ? ` (${exchange})` : ''}：${parts.join('；')}。`
    : `${name} 基本面資料載入中...`;
}

// ─── 新聞 ────────────────────────────────────────────────────

export interface NewsItem {
  title: string;
  url: string;
  publishTime: string;
  publisher?: string;
}

// RSS 解析輔助（供 getStockNews 各來源共用）
function parseNewsRss(xml: string, limit = 6): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = m[1];
    const title   = (/<title>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const link    = (/<link>([\s\S]*?)<\/link>/.exec(block)?.[1] ?? '').trim();
    const pubDate = (/<pubDate>([\s\S]*?)<\/pubDate>/.exec(block)?.[1] ?? '').trim();
    const source  = (/<source[^>]*>([\s\S]*?)<\/source>/.exec(block)?.[1] ?? '').trim();
    if (title && !title.startsWith('<')) {
      items.push({
        title,
        url: link,
        publisher: source || undefined,
        publishTime: pubDate ? new Date(pubDate).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '',
      });
    }
  }
  return items;
}

export async function getStockNews(symbol: string, market: 'TW' | 'US'): Promise<NewsItem[]> {
  const ticker = market === 'TW' ? `${symbol}.TW` : symbol;
  const rssHeaders = { 'User-Agent': yahooHeaders['User-Agent'], 'Accept': 'application/rss+xml, text/xml, */*' };

  // ① Yahoo Finance RSS（最貼近特定股票，代號直接對應）
  try {
    const region = market === 'TW' ? 'TW' : 'US';
    const lang   = market === 'TW' ? 'zh-TW' : 'en-US';
    const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=${region}&lang=${lang}`;
    const res = await axios.get(rssUrl, { headers: rssHeaders, timeout: 7000, responseType: 'text' });
    const items = parseNewsRss(res.data ?? '');
    if (items.length >= 2) return items;   // 至少 2 筆才算有效
  } catch { /* 靜默 */ }

  // ② Google News RSS（用股票代號 + 市場關鍵字搜尋，不同股票結果必然不同）
  try {
    const q    = market === 'TW' ? `${symbol} 台股` : `${symbol} stock`;
    const hl   = market === 'TW' ? 'zh-TW' : 'en-US';
    const gl   = market === 'TW' ? 'TW' : 'US';
    const ceid = market === 'TW' ? 'TW:zh-Hant' : 'US:en';
    const url  = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
    const res  = await axios.get(url, { headers: rssHeaders, timeout: 8000, responseType: 'text' });
    const items = parseNewsRss(res.data ?? '');
    if (items.length > 0) return items;
  } catch { /* 靜默 */ }

  // ③ Yahoo Finance search API（最後手段，可能回傳通用市場新聞）
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&quotesCount=1&newsCount=8`;
    const res = await axios.get(url, { headers: yahooHeaders, timeout: 7000 });
    const newsItems: any[] = res.data?.news ?? [];
    if (newsItems.length > 0) {
      return newsItems
        .map((item: any) => ({
          title: (item.title ?? '').trim(),
          url: item.link ?? '',
          publisher: item.publisher ?? '',
          publishTime: item.providerPublishTime
            ? new Date(item.providerPublishTime * 1000).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
            : '',
        }))
        .filter((item: NewsItem) => item.title);
    }
  } catch { /* 靜默 */ }

  return [];
}

// ─── 新聞摘要生成（多段落詳細版）────────────────────────────────

export function generateNewsDigest(
  news: NewsItem[],
  changePercent: number,
): string {
  if (news.length === 0) return '';

  const titles = news.map(n => n.title);
  const all = titles.join(' ');

  // ── 主題偵測 ──────────────────────────────────────────────────
  const themes: string[] = [];
  if (/聯準會|Fed|升息|降息|利率|央行|FOMC|rate cut|rate hike/i.test(all))         themes.push('Fed 利率');
  if (/財報|EPS|盈餘|earnings|revenue|獲利|profit|quarterly/i.test(all))            themes.push('財報');
  if (/AI|人工智慧|晶片|chip|半導體|semiconductor|GPU/i.test(all))                  themes.push('AI/半導體');
  if (/CPI|通膨|inflation|PCE/i.test(all))                                          themes.push('通膨');
  if (/關稅|tariff|貿易戰|trade war|制裁|sanction/i.test(all))                      themes.push('貿易政策');
  if (/黃金|gold|原油|oil|白銀|silver|商品/i.test(all))                             themes.push('商品');
  if (/裁員|layoff|倒閉|破產|bankruptcy|訴訟|lawsuit|罰款/i.test(all))              themes.push('風險事件');
  if (/新品|launch|partnership|合作|acquisition|buyback|回購/i.test(all))           themes.push('企業動態');

  // ── 情緒計分 ──────────────────────────────────────────────────
  const bull = (all.match(/漲|創高|突破|beat|exceed|surge|rally|買超|回購/gi) ?? []).length;
  const bear = (all.match(/跌|下跌|miss|plunge|decline|跌破|賣超|下修|裁員/gi) ?? []).length;
  const net  = bull - bear;
  const sentStr = net >= 2 ? '整體消息面偏正向' : net <= -2 ? '整體消息面偏負向' : '消息面中性偏觀望';
  const dayStr  = Math.abs(changePercent) > 0.5
    ? `（今日 ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%）` : '';

  // 第 1 段：主題 + 整體方向
  let digest = `【焦點主題】${themes.length > 0 ? themes.slice(0, 4).join('・') : '一般市場動態'}\n`;
  digest    += `${sentStr}${dayStr}，共 ${news.length} 則報導。\n\n`;

  // 第 2 段：正向因素
  const bullT = titles.filter(t => /漲|創高|突破|beat|超預期|買超|回購|成長|growth|surge/i.test(t));
  if (bullT.length > 0) {
    digest += `【正向因素】${bullT.slice(0, 2).join('；')}。\n\n`;
  }

  // 第 3 段：風險因素
  const bearT = titles.filter(t => /跌|下修|裁員|miss|不如預期|賣超|關稅|tariff|警告|訴訟/i.test(t));
  if (bearT.length > 0) {
    digest += `【風險因素】${bearT.slice(0, 2).join('；')}。\n\n`;
  }

  // 第 4 段：近期頭條
  digest += `【近期頭條】${titles.slice(0, 2).join(' / ')}`;

  return digest.trim();
}

// ─── 整體摘要文字生成 ─────────────────────────────────────────

export function generateSummaryText(
  tech: TechnicalResult,
  fund: FundamentalsResult,
  changePercent: number,
): string {
  const trendMap: Record<TechnicalResult['trend'], string> = {
    strong_up:   '強勢多頭，適合短線追蹤',
    up:          '偏多趨勢，可留意買點',
    neutral:     '盤整整理中，方向待確認',
    down:        '偏空趨勢，建議觀望',
    strong_down: '強勢空頭，注意停損保護',
  };

  let text = `整體判斷：${trendMap[tech.trend]}。\n\n`;
  text += `技術面：${tech.analysis}\n\n`;

  if (tech.signals.length > 0) {
    text += `關鍵訊號：\n`;
    tech.signals.slice(0, 4).forEach(s => { text += `▸ ${s}\n`; });
    text += '\n';
  }

  text += `基本面：${fund.analysis}\n\n`;

  const dayMove = Math.abs(changePercent);
  if (dayMove > 5) text += `注意：今日波動劇烈（${changePercent.toFixed(1)}%），注意風險控管。\n`;
  else if (dayMove > 3) text += `注意：今日有較大波動（${changePercent.toFixed(1)}%），留意追高風險。\n`;

  return text.trim();
}
