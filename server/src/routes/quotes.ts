import express from 'express';
import { getStockQuote, getHistoricalData } from '../services/stockData';
import {
  calcTechnicals,
  getTWFundamentals,
  getUSFundamentals,
  getStockNews,
  generateSummaryText,
  generateNewsDigest,
} from '../services/stockAnalysis';

const router = express.Router();

// 取得美元/台幣即時匯率（必須放在 /:symbol 之前，否則會被覆蓋）
router.get('/exchange-rate', async (_req, res) => {
  try {
    const quote = await getStockQuote('USDTWD=X', 'US');
    if (!quote || !quote.close) {
      return res.status(503).json({ error: '無法取得匯率' });
    }
    res.json({ rate: quote.close, updatedAt: new Date().toISOString() });
  } catch {
    res.status(500).json({ error: '取得匯率失敗' });
  }
});

// 取得即時報價
router.get('/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { market } = req.query;

  if (!market || (market !== 'TW' && market !== 'US')) {
    return res.status(400).json({ error: '需要指定市場 (TW/US)' });
  }

  try {
    const quote = await getStockQuote(symbol, market as 'TW' | 'US');
    if (!quote) {
      return res.status(404).json({ error: '找不到股票資料' });
    }
    res.json(quote);
  } catch (error) {
    console.error('取得報價失敗:', error);
    res.status(500).json({ error: '取得報價失敗' });
  }
});

// 取得歷史資料（支援 interval: 1m/5m/15m/30m/60m/1d/1wk）
router.get('/:symbol/history', async (req, res) => {
  const { symbol } = req.params;
  const { market, days = '365', interval = '1d' } = req.query;

  if (!market || (market !== 'TW' && market !== 'US')) {
    return res.status(400).json({ error: '需要指定市場 (TW/US)' });
  }

  const validIntervals = ['1m','5m','15m','30m','60m','1d','1wk','1mo','1y'];
  const safeInterval = validIntervals.includes(interval as string) ? (interval as string) : '1d';

  try {
    const history = await getHistoricalData(
      symbol, market as 'TW' | 'US',
      parseInt(days as string),
      safeInterval
    );
    res.json(history);
  } catch (error) {
    console.error('取得歷史資料失敗:', error);
    res.status(500).json({ error: '取得歷史資料失敗' });
  }
});

// 只取新聞（輕量，不做技術分析）
router.get('/:symbol/news', async (req, res) => {
  const { symbol } = req.params;
  const { market } = req.query;
  if (!market || (market !== 'TW' && market !== 'US')) {
    return res.status(400).json({ error: '需要指定市場 (TW/US)' });
  }
  try {
    const news = await getStockNews(symbol, market as 'TW' | 'US');
    res.json(news);
  } catch {
    res.status(500).json({ error: '取得新聞失敗' });
  }
});

// 取得 AI 分析摘要（技術面 + 基本面 + 新聞）
router.get('/:symbol/summary', async (req, res) => {
  const { symbol } = req.params;
  const { market } = req.query;

  if (!market || (market !== 'TW' && market !== 'US')) {
    return res.status(400).json({ error: '需要指定市場 (TW/US)' });
  }

  try {
    const mkt = market as 'TW' | 'US';

    // 並行：報價、歷史資料（365天）、基本面、新聞
    const [quote, history, fundamentals, news] = await Promise.all([
      getStockQuote(symbol, mkt),
      getHistoricalData(symbol, mkt, 365),
      mkt === 'TW' ? getTWFundamentals(symbol) : getUSFundamentals(symbol),
      getStockNews(symbol, mkt),
    ]);

    if (!quote) {
      return res.status(404).json({ error: '找不到股票資料' });
    }

    const technicals = calcTechnicals(history, quote.close);
    const summaryText = generateSummaryText(technicals, fundamentals, quote.changePercent ?? 0);
    const newsDigest = generateNewsDigest(news, quote.changePercent ?? 0);

    res.json({
      symbol,
      market: mkt,
      quote,
      technicals,
      fundamentals,
      news,
      summaryText,
      newsDigest,
    });
  } catch (error) {
    console.error('取得摘要失敗:', error);
    res.status(500).json({ error: '取得摘要失敗' });
  }
});

export default router;
