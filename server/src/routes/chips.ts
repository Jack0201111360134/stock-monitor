import express from 'express';
import { getInstitutionalTrades } from '../services/stockData';

const router = express.Router();

/** 過去 N 個工作日（跳過週末，不排除假日） */
function getRecentWeekdays(n: number): string[] {
  const dates: string[] = [];
  const d = new Date();
  d.setDate(d.getDate() - 1); // 從昨天開始（今天盤後才有資料）
  while (dates.length < n) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      const year  = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const date  = String(d.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${date}`);
    }
    d.setDate(d.getDate() - 1);
  }
  return dates.reverse(); // 由舊到新
}

// GET /api/chips/:symbol?days=10
router.get('/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const daysWanted = Math.min(parseInt(req.query.days as string) || 10, 20);

  // 嘗試取得最近工作日資料（多取一些以補假日缺口）
  const candidates = getRecentWeekdays(daysWanted + 5);
  const results: Array<{ date: string; foreignNet: number; trustNet: number; dealerNet: number }> = [];

  for (const date of candidates) {
    if (results.length >= daysWanted) break;
    try {
      const allData = await getInstitutionalTrades(date);
      // T86 的 symbol 欄位是純數字代號（如 "2330"）
      const row = allData.find((r: any) =>
        r.symbol === symbol || r.symbol === symbol.padStart(4, '0')
      );
      if (row) {
        results.push({
          date,
          // TWSE T86 單位：千股，除以 1000 轉為「張」
          foreignNet: Math.round(row.foreign_net / 1000),
          trustNet:   Math.round(row.trust_net   / 1000),
          dealerNet:  Math.round(row.dealer_net  / 1000),
        });
      }
    } catch {
      /* 忽略假日或無資料日期 */
    }
    // 避免過快呼叫被 TWSE 限流（rate limiting）
    await new Promise(r => setTimeout(r, 250));
  }

  res.json(results);
});

export default router;
