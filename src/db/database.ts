import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';

export interface Message {
  id?: number;
  group_id: string;
  user_id: string;
  nickname: string;
  content: string;
  message_id: string;
  timestamp: number;
}

export class ChatDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        nickname TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        message_id TEXT NOT NULL DEFAULT '',
        timestamp INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_messages_group_time ON messages(group_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    `);
    logger.info('DB', 'Database initialized');
  }

  insertMessage(msg: Message): void {
    const stmt = this.db.prepare(`
      INSERT INTO messages (group_id, user_id, nickname, content, message_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(msg.group_id, msg.user_id, msg.nickname, msg.content, msg.message_id, msg.timestamp);
  }

  getMessagesByDate(groupId: string, date: string): Message[] {
    // date format: 'YYYY-MM-DD'
    const startOfDay = new Date(`${date}T00:00:00`).getTime() / 1000;
    const endOfDay = new Date(`${date}T23:59:59`).getTime() / 1000;

    const stmt = this.db.prepare(`
      SELECT * FROM messages
      WHERE group_id = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `);
    return stmt.all(groupId, startOfDay, endOfDay) as Message[];
  }

  getTodayMessages(groupId: string): Message[] {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return this.getMessagesByDate(groupId, date);
  }

  getMessageCount(groupId: string, date: string): number {
    const startOfDay = new Date(`${date}T00:00:00`).getTime() / 1000;
    const endOfDay = new Date(`${date}T23:59:59`).getTime() / 1000;

    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM messages
      WHERE group_id = ? AND timestamp >= ? AND timestamp <= ?
    `);
    const result = stmt.get(groupId, startOfDay, endOfDay) as { count: number };
    return result.count;
  }

  cleanOldMessages(daysToKeep: number = 30): number {
    const cutoff = Math.floor(Date.now() / 1000) - daysToKeep * 86400;
    const stmt = this.db.prepare('DELETE FROM messages WHERE timestamp < ?');
    const result = stmt.run(cutoff);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
