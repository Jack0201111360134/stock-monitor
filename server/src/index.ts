import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { db } from './db';
import watchlistRouter from './routes/watchlist';
import quotesRouter from './routes/quotes';
import alertsRouter from './routes/alerts';
import portfolioRouter from './routes/portfolio';
import portfolioGroupsRouter from './routes/portfolioGroups';
import chipsRouter from './routes/chips';
import macroRouter from './routes/macro';

// 載入環境變數
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// 中介軟體
app.use(cors());
app.use(express.json());

// API 路由
app.use('/api/watchlist', watchlistRouter);
app.use('/api/quotes', quotesRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/portfolio', portfolioRouter);
app.use('/api/portfolio-groups', portfolioGroupsRouter);
app.use('/api/chips', chipsRouter);
app.use('/api/macro-news', macroRouter);

// 健康檢查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`🚀 伺服器運行於 http://localhost:${PORT}`);
});

// 優雅關閉
process.on('SIGINT', () => {
  console.log('\n正在關閉伺服器...');
  db.close((err) => {
    if (err) {
      console.error('資料庫關閉錯誤:', err);
    } else {
      console.log('資料庫已關閉');
    }
    process.exit(0);
  });
});
