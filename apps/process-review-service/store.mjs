import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInitialState, ReviewError } from './domain.mjs';
import { validateJointState } from './joint-review.mjs';

export const defaultDataDir = fileURLToPath(new URL('../../artifacts/process-review-service/local/', import.meta.url));

export class Store {
  constructor({ dataDir = process.env.REVIEW_DATA_DIR || defaultDataDir } = {}) {
    this.dataDir = path.resolve(dataDir);
    mkdirSync(this.dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(this.dataDir, 'review.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, source_path TEXT NOT NULL, sha256 TEXT NOT NULL, raw_text TEXT NOT NULL, UNIQUE(source_path, sha256));
      CREATE TABLE IF NOT EXISTS audit (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, actor_id TEXT NOT NULL, time TEXT NOT NULL, operation TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS materials_no_update BEFORE UPDATE ON materials BEGIN SELECT RAISE(ABORT, 'Original material is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS materials_no_delete BEFORE DELETE ON materials BEGIN SELECT RAISE(ABORT, 'Original material is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;`);
    this.db.prepare('INSERT OR IGNORE INTO state (id,value) VALUES (1,?)').run(JSON.stringify(createInitialState()));
    try { this.read(); } catch (error) { this.db.close(); throw error; }
  }

  read() {
    const state = JSON.parse(this.db.prepare('SELECT value FROM state WHERE id=1').get().value);
    // The initial local build omitted the version marker; its shape is explicitly compatible with v1.
    if (state.storageVersion === undefined) state.storageVersion = 1;
    if (state.storageVersion !== 1) throw new ReviewError('本地存储版本不受支持，请保留数据库并使用兼容版本处理', 'UNSUPPORTED_STORAGE_VERSION', 500);
    if (state.mode !== 'local-isolated' || !Number.isSafeInteger(state.revision) || state.revision < 0 || !['themes', 'users', 'departments', 'materials', 'batches', 'opinions', 'issues', 'observations'].every(key => Array.isArray(state[key]))) {
      throw new ReviewError('本地存储结构不完整，已停止写入并保留原数据', 'INVALID_STORAGE', 500);
    }
    validateJointState(state);
    state.audit = this.db.prepare('SELECT * FROM audit ORDER BY sequence').all().map(row => ({ id: row.id, sequence: row.sequence, actorId: row.actor_id, time: row.time, operation: row.operation, detail: JSON.parse(row.detail) }));
    return state;
  }

  material(id) {
    const row = this.db.prepare('SELECT raw_text FROM materials WHERE id=?').get(id);
    if (!row) throw new ReviewError('材料不存在', 'NOT_FOUND', 404);
    return { rawText: row.raw_text, document: JSON.parse(row.raw_text.replace(/^\uFEFF/, '')) };
  }

  transaction(expectedRevision, actorId, operation, mutate) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.read();
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== state.revision) {
        throw new ReviewError('记录已发生变化，请刷新后核对再提交；本次输入未写入', 'REVISION_CONFLICT', 409);
      }
      const result = mutate(state, { putMaterial: record => this.db.prepare('INSERT INTO materials (id,source_path,sha256,raw_text) VALUES (?,?,?,?)').run(record.id, record.sourcePath, record.sha256, record.rawText) }) || {};
      if (result.unchanged) {
        this.db.exec('COMMIT');
        return state;
      }
      state.revision += 1;
      const { audit, ...persisted } = state;
      this.db.prepare('UPDATE state SET value=? WHERE id=1').run(JSON.stringify(persisted));
      this.db.prepare('INSERT INTO audit (id,actor_id,time,operation,detail) VALUES (?,?,?,?,?)').run(randomUUID(), actorId, new Date().toISOString(), operation, JSON.stringify(result.detail || {}));
      this.db.exec('COMMIT');
      return this.read();
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close() { this.db.close(); }
}
