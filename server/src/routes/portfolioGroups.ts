import express from 'express';
import { query, run, get } from '../db';
import { PortfolioGroup } from '../types';

const router = express.Router();

// 取得所有組合
router.get('/', async (req, res) => {
  try {
    const groups = await query<PortfolioGroup>('SELECT * FROM portfolio_groups ORDER BY created_at ASC');
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: '取得組合列表失敗' });
  }
});

// 新增組合
router.post('/', async (req, res) => {
  const { name, description = '' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: '組合名稱不能為空' });

  try {
    const result = await run(
      'INSERT INTO portfolio_groups (name, description) VALUES (?, ?)',
      [name.trim(), description]
    );
    const group = await get<PortfolioGroup>('SELECT * FROM portfolio_groups WHERE id = ?', [result.lastID]);
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: '新增組合失敗' });
  }
});

// 修改組合名稱
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: '組合名稱不能為空' });

  try {
    await run(
      'UPDATE portfolio_groups SET name = ?, description = ? WHERE id = ?',
      [name.trim(), description ?? '', id]
    );
    res.json({ message: '更新成功' });
  } catch (error) {
    res.status(500).json({ error: '更新組合失敗' });
  }
});

// 刪除組合（同時刪除組合內所有持股）
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  // 不允許刪除最後一個組合
  const all = await query<PortfolioGroup>('SELECT id FROM portfolio_groups');
  if (all.length <= 1) {
    return res.status(400).json({ error: '至少要保留一個投資組合' });
  }

  try {
    await run('DELETE FROM portfolio WHERE group_id = ?', [id]);
    await run('DELETE FROM portfolio_groups WHERE id = ?', [id]);
    res.json({ message: '刪除成功' });
  } catch (error) {
    res.status(500).json({ error: '刪除組合失敗' });
  }
});

export default router;
