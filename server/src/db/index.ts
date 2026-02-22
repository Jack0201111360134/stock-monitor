import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.join(__dirname, '../../data/stock-monitor.db');
const schemaPath = path.join(__dirname, 'schema.sql');

// 確保資料目錄存在
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 建立資料庫連接
export const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('資料庫連接失敗:', err.message);
  } else {
    console.log('資料庫連接成功');
    initDatabase();
  }
});

// 初始化資料庫結構
function initDatabase() {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema, (err) => {
    if (err) {
      console.error('資料庫初始化失敗:', err.message);
    } else {
      console.log('資料庫初始化完成');
      runMigrations();
    }
  });
}

// 資料庫遷移（處理 schema 變更）
function runMigrations() {
  db.serialize(() => {
    // 遷移1：建立預設組合並把舊資料移過去
    db.run(`INSERT OR IGNORE INTO portfolio_groups (id, name, description) VALUES (1, '我的第一個組合', '預設投資組合')`, (err) => {
      if (err) console.error('遷移1a 失敗:', err.message);
    });

    // 遷移2：portfolio 表加入 group_id 欄位（若尚未存在）
    db.run(`ALTER TABLE portfolio ADD COLUMN group_id INTEGER NOT NULL DEFAULT 1`, (err) => {
      // 欄位已存在時 SQLite 會報錯，忽略即可
      if (err && !err.message.includes('duplicate column')) {
        // 不是"欄位已存在"的錯誤才印出
      }
    });
  });
}

// Promise 包裝查詢
export function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

// Promise 包裝單筆查詢
export function get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T);
    });
  });
}

// Promise 包裝執行
export function run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}
