import express from 'express';
import { query, run } from '../db';
import { Alert } from '../types';

const router = express.Router();

// 取得所有警報
router.get('/', async (req, res) => {
  try {
    const alerts = await query<Alert>('SELECT * FROM alerts ORDER BY created_at DESC');
    res.json(alerts);
  } catch (error) {
    console.error('取得警報失敗:', error);
    res.status(500).json({ error: '取得警報失敗' });
  }
});

// 新增警報
router.post('/', async (req, res) => {
  const { symbol, condition_type, threshold } = req.body;

  if (!symbol || !condition_type || threshold === undefined) {
    return res.status(400).json({ error: '缺少必要欄位' });
  }

  try {
    const result = await run(
      'INSERT INTO alerts (symbol, condition_type, threshold) VALUES (?, ?, ?)',
      [symbol, condition_type, threshold]
    );
    res.json({ id: result.lastID, symbol, condition_type, threshold, is_active: true });
  } catch (error) {
    console.error('新增警報失敗:', error);
    res.status(500).json({ error: '新增警報失敗' });
  }
});

// 更新警報狀態
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  if (is_active === undefined) {
    return res.status(400).json({ error: '缺少 is_active 欄位' });
  }

  try {
    const result = await run('UPDATE alerts SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: '找不到此警報' });
    }
    res.json({ message: '更新成功' });
  } catch (error) {
    console.error('更新警報失敗:', error);
    res.status(500).json({ error: '更新警報失敗' });
  }
});

// 刪除警報
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await run('DELETE FROM alerts WHERE id = ?', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: '找不到此警報' });
    }
    res.json({ message: '刪除成功' });
  } catch (error) {
    console.error('刪除警報失敗:', error);
    res.status(500).json({ error: '刪除警報失敗' });
  }
});

export default router;
