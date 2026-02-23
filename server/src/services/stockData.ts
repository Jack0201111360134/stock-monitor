import axios from 'axios';
import { PriceData, QuoteData } from '../types';

// 防止 Yahoo Finance 拒絕無 User-Agent 的請求
const yahooHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

/**
 * 取得台股即時報價 (使用證交所 API)
 */
async function getTWStockQuote(symbol: string): Promise<QuoteData | null> {
  try {
    // 先試上市 (TSE)，找不到再試上櫃 (OTC)——商品 ETF 有時掛牌在 OTC
    let data: any = null;
    for (const prefix of ['tse', 'otc']) {
      const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${prefix}_${symbol}.tw`;
      const response = await axios.get(url, { timeout: 6000 });
      if (response.data?.msgArray?.length) {
        data = response.data.msgArray[0];
        break;
      }
    }
    if (!data) return null;

    const lastPrice = parseFloat(data.z);
    const prevClose = parseFloat(data.y) || 0;
    // 非交易時間 z = "-"，fallback 昨收
    const closePrice = (isFinite(lastPrice) && lastPrice > 0) ? lastPrice : prevClose;

    // 用 data.d（民國年格式 "115/02/07"）判斷是否非交易日
    // Taiwan time = UTC + 8h
    const taiwanNow = new Date(Date.now() + 8 * 3600 * 1000);
    const todayTW = taiwanNow.toISOString().split('T')[0]; // "2026-02-22"
    let isMarketClosed = true;
    if (data.d && typeof data.d === 'string' && data.d.includes('/')) {
      const [rocY, m, d2] = data.d.split('/');
      const lastTradeDate = `${parseInt(rocY) + 1911}-${m.padStart(2,'0')}-${d2.padStart(2,'0')}`;
      isMarketClosed = lastTradeDate !== todayTW;
    }

    return {
      symbol,
      date: new Date().toISOString().split('T')[0],
      open:          parseFloat(data.o) || closePrice,
      high:          parseFloat(data.h) || closePrice,
      low:           parseFloat(data.l) || closePrice,
      close:         closePrice,
      volume:        parseInt(data.v) || 0,
      previousClose: prevClose,
      change:        isMarketClosed ? 0 : closePrice - prevClose,
      changePercent: isMarketClosed ? 0 : (prevClose > 0 ? ((closePrice - prevClose) / prevClose) * 100 : 0),
      isMarketClosed,
    };
  } catch (error) {
    console.error('取得台股報價失敗:', error);
    return null;
  }
}

// 已知過時 / 失效的代號 → 自動替換為可用的等效代號
// （Yahoo Finance 不定期下架現貨代號，改用期貨連續合約）
const symbolAliases: Record<string, string> = {
  'XAUUSD=X': 'GC=F',   // 黃金現貨 → 黃金期貨連續合約
  'XAGUSD=X': 'SI=F',   // 白銀現貨 → 白銀期貨連續合約
  'XPDUSD=X': 'PA=F',   // 鈀金現貨 → 鈀金期貨
  'XPTUSD=X': 'PL=F',   // 鉑金現貨 → 鉑金期貨
};

// 解析後的 Yahoo Finance 代碼快取（Promise 形式避免並發重複查詢）
const resolvedTickerCache = new Map<string, Promise<string>>();

/**
 * 將使用者輸入的代號解析成實際可用的 Yahoo Finance ticker
 * 特定月份期貨（如 GCK26）需要搭配交易所後綴（如 .CMX）
 */
function resolveYahooTicker(symbol: string): Promise<string> {
  if (!resolvedTickerCache.has(symbol)) {
    resolvedTickerCache.set(symbol, doResolve(symbol));
  }
  return resolvedTickerCache.get(symbol)!;
}

async function doResolve(symbol: string): Promise<string> {
  // ①  直接試原始代號（普通股票走這裡即可結束）
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`;
    const r = await axios.get(url, { headers: yahooHeaders, timeout: 5000 });
    if ((r.data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0) > 0) return symbol;
  } catch { /* 繼續試 */ }

  // ② 看起來像特定月份期貨（例 GCK26、SIJ26），用 Yahoo Search 找正確 ticker
  if (/^[A-Z]{2,4}[FGHJKMNQUVXZ]\d{2}$/.test(symbol)) {
    try {
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=5&newsCount=0`;
      const r = await axios.get(url, { headers: yahooHeaders, timeout: 6000 });
      const quotes: any[] = r.data?.quotes ?? [];
      // 找 quoteType=FUTURE 且代號去除後綴後與輸入相同的那筆
      const match = quotes.find((q: any) =>
        q.quoteType === 'FUTURE' &&
        (q.symbol ?? '').replace(/\.[^.]+$/, '').toUpperCase() === symbol.toUpperCase()
      );
      if (match?.symbol) {
        console.log(`[期貨代號解析] ${symbol} → ${match.symbol}`);
        return match.symbol as string;
      }
    } catch { /* 繼續試 */ }

    // ③ Search 失敗：逐一嘗試常見交易所後綴
    for (const suffix of ['.CMX', '.CBT', '.CME', '.NYM']) {
      try {
        const sym = symbol + suffix;
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=1d&interval=1d`;
        const r = await axios.get(url, { headers: yahooHeaders, timeout: 5000 });
        if ((r.data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0) > 0) {
          console.log(`[期貨後綴] ${symbol} → ${sym}`);
          return sym;
        }
      } catch { /* 繼續 */ }
    }
  }

  return symbol; // 找不到就用原始代號，由呼叫方處理
}

/**
 * 取得美股即時報價 (Yahoo Finance，帶 User-Agent)
 */
async function getUSStockQuote(symbol: string): Promise<QuoteData | null> {
  // 已知失效代號 → 自動換成可用的等效代號
  const effectiveSymbol = symbolAliases[symbol.toUpperCase()] ?? symbol;
  const ticker = await resolveYahooTicker(effectiveSymbol);
  try {
    // range=1d&interval=1m：一次拿到 meta（前收盤）+ 今日分鐘線（最新成交價）
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1m`;
    const response = await axios.get(url, { headers: yahooHeaders, timeout: 8000 });

    const result = response.data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;

    // 從今日 1 分線找最新一根有效 K 棒的收盤價（比 regularMarketPrice 更即時）
    const timestamps: number[] = result.timestamp ?? [];
    const minuteQuotes = result.indicators?.quote?.[0];
    let latestClose = 0;
    if (timestamps.length > 0 && minuteQuotes) {
      for (let i = timestamps.length - 1; i >= 0; i--) {
        const c = minuteQuotes.close?.[i];
        if (c && isFinite(c) && c > 0) { latestClose = c; break; }
      }
    }

    // 備援：分鐘線無資料時（休市期間）用 meta 的即時價
    const price: number =
      latestClose ||
      meta.regularMarketPrice ||
      meta.regularMarketPreviousClose ||
      meta.chartPreviousClose ||
      0;
    if (price <= 0) return null;

    const prevClose: number = meta.previousClose ?? meta.chartPreviousClose ?? price;

    return {
      symbol,
      date: new Date().toISOString().split('T')[0],
      open:  meta.regularMarketOpen ?? price,
      high:  meta.regularMarketDayHigh ?? price,
      low:   meta.regularMarketDayLow ?? price,
      close: price,
      volume: meta.regularMarketVolume ?? 0,
      previousClose: prevClose,
      change: price - prevClose,
      changePercent: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
    };
  } catch (error) {
    console.error('取得美股報價失敗:', symbol, '→', ticker, error);
    return null;
  }
}

/**
 * 取得股票即時報價
 */
export async function getStockQuote(symbol: string, market: 'TW' | 'US'): Promise<QuoteData | null> {
  if (market === 'TW') {
    return getTWStockQuote(symbol);
  } else {
    return getUSStockQuote(symbol);
  }
}

/**
 * 台股長期歷史資料（> 13 個月）—— 透過 Yahoo Finance .TW / .TWO 一次取得多年資料
 * interval: '1d' | '1wk' | '1mo'
 */
async function getTWLongHistoricalData(symbol: string, days: number, interval: string = '1d'): Promise<PriceData[]> {
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - (days * 24 * 60 * 60);

  for (const suffix of ['.TW', '.TWO']) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}${suffix}?period1=${startTime}&period2=${endTime}&interval=${interval}`;
      const response = await axios.get(url, { headers: yahooHeaders, timeout: 15000 });
      const result = response.data?.chart?.result?.[0];
      if (!result) continue;
      const data = parseYahooChart(result, symbol, false);
      if (data.length > 0) return data;
    } catch { continue; }
  }
  return [];
}

/**
 * 將月線資料聚合成年線資料
 */
function aggregateToYearly(data: PriceData[], symbol: string): PriceData[] {
  const byYear: Record<string, PriceData[]> = {};
  for (const d of data) {
    const year = d.date.substring(0, 4);
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(d);
  }
  return Object.entries(byYear)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, bars]) => {
      const lows = bars.filter(b => b.low > 0).map(b => b.low);
      return {
        symbol,
        date: `${year}-01-01`,
        open:   bars[0].open,
        high:   Math.max(...bars.map(b => b.high)),
        low:    lows.length > 0 ? Math.min(...lows) : bars[0].low,
        close:  bars[bars.length - 1].close,
        volume: bars.reduce((s, b) => s + b.volume, 0),
      };
    });
}

/**
 * 取得台股歷史資料
 * - 週線/月線：直接用 Yahoo Finance（TWSE 不提供）
 * - 短期日線（≤ 400天）：證交所官方 API，精確逐月抓取
 * - 長期日線（> 400天）：Yahoo Finance .TW，單次請求取得多年資料
 */
async function getTWHistoricalData(symbol: string, days: number, interval: string = '1d'): Promise<PriceData[]> {
  // 週線/月線：TWSE 不提供，直接走 Yahoo Finance
  if (interval !== '1d') {
    const data = await getTWLongHistoricalData(symbol, days, interval);
    if (data.length > 0) return data;
    return [];
  }
  // 日線長期資料改用 Yahoo Finance，避免逐月抓取的 13 個月上限
  if (days > 400) {
    const longData = await getTWLongHistoricalData(symbol, days, '1d');
    if (longData.length > 0) return longData;
    // Yahoo 失敗時 fallback 到 TWSE 13 個月
  }

  try {
    const monthsNeeded = Math.ceil(days / 20) + 1; // 每月約 20 個交易日
    const clampedMonths = Math.min(monthsNeeded, 13);

    const parseMonth = async (date: Date): Promise<PriceData[]> => {
      // 用本地日期元件，避免 toISOString() 在 UTC+8 轉換時跨日
      const year  = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const yyyymmdd = `${year}${month}01`;
      const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${yyyymmdd}&stockNo=${symbol}`;
      try {
        const res = await axios.get(url, { timeout: 8000 });
        if (!res.data?.data) return [];
        return res.data.data.map((row: any[]) => {
          const parts = row[0].split('/');
          const year = parseInt(parts[0]) + 1911;
          const dateStr = `${year}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
          return {
            symbol, date: dateStr,
            open:   parseFloat(row[3].replace(/,/g, '')) || 0,
            high:   parseFloat(row[4].replace(/,/g, '')) || 0,
            low:    parseFloat(row[5].replace(/,/g, '')) || 0,
            close:  parseFloat(row[6].replace(/,/g, '')) || 0,
            volume: parseInt  (row[1].replace(/,/g, '')) || 0,
          };
        }).filter((d: PriceData) => d.close > 0);
      } catch { return []; }
    };

    // 依序抓每個月（由遠到近），加小延遲避免被限流
    const allData: PriceData[] = [];
    const now = new Date();
    for (let i = clampedMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const rows = await parseMonth(d);
      allData.push(...rows);
      if (i > 0) await new Promise(r => setTimeout(r, 300));
    }

    // 去重、排序、截取天數
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const seen = new Set<string>();
    return allData
      .filter(d => { if (seen.has(d.date)) return false; seen.add(d.date); return new Date(d.date) >= cutoff; })
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (error) {
    console.error('取得台股歷史資料失敗:', error);
    return [];
  }
}

/**
 * 回傳歷史資料抓取時要嘗試的代號候選清單（同步，不做網路查詢）
 * 特定月份期貨（如 GCK26）會附上常見交易所後綴作為備援
 */
function futuresCandidates(symbol: string): string[] {
  const candidates: string[] = [symbol];
  if (/^[A-Z]{2,4}[FGHJKMNQUVXZ]\d{2}$/.test(symbol)) {
    for (const suffix of ['.CMX', '.CBT', '.CME', '.NYM']) {
      candidates.push(symbol + suffix);
    }
  }
  return candidates;
}

/** 判斷是否為分鐘/小時等盤中週期 */
function isIntradayInterval(interval: string): boolean {
  return ['1m','2m','5m','15m','30m','60m','90m','1h'].includes(interval);
}

/** 解析 Yahoo Finance 歷史資料 JSON，回傳統一格式 */
function parseYahooChart(result: any, symbol: string, intraday: boolean): PriceData[] {
  const timestamps: number[] = result.timestamp ?? [];
  if (timestamps.length === 0) return [];
  const quote = result.indicators?.quote?.[0];
  if (!quote) return [];

  const seen = new Set<string>();
  return timestamps
    .map((ts: number, i: number) => {
      // 盤中保留完整 ISO 時間字串（帶時區），日線只保留日期
      const date = intraday
        ? new Date(ts * 1000).toISOString()          // "2024-01-15T14:30:00.000Z"
        : new Date(ts * 1000).toISOString().split('T')[0]; // "2024-01-15"
      return {
        symbol,
        date,
        open:   (quote.open?.[i]   ?? 0) || 0,
        high:   (quote.high?.[i]   ?? 0) || 0,
        low:    (quote.low?.[i]    ?? 0) || 0,
        close:  (quote.close?.[i]  ?? 0) || 0,
        volume: (quote.volume?.[i] ?? 0) || 0,
      };
    })
    .filter(d => {
      if (!d.close || !isFinite(d.close)) return false;
      if (seen.has(d.date)) return false;
      seen.add(d.date);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 取得美股歷史資料 (Yahoo Finance，帶 User-Agent)
 * interval 支援：1m, 5m, 15m, 30m, 60m, 1d, 1wk
 */
async function getUSHistoricalData(symbol: string, days: number, interval: string = '1d'): Promise<PriceData[]> {
  // 1m 請求：Yahoo Finance 對期貨連續合約限制更嚴，超過 2 天容易回傳空資料
  const effectiveDays = interval === '1m' ? Math.min(days, 2) : days;
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - (effectiveDays * 24 * 60 * 60);
  const intraday = isIntradayInterval(interval);

  const effectiveSymbol = symbolAliases[symbol.toUpperCase()] ?? symbol;
  for (const sym of futuresCandidates(effectiveSymbol)) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?period1=${startTime}&period2=${endTime}&interval=${interval}`;
      const response = await axios.get(url, { headers: yahooHeaders, timeout: 10000 });

      const result = response.data?.chart?.result?.[0];
      if (!result) continue;

      const data = parseYahooChart(result, symbol, intraday);
      if (data.length > 0) return data;
    } catch { continue; }
  }
  console.error('取得美股歷史資料失敗，嘗試了所有後綴:', symbol);
  return [];
}

/**
 * 台股盤中資料（1m/5m 等）—— 透過 Yahoo Finance .TW / .TWO 後綴抓取
 */
async function getTWIntradayData(symbol: string, days: number, interval: string): Promise<PriceData[]> {
  const effectiveDays = interval === '1m' ? Math.min(days, 2) : days;
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - (effectiveDays * 24 * 60 * 60);

  for (const suffix of ['.TW', '.TWO']) {
    try {
      const sym = symbol + suffix;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?period1=${startTime}&period2=${endTime}&interval=${interval}`;
      const response = await axios.get(url, { headers: yahooHeaders, timeout: 10000 });
      const result = response.data?.chart?.result?.[0];
      if (!result) continue;

      const data = parseYahooChart(result, symbol, true);
      if (data.length > 0) return data;
    } catch { continue; }
  }
  return [];
}

/**
 * 取得歷史資料（支援多週期）
 * interval: '1m' | '5m' | '15m' | '30m' | '60m' | '1d' | '1wk' | '1mo' | '1y'
 * '1y' 為自訂：後端抓月線後聚合成年線
 */
export async function getHistoricalData(
  symbol: string,
  market: 'TW' | 'US',
  days: number = 30,
  interval: string = '1d'
): Promise<PriceData[]> {
  // 年線：先抓月線，再聚合
  if (interval === '1y') {
    if (market === 'TW') {
      const monthly = await getTWHistoricalData(symbol, days, '1mo');
      return aggregateToYearly(monthly, symbol);
    } else {
      const monthly = await getUSHistoricalData(symbol, days, '1mo');
      return aggregateToYearly(monthly, symbol);
    }
  }

  if (market === 'TW') {
    if (isIntradayInterval(interval)) {
      return getTWIntradayData(symbol, days, interval);
    }
    return getTWHistoricalData(symbol, days, interval);
  } else {
    return getUSHistoricalData(symbol, days, interval);
  }
}

/**
 * 取得三大法人買賣超 (台股)
 */
// TWSE 請求需帶 Referer，否則部分 API 會回傳空資料
const twseHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.twse.com.tw/',
  'Accept': 'application/json, text/plain, */*',
};

function parseT86Row(row: any[]): {
  symbol: string; name: string;
  foreign_buy: number; foreign_sell: number; foreign_net: number;
  trust_buy: number; trust_sell: number; trust_net: number;
  dealer_buy: number; dealer_sell: number; dealer_net: number;
} {
  const n = (v: any) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0;
  // 新版 T86 欄位（共 19 欄）:
  // [0]代號 [1]名稱
  // [2-4]  外陸資(不含外資自營商) 買/賣/淨
  // [5-7]  外資自營商             買/賣/淨
  // [8-10] 投信                   買/賣/淨
  // [11]   自營商 合計淨
  // [12-14] 自營商(自行買賣)      買/賣/淨
  // [15-17] 自營商(避險)          買/賣/淨
  // [18]   三大法人合計淨
  if (row.length >= 19) {
    return {
      symbol: row[0], name: row[1],
      foreign_buy:  n(row[2])  + n(row[5]),  // 外陸資買 + 外資自營買
      foreign_sell: n(row[3])  + n(row[6]),
      foreign_net:  n(row[4])  + n(row[7]),  // 外資合計淨
      trust_buy:    n(row[8]),
      trust_sell:   n(row[9]),
      trust_net:    n(row[10]),
      dealer_buy:   n(row[12]) + n(row[15]),
      dealer_sell:  n(row[13]) + n(row[16]),
      dealer_net:   n(row[11]),               // 自營合計淨
    };
  }
  // 舊版格式（12 欄以下）向下相容
  const n2 = (v: any) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0;
  return {
    symbol: row[0], name: row[1],
    foreign_buy: n2(row[2]), foreign_sell: n2(row[3]), foreign_net: n2(row[4]),
    trust_buy:   n2(row[5]), trust_sell:   n2(row[6]), trust_net:   n2(row[7]),
    dealer_buy:  n2(row[8]), dealer_sell:  n2(row[9]), dealer_net:  n2(row[10]),
  };
}

export async function getInstitutionalTrades(date: string): Promise<any[]> {
  // TWSE T86 使用西元年 YYYYMMDD 格式（不是民國年）
  const adDate = date.replace(/-/g, '');  // "2026-02-11" → "20260211"

  // 嘗試兩個 URL（新版 rwd 路徑 + 舊版 fund 路徑）
  const urls = [
    `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${adDate}&selectType=ALL`,
    `https://www.twse.com.tw/fund/T86?response=json&date=${adDate}&selectType=ALL`,
  ];

  for (const url of urls) {
    try {
      const response = await axios.get(url, { headers: twseHeaders, timeout: 10000 });
      if (response.data?.data?.length > 0) {
        return response.data.data.map(parseT86Row);
      }
    } catch { /* 靜默，試下一個 URL */ }
  }

  return [];
}
