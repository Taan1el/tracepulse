import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

export function createDatabase(dbPath?: string): DatabaseSync {
  let finalPath = dbPath;

  if (!finalPath) {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    finalPath = path.join(dataDir, 'tracepulse.db');
  }

  const db = new DatabaseSync(finalPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  return db;
}
