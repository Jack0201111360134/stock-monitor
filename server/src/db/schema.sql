-- 自選股清單
CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  market TEXT NOT NULL, -- 'TW' 或 'US'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 警報設定
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  condition_type TEXT NOT NULL, -- 'price_above', 'price_below', 'volume_spike', etc.
  threshold REAL NOT NULL,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  triggered_at DATETIME
);

-- 股票歷史資料快取
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  close REAL,
  volume INTEGER,
  UNIQUE(symbol, date)
);

-- 籌碼資料快取 (三大法人)
CREATE TABLE IF NOT EXISTS institutional_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  foreign_buy REAL, -- 外資買進
  foreign_sell REAL, -- 外資賣出
  foreign_net REAL, -- 外資淨買賣
  trust_buy REAL, -- 投信買進
  trust_sell REAL, -- 投信賣出
  trust_net REAL, -- 投信淨買賣
  dealer_buy REAL, -- 自營商買進
  dealer_sell REAL, -- 自營商賣出
  dealer_net REAL, -- 自營商淨買賣
  UNIQUE(symbol, date)
);

-- 投資組合群組
CREATE TABLE IF NOT EXISTS portfolio_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 持股組合
CREATE TABLE IF NOT EXISTS portfolio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL DEFAULT 1 REFERENCES portfolio_groups(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  shares REAL NOT NULL,
  cost_price REAL NOT NULL,
  target_allocation REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 索引優化
CREATE INDEX IF NOT EXISTS idx_price_history_symbol ON price_history(symbol);
CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(date);
CREATE INDEX IF NOT EXISTS idx_institutional_trades_symbol ON institutional_trades(symbol);
CREATE INDEX IF NOT EXISTS idx_institutional_trades_date ON institutional_trades(date);
CREATE INDEX IF NOT EXISTS idx_alerts_symbol ON alerts(symbol);
