import express from 'express';
import axios from 'axios';

const router = express.Router();

// Yahoo Finance 和 Google News 都用同一組 headers
const yahooHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};
const rssHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
};

// ── 9 大主題：英文關鍵字讓 Yahoo Finance 找到最新國際新聞 ───────
const TOPICS = [
  {
    key: 'ukraine',
    name: '俄烏局勢',
    // 英文查詢為主（Yahoo Finance 英文新聞最即時），備用中文 RSS
    yahooQuery: 'Ukraine Russia war ceasefire peace talks 2026',
    rssQuery: '烏克蘭 俄羅斯 停火',
  },
  {
    key: 'israel',
    name: '以巴衝突',
    yahooQuery: 'Israel Gaza Hamas war ceasefire 2026',
    rssQuery: '以色列 加薩 哈馬斯',
  },
  {
    key: 'usiran',
    name: '美伊局勢',
    yahooQuery: 'US Iran war strike attack nuclear sanctions 2026',
    rssQuery: '伊朗 美國 戰爭 核武',
  },
  {
    key: 'uschina',
    name: '美中貿易',
    yahooQuery: 'US China trade war tariffs chip ban sanctions 2026',
    rssQuery: '美中 關稅 貿易戰',
  },
  {
    key: 'taiwan',
    name: '台海／南海',
    yahooQuery: 'Taiwan Strait South China Sea PLA military drill 2026',
    rssQuery: '台灣 台海 南海 解放軍',
  },
  {
    key: 'northkorea',
    name: '朝鮮半島',
    yahooQuery: 'North Korea missile nuclear test Kim Jong Un 2026',
    rssQuery: '北韓 飛彈 金正恩',
  },
  {
    key: 'nato',
    name: '北約／歐洲',
    yahooQuery: 'NATO Europe defense spending Trump 2026',
    rssQuery: 'NATO 北約 歐洲',
  },
  {
    key: 'energy',
    name: '能源局勢',
    yahooQuery: 'OPEC oil price cut energy crisis natural gas 2026',
    rssQuery: 'OPEC 原油 油價',
  },
  {
    key: 'economy',
    name: '全球央行',
    yahooQuery: 'Federal Reserve Fed interest rate cut inflation 2026',
    rssQuery: '聯準會 利率 降息 通膨',
  },
] as const;

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

// ── Yahoo Finance v1 新聞搜尋（最即時，英文國際頭條）────────────
async function fetchYahooNews(query: string, limit = 5): Promise<MacroNewsItem[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=${limit}&enableNavLinks=false&enableEnhancedTrivialQuery=true`;
  const res = await axios.get(url, { headers: yahooHeaders, timeout: 8000 });
  const items: any[] = res.data?.news ?? [];
  return items
    .map((item: any) => ({
      title: (item.title ?? '').trim(),
      url: item.link ?? '',
      publishTime: item.providerPublishTime
        ? new Date(item.providerPublishTime * 1000).toLocaleString('zh-TW', {
            timeZone: 'Asia/Taipei',
            month: 'numeric', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })
        : '',
      source: item.publisher ?? undefined,
    }))
    .filter(n => n.title);
}

// ── Google News RSS 備援（台灣中文版）────────────────────────────
function parseRss(xml: string, limit = 4): MacroNewsItem[] {
  const items: MacroNewsItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null && items.length < limit) {
    const block = m[1];
    const title   = (/<title>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const link    = (/<link>([\s\S]*?)<\/link>/.exec(block)?.[1] ?? '').trim();
    const pubDate = (/<pubDate>([\s\S]*?)<\/pubDate>/.exec(block)?.[1] ?? '').trim();
    const source  = (/<source[^>]*>([\s\S]*?)<\/source>/.exec(block)?.[1] ?? '').trim();
    if (title && !title.startsWith('<')) {
      items.push({
        title,
        url: link,
        publishTime: pubDate
          ? new Date(pubDate).toLocaleString('zh-TW', {
              timeZone: 'Asia/Taipei',
              month: 'numeric', day: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })
          : '',
        source: source || undefined,
      });
    }
  }
  return items;
}

async function fetchRssNews(query: string, limit = 3): Promise<MacroNewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
  const res = await axios.get<string>(url, { headers: rssHeaders, timeout: 8000, responseType: 'text' });
  return parseRss(res.data, limit);
}

// ── 去重（同標題或同連結只保留一筆）─────────────────────────────
function deduplicate(items: MacroNewsItem[]): MacroNewsItem[] {
  const seen = new Set<string>();
  return items.filter(n => {
    const key = n.url || n.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── 局勢小結生成（中英文關鍵字皆偵測）──────────────────────────
function generateTopicDigest(
  key: string,
  news: MacroNewsItem[],
): { digest: string; riskLevel: 'high' | 'medium' | 'low' } {
  if (news.length === 0) return { digest: '目前暫無最新資訊。', riskLevel: 'medium' };

  const text = news.map(n => n.title).join(' ');

  // 升/降溫通用判斷（中英混合）
  const escalate = /攻擊|轟炸|導彈|砲擊|升級|開戰|爆炸|制裁|驅逐|封鎖|衝突加劇|緊張|90%|war|strike|attack|escalat|conflict|clash|airstrike|bombardment|invasion/i.test(text);
  const deescalate = /停火|談判|和平|協議|撤軍|緩和|外交|ceasefire|negotiate|peace|deal|truce|withdraw|summit|diplomatic/i.test(text);

  let riskLevel: 'high' | 'medium' | 'low' =
    escalate && !deescalate ? 'high' :
    deescalate && !escalate ? 'low' : 'medium';

  let digest = '';

  switch (key) {
    case 'ukraine': {
      if (escalate)        digest = '俄烏戰線近期衝突加劇，雙方在關鍵區域持續交火';
      else if (deescalate) digest = '俄烏局勢出現緩和跡象，停火或和平談判正受到外交關注';
      else                 digest = '俄烏局勢持續膠著，前線變化有限，外交進展緩慢';
      if (/ceasefire|停火/i.test(text))         digest += '，停火條款成為各方角力焦點';
      if (/Trump|川普|美國介入/i.test(text))    digest += '，美國調停角色備受矚目';
      break;
    }
    case 'israel': {
      if (escalate)        digest = '以巴衝突近期明顯升溫，加薩地帶軍事行動持續';
      else if (deescalate) digest = '以巴停火談判傳出進展，人質問題成協議核心議題';
      else                 digest = '以巴衝突持續拉鋸，人道危機與軍事行動並行';
      if (/Houthi|胡塞|紅海|Red Sea/i.test(text))           digest += '，胡塞組織對紅海航運威脅持續';
      if (/Hezbollah|真主黨|黎巴嫩|Lebanon/i.test(text))    digest += '，黎巴嫩真主黨動向牽動區域穩定';
      break;
    }
    case 'usiran': {
      const war90 = /90%|imminent|war probability|高機率|開戰|strike|attack Iran/i.test(text);
      if (war90)           { digest = '美伊開戰風險急劇攀升，市場情報顯示軍事衝突機率大幅提高'; riskLevel = 'high'; }
      else if (escalate)   { digest = '美伊緊張局勢升溫，波斯灣地區安全引發高度警覺'; riskLevel = 'high'; }
      else if (deescalate) { digest = '美伊局勢出現外交緩和訊號，核談判傳出進展'; riskLevel = 'low'; }
      else                  digest = '美伊關係維持高張力，核武議題與制裁政策持續拉鋸';
      if (/nuclear|核武|核濃縮|uranium/i.test(text)) digest += '，核濃縮進度為最大癥結';
      if (/oil|石油|原油|Strait of Hormuz|荷姆茲/i.test(text)) digest += '，荷姆茲海峽石油運輸安全成焦點';
      break;
    }
    case 'uschina': {
      const tariff    = /tariff|關稅|trade war|貿易戰|ban|制裁|export control|出口管制/i.test(text);
      const tradeGood = /trade deal|協議|降關稅|豁免|exemption|talks resumed/i.test(text);
      if (tariff && !tradeGood)  { digest = '美中貿易摩擦持續升溫，科技管制與關稅壁壘不斷擴大'; riskLevel = 'high'; }
      else if (tradeGood)        { digest = '美中貿易出現正面訊號，雙方恢復對話釋出緩和意願'; riskLevel = 'low'; }
      else                        digest = '美中競爭格局延續，科技脫鉤與市場分割趨勢持續';
      if (/chip|半導體|晶片|semiconductor/i.test(text)) digest += '，半導體供應鏈管制為核心博弈';
      break;
    }
    case 'taiwan': {
      if (escalate)        { digest = '台海緊張局勢升溫，解放軍軍事動作引發區域高度關注'; riskLevel = 'high'; }
      else if (deescalate) { digest = '台海緊張暫趨緩和，兩岸或區域外交互動略有改善'; riskLevel = 'low'; }
      else                  digest = '台海南海維持敏感態勢，各方軍事與外交動向交錯';
      if (/drill|exercise|演習|軍演/i.test(text)) digest += '，解放軍演習頻率為觀察重點';
      if (/carrier|航艦|USS/i.test(text))        digest += '，美軍航母編隊存在持續強化嚇阻';
      break;
    }
    case 'northkorea': {
      if (/missile|launch|試射|飛彈|nuclear test|核試/i.test(text)) {
        digest = '北韓近期進行飛彈試射，朝鮮半島緊張態勢升高';
        riskLevel = 'high';
      } else if (deescalate) {
        digest = '朝鮮半島局勢出現緩和，外交斡旋傳有進展';
        riskLevel = 'low';
      } else {
        digest = '北韓動向受到持續監視，金正恩政策走向仍是關鍵變數';
      }
      if (/Russia|俄羅斯|weapon|武器/i.test(text)) digest += '，北韓對俄武器援助問題引發關切';
      break;
    }
    case 'nato': {
      if (/spending|defense|擴軍|增兵|增加軍費/i.test(text)) {
        digest = '北約成員國持續強化國防預算，歐洲防務整合加速';
        riskLevel = 'medium';
      } else if (/fracture|crack|分歧|withdraw|退出/i.test(text)) {
        digest = '北約內部立場出現分歧，盟友協調面臨壓力';
        riskLevel = 'medium';
      } else {
        digest = '北約持續深化集體防衛，東翼部署為主要動向';
      }
      if (/Trump|川普/i.test(text)) digest += '，川普政府對北約承諾態度受盟友高度關注';
      break;
    }
    case 'energy': {
      const oilCut  = /cut|減產|OPEC\+|curtail/i.test(text);
      const oilRise = /increase|增產|supply surge|解除制裁/i.test(text);
      if (oilCut)        { digest = 'OPEC+ 維持或深化減產，油價獲得支撐'; riskLevel = 'medium'; }
      else if (oilRise)  { digest = '全球原油供給有望增加，油價面臨下行壓力'; riskLevel = 'low'; }
      else                digest = '能源市場受地緣政治與需求前景雙重影響，走勢分歧';
      if (/natural gas|LNG|天然氣/i.test(text)) digest += '，歐洲天然氣供應安全為持續觀察變數';
      break;
    }
    case 'economy': {
      const hawkish = /rate hike|hawkish|higher for longer|升息|鷹派|通膨頑固/i.test(text);
      const dovish  = /rate cut|dovish|pivot|降息|鴿派|暫停升息/i.test(text);
      if (hawkish)       { digest = 'Fed 傾向維持高利率立場，市場降息預期再度降溫'; riskLevel = 'medium'; }
      else if (dovish)   { digest = 'Fed 降息預期走強，流動性改善有利風險資產'; riskLevel = 'low'; }
      else                digest = '全球主要央行政策走向分歧，市場對利率路徑看法不一';
      if (/recession|衰退|hard landing|硬著陸/i.test(text)) { digest += '，衰退疑慮為最大尾部風險'; riskLevel = 'medium'; }
      break;
    }
    default:
      digest = news[0].title.slice(0, 45) + '…';
  }

  return { digest: digest + (digest.endsWith('。') ? '' : '。'), riskLevel };
}

// ── 快取（3 分鐘，地緣政治新聞要夠即時）──────────────────────
let cache: { data: MacroTopic[]; expiry: number } | null = null;

router.get('/', async (_req, res) => {
  if (cache && cache.expiry > Date.now()) {
    return res.json(cache.data);
  }

  const results = await Promise.allSettled(
    TOPICS.map(async (topic) => {
      // ① 優先用 Yahoo Finance（英文、最即時）
      let news: MacroNewsItem[] = [];
      try {
        news = await fetchYahooNews(topic.yahooQuery, 4);
      } catch { /* 靜默 */ }

      // ② 不足 2 筆時補充 Google News RSS（中文，台灣視角）
      if (news.length < 2) {
        try {
          const rssNews = await fetchRssNews(topic.rssQuery, 4);
          news = deduplicate([...news, ...rssNews]);
        } catch { /* 靜默 */ }
      }

      news = deduplicate(news).slice(0, 5);
      const { digest, riskLevel } = generateTopicDigest(topic.key, news);
      return { key: topic.key, name: topic.name, news, digest, riskLevel } as MacroTopic;
    })
  );

  const topics: MacroTopic[] = results
    .filter(r => r.status === 'fulfilled')
    .map(r => (r as PromiseFulfilledResult<MacroTopic>).value);

  if (topics.length > 0) {
    cache = { data: topics, expiry: Date.now() + 3 * 60 * 1000 }; // 3 分鐘快取
  }
  res.json(topics);
});

export default router;
