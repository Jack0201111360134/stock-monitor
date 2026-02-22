// 股票資訊
export interface Stock {
  symbol: string;
  name: string;
  market: 'TW' | 'US';
}

// 自選股
export interface WatchlistItem extends Stock {
  id: number;
  created_at: string;
}

// 股價資料
export interface PriceData {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change?: number;
  changePercent?: number;
}

// 即時報價
export interface QuoteData extends PriceData {
  previousClose: number;
  isMarketClosed?: boolean;  // true = 市場未開盤，price 為昨收參考價
}

// 警報條件類型
export type AlertConditionType =
  | 'price_above'
  | 'price_below'
  | 'volume_spike'
  | 'breakout_high'
  | 'foreign_buy_streak'
  | 'golden_cross'
  | 'death_cross';

// 警報設定
export interface Alert {
  id: number;
  symbol: string;
  condition_type: AlertConditionType;
  threshold: number;
  is_active: boolean;
  created_at: string;
  triggered_at?: string;
}

// 籌碼資料 (三大法人)
export interface InstitutionalTrade {
  symbol: string;
  date: string;
  foreign_buy: number;
  foreign_sell: number;
  foreign_net: number;
  trust_buy: number;
  trust_sell: number;
  trust_net: number;
  dealer_buy: number;
  dealer_sell: number;
  dealer_net: number;
}

// 技術指標
export interface TechnicalIndicators {
  ma5?: number;
  ma10?: number;
  ma20?: number;
  ma60?: number;
  kd?: {
    k: number;
    d: number;
  };
  rsi?: number;
  macd?: {
    macd: number;
    signal: number;
    histogram: number;
  };
}

// 投資組合群組
export interface PortfolioGroup {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

// 持股組合
export interface PortfolioHolding {
  id: number;
  group_id: number;
  symbol: string;
  name: string;
  shares: number;
  cost_price: number;
  target_allocation: number;
  created_at: string;
  updated_at: string;
}

// 持股組合詳細資訊 (含即時市值)
export interface PortfolioDetail extends PortfolioHolding {
  current_price: number; // 現價
  market_value: number; // 市值
  profit_loss: number; // 損益金額
  profit_loss_percent: number; // 損益百分比
  current_allocation: number; // 目前配置比例
  allocation_diff: number; // 與目標配置的差距
}

// 再平衡建議
export interface RebalanceAction {
  symbol: string;
  name: string;
  action: 'buy' | 'sell' | 'hold';
  shares: number; // 需要買入/賣出的張數
  amount: number; // 需要的金額
  reason: string; // 原因說明
}
