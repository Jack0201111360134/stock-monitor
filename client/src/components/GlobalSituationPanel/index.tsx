import { useState, useEffect, useCallback } from 'react';
import { macroApi, type MacroTopic } from '../../services/api';

// ── 風險等級配色（深色玻璃系） ────────────────────────────────────────────────
const riskConfig = {
  high:   { label: '高風險', cls: 'bg-red-500/20 text-red-300 border-red-500/30',     dot: 'bg-red-400' },
  medium: { label: '中等',   cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30', dot: 'bg-amber-400' },
  low:    { label: '低風險', cls: 'bg-green-500/20 text-green-300 border-green-500/30', dot: 'bg-green-400' },
};

// ── 主題 icon ───────────────────────────────────────────────────────────────
const topicIcon: Record<string, string> = {
  ukraine:    '🇺🇦',
  israel:     '🇮🇱',
  usiran:     '🇮🇷',
  uschina:    '🇨🇳',
  taiwan:     '🌊',
  northkorea: '🇰🇵',
  nato:       '🛡️',
  energy:     '🛢️',
  economy:    '🏦',
};

export default function GlobalSituationPanel() {
  const [topics, setTopics] = useState<MacroTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState('');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const fetchTopics = useCallback(async () => {
    try {
      const res = await macroApi.getTopics();
      setTopics(res.data);
      setUpdatedAt(new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }));
    } catch {
      /* 靜默失敗 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTopics();
    const timer = setInterval(fetchTopics, 3 * 60 * 1000); // 3 分鐘刷新
    return () => clearInterval(timer);
  }, [fetchTopics]);

  // 整體風險等級（以最高優先）
  const overallRisk = topics.some(t => t.riskLevel === 'high')
    ? 'high'
    : topics.some(t => t.riskLevel === 'medium')
    ? 'medium'
    : 'low';

  return (
    <div className="glass-card rounded-lg overflow-hidden">
      {/* 標題列 */}
      <div className="px-3 py-2.5 border-b border-white/10 flex justify-between items-center glass-header">
        <h3 className="text-sm font-bold text-slate-200 tracking-widest uppercase">國際局勢</h3>
        <div className="flex items-center gap-2">
          {!loading && topics.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${riskConfig[overallRisk].cls}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${riskConfig[overallRisk].dot}`} />
              {riskConfig[overallRisk].label}
            </span>
          )}
          {updatedAt && (
            <button
              onClick={fetchTopics}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              title="立即更新"
            >
              {updatedAt} ↻
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-4 text-center text-slate-500 text-xs animate-pulse">載入國際局勢...</div>
      ) : topics.length === 0 ? (
        <div className="p-4 text-center text-slate-600 text-xs">無法取得資訊，請稍後再試</div>
      ) : (
        <div className="dark-divide">
          {topics.map(topic => {
            const risk = riskConfig[topic.riskLevel];
            const isExpanded = expandedKey === topic.key;
            return (
              <div key={topic.key}>
                {/* 主題標題列（可點擊展開） */}
                <button
                  className="w-full px-3 py-2.5 flex items-start gap-2 glass-hover transition-colors text-left"
                  onClick={() => setExpandedKey(isExpanded ? null : topic.key)}
                >
                  <span className="text-base shrink-0 mt-0.5">{topicIcon[topic.key] ?? '🌐'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="text-xs font-semibold text-slate-200">{topic.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${risk.cls}`}>
                          {risk.label}
                        </span>
                        <span className="text-xs text-slate-600">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </div>
                    {/* 局勢小結 */}
                    <p className="text-xs text-slate-400 leading-snug line-clamp-2">{topic.digest}</p>
                  </div>
                </button>

                {/* 展開：新聞列表 */}
                {isExpanded && topic.news.length > 0 && (
                  <div className="border-t border-white/8 dark-divide" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    {topic.news.map((n, i) => (
                      <div key={i} className="px-4 py-2">
                        {n.url ? (
                          <a
                            href={n.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-slate-300 hover:text-slate-100 hover:underline leading-snug block line-clamp-2"
                          >
                            {n.title}
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400 leading-snug">{n.title}</span>
                        )}
                        <div className="text-xs text-slate-600 mt-0.5">
                          {n.source && <span>{n.source} · </span>}
                          {n.publishTime}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 說明 */}
      {!loading && (
        <div className="px-3 py-2 border-t border-white/10 glass-header">
          <p className="text-xs text-slate-600">點擊各主題可展開最新新聞 · 每 3 分鐘自動更新</p>
        </div>
      )}
    </div>
  );
}
