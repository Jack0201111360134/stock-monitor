import { useState, useEffect } from 'react';
import { alertsApi } from '../../services/api';
import type { Alert } from '../../types';

export default function AlertPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAlert, setNewAlert] = useState({
    symbol: '',
    condition_type: 'price_above' as const,
    threshold: 0,
  });

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    try {
      const response = await alertsApi.getAll();
      setAlerts(response.data);
    } catch (error) {
      console.error('載入警報失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newAlert.symbol || !newAlert.threshold) {
      alert('請填寫所有欄位');
      return;
    }

    try {
      await alertsApi.add(newAlert.symbol, newAlert.condition_type, newAlert.threshold);
      setNewAlert({ symbol: '', condition_type: 'price_above', threshold: 0 });
      setShowAddForm(false);
      loadAlerts();
    } catch {
      alert('新增失敗');
    }
  };

  const handleToggle = async (id: number, isActive: boolean) => {
    try {
      await alertsApi.update(id, !isActive);
      loadAlerts();
    } catch {
      alert('更新失敗');
    }
  };

  const handleRemove = async (id: number) => {
    if (!confirm('確定要刪除此警報？')) return;

    try {
      await alertsApi.remove(id);
      loadAlerts();
    } catch {
      alert('刪除失敗');
    }
  };

  const getConditionLabel = (type: string) => {
    const labels: Record<string, string> = {
      price_above: '股價突破',
      price_below: '股價跌破',
      volume_spike: '成交量爆量',
      breakout_high: '突破近期高點',
      foreign_buy_streak: '外資連買',
      golden_cross: '黃金交叉',
      death_cross: '死亡交叉',
    };
    return labels[type] || type;
  };

  if (loading) {
    return <div className="glass-card rounded-lg p-6 text-slate-500">載入中...</div>;
  }

  return (
    <div className="glass-card rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 glass-header flex justify-between items-center">
        <h2 className="text-sm font-bold text-slate-200">警報設定</h2>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-3 py-1 rounded text-xs font-medium text-white transition-colors"
          style={{ background: 'rgba(59,130,246,0.7)' }}
        >
          + 新增警報
        </button>
      </div>

      {showAddForm && (
        <div className="p-4 border-b border-white/10 glass-form">
          <div className="space-y-2">
            <input
              type="text"
              placeholder="股票代號"
              value={newAlert.symbol}
              onChange={(e) => setNewAlert({ ...newAlert, symbol: e.target.value })}
              className="w-full px-3 py-2 rounded text-sm"
            />
            <select
              value={newAlert.condition_type}
              onChange={(e) => setNewAlert({ ...newAlert, condition_type: e.target.value as any })}
              className="w-full px-3 py-2 rounded text-sm"
            >
              <option value="price_above">股價突破</option>
              <option value="price_below">股價跌破</option>
              <option value="volume_spike">成交量爆量</option>
              <option value="breakout_high">突破近期高點</option>
              <option value="foreign_buy_streak">外資連買</option>
              <option value="golden_cross">黃金交叉</option>
              <option value="death_cross">死亡交叉</option>
            </select>
            <input
              type="number"
              placeholder="目標值"
              value={newAlert.threshold || ''}
              onChange={(e) => setNewAlert({ ...newAlert, threshold: parseFloat(e.target.value) })}
              className="w-full px-3 py-2 rounded text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                className="flex-1 px-3 py-2 rounded text-sm text-white font-medium"
                style={{ background: 'rgba(59,130,246,0.7)' }}
              >
                確認新增
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="flex-1 px-3 py-2 rounded text-sm text-slate-300"
                style={{ background: 'rgba(255,255,255,0.1)' }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="dark-divide">
        {alerts.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            尚無警報設定<br />點擊上方「+ 新增警報」按鈕設定警報
          </div>
        ) : (
          alerts.map((alert) => (
            <div key={alert.id} className="p-4 glass-hover transition-colors">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="font-semibold text-sm text-slate-100">
                    {alert.symbol} - {getConditionLabel(alert.condition_type)}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    目標值: {alert.threshold}
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    建立時間: {new Date(alert.created_at).toLocaleString('zh-TW')}
                  </div>
                  {alert.triggered_at && (
                    <div className="text-xs text-green-400 mt-1">
                      ✓ 已觸發: {new Date(alert.triggered_at).toLocaleString('zh-TW')}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 items-center">
                  <button
                    onClick={() => handleToggle(alert.id, alert.is_active)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      alert.is_active
                        ? 'text-green-300'
                        : 'text-slate-400'
                    }`}
                    style={{ background: alert.is_active ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.08)' }}
                  >
                    {alert.is_active ? '啟用中' : '已停用'}
                  </button>
                  <button
                    onClick={() => handleRemove(alert.id)}
                    className="px-2 py-1 text-red-400 hover:text-red-300 rounded text-xs transition-colors"
                    style={{ background: 'transparent' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    刪除
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
