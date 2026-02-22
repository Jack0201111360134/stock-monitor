export interface Stock {
  symbol: string;
  name: string;
  market: 'TW' | 'US';
}

export interface WatchlistItem extends Stock {
  id: number;
  created_at: string;
}

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

export interface QuoteData extends PriceData {
  previousClose: number;
  isMarketClosed?: boolean;  // true = 市場未開盤或假日，price 為昨收參考價
}

export type AlertConditionType =
  | 'price_above'
  | 'price_below'
  | 'volume_spike'
  | 'breakout_high'
  | 'foreign_buy_streak'
  | 'golden_cross'
  | 'death_cross';

export interface Alert {
  id: number;
  symbol: string;
  condition_type: AlertConditionType;
  threshold: number;
  is_active: boolean;
  created_at: string;
  triggered_at?: string;
}

export interface PortfolioGroup {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

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

export interface PortfolioDetail extends PortfolioHolding {
  current_price: number;
  market_value: number;
  profit_loss: number;
  profit_loss_percent: number;
  current_allocation: number;
  allocation_diff: number;
}

export interface MonthlyRevenue {
  yearMonth: string;
  revenue: number;
  yoyGrowth?: number;
}

export interface QuarterlyFinancials {
  period: string;
  eps?: number;
  revenue?: number;
  grossMargin?: number;
  operatingMargin?: number;
}

export interface StockSummaryData {
  symbol: string;
  market: 'TW' | 'US';
  quote: QuoteData;
  technicals: {
    ma5: number;
    ma20: number;
    ma60: number;
    rsi14: number;
    volumeRatio: number;
    week52High: number;
    week52Low: number;
    week52Position: number;
    trend: 'strong_up' | 'up' | 'neutral' | 'down' | 'strong_down';
    signals: string[];
    analysis: string;
  };
  fundamentals: {
    pe?: number;
    pb?: number;
    dividendYield?: number;
    monthlyRevenue: MonthlyRevenue[];
    quarterlyData: QuarterlyFinancials[];
    latestGrossMargin?: number;
    latestOperatingMargin?: number;
    analysis: string;
  };
  news: Array<{
    title: string;
    url: string;
    publishTime: string;
    publisher?: string;
  }>;
  summaryText: string;
  newsDigest?: string;
}

export interface RebalanceAction {
  symbol: string;
  name: string;
  action: 'buy' | 'sell' | 'hold';
  shares: number;
  amount: number;
  reason: string;
}
