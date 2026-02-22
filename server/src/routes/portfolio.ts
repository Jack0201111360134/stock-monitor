import express from 'express';
import { query, run, get } from '../db';
import { PortfolioHolding, PortfolioDetail, RebalanceAction } from '../types';
import { getStockQuote } from '../services/stockData';

// 根據股票代號判斷市場：純數字 = 台股，含字母 = 美股
function detectMarket(symbol: string): 'TW' | 'US' {
  return /^\d+$/.test(symbol) ? 'TW' : 'US';
}

// 計算市值：台股以張為單位(1張=1000股)，美股以股為單位
function calcMarketValue(price: number, shares: number, market: 'TW' | 'US'): number {
  return market === 'TW' ? price * shares * 1000 : price * shares;
}

// 取得並計算某組合的持股詳細資訊
async function buildDetails(groupId: number): Promise<{ details: PortfolioDetail[]; totalMarketValue: number }> {
  const holdings = await query<PortfolioHolding>(
    'SELECT * FROM portfolio WHERE group_id = ? ORDER BY symbol',
    [groupId]
  );

  let totalMarketValue = 0;
  const details: PortfolioDetail[] = [];

  for (const holding of holdings) {
    const market = detectMarket(holding.symbol);
    const quote = await getStockQuote(holding.symbol, market);
    const currentPrice = (quote?.close && quote.close > 0) ? quote.close : holding.cost_price;
    const marketValue = calcMarketValue(currentPrice, holding.shares, market);
    const costValue = calcMarketValue(holding.cost_price, holding.shares, market);

    totalMarketValue += marketValue;
    details.push({
      ...holding,
      current_price: currentPrice,
      market_value: marketValue,
      profit_loss: marketValue - costValue,
      profit_loss_percent: holding.cost_price > 0 ? ((currentPrice - holding.cost_price) / holding.cost_price) * 100 : 0,
      current_allocation: 0,
      allocation_diff: 0,
    });
  }

  details.forEach(d => {
    d.current_allocation = totalMarketValue > 0 ? (d.market_value / totalMarketValue) * 100 : 0;
    d.allocation_diff = d.current_allocation - d.target_allocation;
  });

  return { details, totalMarketValue };
}

const router = express.Router();

// 取得所有持股（可選擇組合）
router.get('/', async (req, res) => {
  const groupId = req.query.group_id ? Number(req.query.group_id) : undefined;
  try {
    const holdings = groupId
      ? await query<PortfolioHolding>('SELECT * FROM portfolio WHERE group_id = ? ORDER BY symbol', [groupId])
      : await query<PortfolioHolding>('SELECT * FROM portfolio ORDER BY symbol');
    res.json(holdings);
  } catch (error) {
    res.status(500).json({ error: '取得持股失敗' });
  }
});

// 取得持股詳細資訊（含即時市值），需要 group_id
router.get('/details', async (req, res) => {
  const groupId = Number(req.query.group_id) || 1;
  try {
    const { details, totalMarketValue } = await buildDetails(groupId);
    res.json({ holdings: details, totalMarketValue });
  } catch (error) {
    console.error('取得持股詳細資訊失敗:', error);
    res.status(500).json({ error: '取得持股詳細資訊失敗' });
  }
});

// 取得再平衡建議，需要 group_id
// mode: 'all'(預設，買賣都做) | 'buy_only'(只補倉) | 'sell_only'(只減碼)
router.get('/rebalance', async (req, res) => {
  const groupId = Number(req.query.group_id) || 1;
  const mode = (req.query.mode as string) || 'all';

  try {
    const { details, totalMarketValue } = await buildDetails(groupId);
    const actions: RebalanceAction[] = [];

    details.forEach(d => {
      if (Math.abs(d.allocation_diff) < 1) return;

      const market = detectMarket(d.symbol);
      const unitSize = market === 'TW' ? 1000 : 1;
      const unitLabel = market === 'TW' ? '張' : '股';
      const targetValue = (d.target_allocation / 100) * totalMarketValue;
      const diffValue = targetValue - d.market_value;
      const rawUnits = diffValue / ((d.current_price || 1) * unitSize);
      const diffShares = market === 'TW'
        ? Math.round(rawUnits * 10) / 10
        : Math.round(rawUnits);

      const needBuy  = diffShares > (market === 'TW' ? 0.1 : 1);
      const needSell = diffShares < (market === 'TW' ? -0.1 : -1);

      if (needBuy && mode !== 'sell_only') {
        actions.push({
          symbol: d.symbol, name: d.name, action: 'buy',
          shares: diffShares, amount: diffValue,
          reason: `目前 ${d.current_allocation.toFixed(1)}% → 目標 ${d.target_allocation.toFixed(1)}%，需買入約 ${diffShares}${unitLabel}`,
        });
      } else if (needSell && mode !== 'buy_only') {
        actions.push({
          symbol: d.symbol, name: d.name, action: 'sell',
          shares: Math.abs(diffShares), amount: Math.abs(diffValue),
          reason: `目前 ${d.current_allocation.toFixed(1)}% → 目標 ${d.target_allocation.toFixed(1)}%，需賣出約 ${Math.abs(diffShares)}${unitLabel}`,
        });
      }
    });

    res.json({ actions, totalMarketValue, mode });
  } catch (error) {
    res.status(500).json({ error: '取得再平衡建議失敗' });
  }
});

// 新增持股（需要 group_id）
router.post('/', async (req, res) => {
  const { group_id = 1, symbol, name, shares, cost_price, target_allocation } = req.body;
  if (!symbol || !name || shares == null || shares < 0 || cost_price == null || cost_price < 0) {
    return res.status(400).json({ error: '缺少必要欄位' });
  }
  try {
    const result = await run(
      'INSERT INTO portfolio (group_id, symbol, name, shares, cost_price, target_allocation) VALUES (?, ?, ?, ?, ?, ?)',
      [group_id, symbol, name, shares, cost_price, target_allocation || 0]
    );
    res.json({ id: result.lastID, group_id, symbol, name, shares, cost_price, target_allocation });
  } catch (error) {
    res.status(500).json({ error: '新增持股失敗' });
  }
});

// 更新持股
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { shares, cost_price, target_allocation } = req.body;
  try {
    const result = await run(
      'UPDATE portfolio SET shares = ?, cost_price = ?, target_allocation = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [shares, cost_price, target_allocation, id]
    );
    if (result.changes === 0) return res.status(404).json({ error: '找不到此持股' });
    res.json({ message: '更新成功' });
  } catch (error) {
    res.status(500).json({ error: '更新持股失敗' });
  }
});

// 刪除持股
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await run('DELETE FROM portfolio WHERE id = ?', [id]);
    if (result.changes === 0) return res.status(404).json({ error: '找不到此持股' });
    res.json({ message: '刪除成功' });
  } catch (error) {
    res.status(500).json({ error: '刪除持股失敗' });
  }
});

export default router;
