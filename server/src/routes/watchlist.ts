import express from 'express';
import { query, run } from '../db';
import { WatchlistItem } from '../types';

const router = express.Router();

// 取得所有自選股
router.get('/', async (req, res) => {
  try {
    const watchlist = await query<WatchlistItem>('SELECT * FROM watchlist ORDER BY created_at DESC');
    res.json(watchlist);
  } catch (error) {
    console.error('取得自選股失敗:', error);
    res.status(500).json({ error: '取得自選股失敗' });
  }
});

// 新增自選股
router.post('/', async (req, res) => {
  const { symbol, name, market } = req.body;

  if (!symbol || !name || !market) {
    return res.status(400).json({ error: '缺少必要欄位' });
  }

  try {
    const result = await run(
      'INSERT INTO watchlist (symbol, name, market) VALUES (?, ?, ?)',
      [symbol, name, market]
    );
    res.json({ id: result.lastID, symbol, name, market });
  } catch (error: any) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: '此股票已在自選股中' });
    }
    console.error('新增自選股失敗:', error);
    res.status(500).json({ error: '新增自選股失敗' });
  }
});

// 修改股票名稱 / 市場別（name、market 可分開或同時更新）
router.patch('/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { name, market } = req.body;
  if (!name && !market) {
    return res.status(400).json({ error: '至少需要提供 name 或 market' });
  }
  if (market && market !== 'TW' && market !== 'US') {
    return res.status(400).json({ error: 'market 只能是 TW 或 US' });
  }
  try {
    // 動態組合要更新的欄位
    const fields: string[] = [];
    const values: any[] = [];
    if (name && name.trim()) { fields.push('name = ?');   values.push(name.trim()); }
    if (market)              { fields.push('market = ?'); values.push(market); }
    values.push(symbol);

    const result = await run(
      `UPDATE watchlist SET ${fields.join(', ')} WHERE symbol = ?`,
      values
    );
    if (result.changes === 0) return res.status(404).json({ error: '找不到此股票' });
    res.json({ message: '更新成功' });
  } catch (error) {
    res.status(500).json({ error: '更新失敗' });
  }
});

// 刪除自選股
router.delete('/:symbol', async (req, res) => {
  const { symbol } = req.params;

  try {
    const result = await run('DELETE FROM watchlist WHERE symbol = ?', [symbol]);
    if (result.changes === 0) {
      return res.status(404).json({ error: '找不到此股票' });
    }
    res.json({ message: '刪除成功' });
  } catch (error) {
    console.error('刪除自選股失敗:', error);
    res.status(500).json({ error: '刪除自選股失敗' });
  }
});

export default router;
