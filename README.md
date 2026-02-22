# 股票監控系統

AI 智慧分析股票監控系統，專為台股短線交易設計，適合投資新手使用。

## 功能特色

### 一鍵懶人包
- 點擊股票即可查看 AI 自動產生的分析報告
- 白話解讀市場狀況，無需專業背景即可理解

### 技術線型分析
- K 線圖表（使用 TradingView Lightweight Charts）
- 均線系統（5/20/60 日線）
- KD 指標、RSI 指標
- 成交量分析

### 籌碼面分析
- 三大法人買賣超
- 外資/投信/自營商動向圖解
- AI 自動解讀籌碼訊號

### 智慧規則引擎
- 內建數百條分析規則
- 自動辨識型態（箱型整理、底部墊高等）
- 不需付費 AI API

### 智慧警報
- 價格突破/跌破警報
- 近期高低點警報
- 警報觸發時提供 AI 解讀

## 技術架構

### 前端
- React 18 + TypeScript
- Tailwind CSS
- Lightweight Charts
- Zustand 狀態管理

### 後端
- Node.js + Express
- SQLite 資料庫
- node-cron 排程任務

### 資料來源
- 證交所 OpenAPI（台股）
- Yahoo Finance（美股）

## 快速開始

### 安裝依賴
```bash
cd stock-monitor
npm install
cd client && npm install
cd ../server && npm install
```

### 啟動開發環境
```bash
# 在根目錄執行
npm run dev
```

這會同時啟動：
- 後端：http://localhost:3001
- 前端：http://localhost:5173

### 分別啟動
```bash
# 啟動後端
cd server && npm run dev

# 啟動前端（另開終端）
cd client && npm run dev
```

## 專案結構

```
stock-monitor/
├── client/                 # React 前端
│   ├── src/
│   │   ├── components/     # UI 組件
│   │   ├── stores/         # Zustand 狀態
│   │   ├── services/       # API 服務
│   │   └── types/          # TypeScript 類型
│   └── package.json
├── server/                 # Node.js 後端
│   ├── src/
│   │   ├── routes/         # API 路由
│   │   ├── services/       # 業務邏輯
│   │   ├── jobs/           # 排程任務
│   │   └── db/             # 資料庫
│   └── package.json
└── package.json
```

## API 端點

### 股票相關
- `GET /api/stocks/quote/:symbol` - 取得即時報價
- `GET /api/stocks/history/:symbol` - 取得歷史價格
- `GET /api/stocks/search?q=` - 搜尋股票

### 自選股
- `GET /api/watchlist` - 取得自選股清單
- `POST /api/watchlist` - 新增自選股
- `DELETE /api/watchlist/:symbol` - 移除自選股

### 分析
- `GET /api/analysis/:symbol` - 取得完整 AI 分析
- `GET /api/analysis/:symbol/indicators` - 取得技術指標

### 警報
- `GET /api/alerts` - 取得所有警報
- `POST /api/alerts` - 建立警報
- `PATCH /api/alerts/:id/toggle` - 切換警報狀態
- `DELETE /api/alerts/:id` - 刪除警報

## 注意事項

- 台股即時報價有約 15-20 分鐘延遲（證交所規定）
- 籌碼資料為每日盤後更新
- 所有功能免費使用，無需申請 API 金鑰

## 授權

ISC License
