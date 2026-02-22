import axios from 'axios';
import type {
  WatchlistItem,
  QuoteData,
  PriceData,
  Alert,
  PortfolioGroup,
  PortfolioHolding,
  PortfolioDetail,
  RebalanceAction,
  StockSummaryData,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 自選股 API
export const watchlistApi = {
  getAll: () => api.get<WatchlistItem[]>('/watchlist'),
  add: (symbol: string, name: string, market: 'TW' | 'US') =>
    api.post('/watchlist', { symbol, name, market }),
  updateName: (symbol: string, name: string) =>
    api.patch(`/watchlist/${symbol}`, { name }),
  updateMarket: (symbol: string, market: 'TW' | 'US') =>
    api.patch(`/watchlist/${symbol}`, { market }),
  update: (symbol: string, name: string, market: 'TW' | 'US') =>
    api.patch(`/watchlist/${symbol}`, { name, market }),
  remove: (symbol: string) => api.delete(`/watchlist/${symbol}`),
};

// 報價 API
export const quotesApi = {
  getQuote: (symbol: string, market: 'TW' | 'US') =>
    api.get<QuoteData>(`/quotes/${symbol}?market=${market}`),
  getHistory: (symbol: string, market: 'TW' | 'US', days: number = 365, interval: string = '1d') =>
    api.get<PriceData[]>(`/quotes/${symbol}/history?market=${market}&days=${days}&interval=${interval}`),
  getSummary: (symbol: string, market: 'TW' | 'US') =>
    api.get<StockSummaryData>(`/quotes/${symbol}/summary?market=${market}`),
  getNews: (symbol: string, market: 'TW' | 'US') =>
    api.get<Array<{ title: string; url: string; publishTime: string; publisher?: string }>>(
      `/quotes/${symbol}/news?market=${market}`
    ),
  getExchangeRate: () =>
    api.get<{ rate: number; updatedAt: string }>('/quotes/exchange-rate'),
};

// 警報 API
export const alertsApi = {
  getAll: () => api.get<Alert[]>('/alerts'),
  add: (symbol: string, condition_type: string, threshold: number) =>
    api.post('/alerts', { symbol, condition_type, threshold }),
  update: (id: number, is_active: boolean) =>
    api.patch(`/alerts/${id}`, { is_active }),
  remove: (id: number) => api.delete(`/alerts/${id}`),
};

// 投資組合群組 API
export const portfolioGroupsApi = {
  getAll: () => api.get<PortfolioGroup[]>('/portfolio-groups'),
  add: (name: string, description?: string) =>
    api.post<PortfolioGroup>('/portfolio-groups', { name, description }),
  update: (id: number, name: string, description?: string) =>
    api.put(`/portfolio-groups/${id}`, { name, description }),
  remove: (id: number) => api.delete(`/portfolio-groups/${id}`),
};

// 國際局勢新聞 API
export interface MacroNewsItem {
  title: string;
  url: string;
  publishTime: string;
  source?: string;
}

export interface MacroTopic {
  key: string;
  name: string;
  news: MacroNewsItem[];
  digest: string;
  riskLevel: 'high' | 'medium' | 'low';
}

export const macroApi = {
  getTopics: () => api.get<MacroTopic[]>('/macro-news'),
};

// 籌碼分析 API（三大法人，僅台股）
export const chipsApi = {
  get: (symbol: string, days = 10) =>
    api.get<Array<{date: string; foreignNet: number; trustNet: number; dealerNet: number}>>(
      `/chips/${symbol}?days=${days}`
    ),
};

// 持股組合 API（所有查詢帶 group_id）
export const portfolioApi = {
  getAll: (groupId: number) =>
    api.get<PortfolioHolding[]>(`/portfolio?group_id=${groupId}`),
  getDetails: (groupId: number) =>
    api.get<{ holdings: PortfolioDetail[]; totalMarketValue: number }>(`/portfolio/details?group_id=${groupId}`),
  getRebalance: (groupId: number, mode: 'all' | 'buy_only' | 'sell_only' = 'all') =>
    api.get<{ actions: RebalanceAction[]; totalMarketValue: number; mode: string }>(
      `/portfolio/rebalance?group_id=${groupId}&mode=${mode}`
    ),
  add: (groupId: number, symbol: string, name: string, shares: number, cost_price: number, target_allocation: number) =>
    api.post('/portfolio', { group_id: groupId, symbol, name, shares, cost_price, target_allocation }),
  update: (id: number, shares: number, cost_price: number, target_allocation: number) =>
    api.put(`/portfolio/${id}`, { shares, cost_price, target_allocation }),
  remove: (id: number) => api.delete(`/portfolio/${id}`),
};
