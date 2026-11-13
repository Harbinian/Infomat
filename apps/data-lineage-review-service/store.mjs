import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class ReviewError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function fieldId(system, table, name) {
  return 'FIELD-' + createHash('sha256').update(JSON.stringify([system, table, name])).digest('hex');
}

export function fieldsAt(location) {
  const match = /^(dbo\.[^.]+)\.(.+)$/.exec(location);
  if (!match) throw new Error('Invalid catalog field location');
  const [, table, names] = match;
  return names.split(/ \+ |＋/).map(name => {
    if (!name.trim()) throw new Error('Empty catalog field name');
    return { table, name };
  });
}

export function lineageTarget(item) {
  return item.target.replace(/（[^）]*）$/, '');
}

export function loadCatalog(file) {
  const bytes = readFileSync(file);
  const catalog = JSON.parse(bytes.toString('utf8'));
  const items = new Map();
  if (catalog.format !== 'field-lineage-review-v1' || !Array.isArray(catalog.items)) {
    throw new Error('Unsupported review catalog');
  }
  for (const item of catalog.items) {
    if (!/^(?:MO-\d{2}|KEY-[0-9a-f]{16})$/.test(item.id) || items.has(item.id) ||
        !['lineage', 'key'].includes(item.group) || typeof item.title !== 'string') {
      throw new Error('Invalid or duplicate review item');
    }
    items.set(item.id, item);
  }
  const fields = new Map();
  for (const item of items.values()) {
    const targets = item.group === 'key'
      ? [item.target]
      : [lineageTarget(item), ...(item.source.match(/dbo\.[^.\s（）]+\.[^\s（）]+/g) ?? [])];
    for (const target of targets) {
      for (const { table, name } of fieldsAt(target)) {
        const id = fieldId(item.system, table, name);
        const likelyGenerated = fields.get(id)?.likelyGenerated ||
          ['系统生成倾向', '系统赋值倾向'].includes(item.kind);
        fields.set(id, { id, system: item.system, table, name, likelyGenerated });
      }
    }
  }
  return { catalog, items, fields, digest: createHash('sha256').update(bytes).digest('hex') };
}

export function loadFieldCatalog(file, review, baseCatalog) {
  const bytes = readFileSync(file);
  const catalog = JSON.parse(bytes.toString('utf8'));
  const digest = createHash('sha256').update(bytes).digest('hex');
  const format = baseCatalog ? 'review-field-metadata-addendum-v1' : 'review-field-metadata-v1';
  if (catalog.format !== format || catalog.reviewCatalogDigest !== review.digest ||
      (baseCatalog && catalog.fieldCatalogDigest !== baseCatalog.digest) ||
      !Array.isArray(catalog.fields) || !catalog.fields.length) {
    throw new Error('Field metadata does not match the review catalog');
  }
  const fields = new Map();
  for (const field of catalog.fields) {
    const { system, table, name, identity, computed, primaryKeyOrdinal } = field;
    const id = fieldId(system, table, name);
    if (!['勤哲', '用友U8', 'KFU8QZ'].includes(system) || typeof table !== 'string' ||
        !table.startsWith('dbo.') || typeof name !== 'string' || !name.trim() || fields.has(id) ||
        baseCatalog?.fields.has(id) ||
        typeof identity !== 'boolean' || typeof computed !== 'boolean' ||
        !Number.isInteger(primaryKeyOrdinal) || primaryKeyOrdinal < 0) {
      throw new Error('Invalid or duplicate field metadata');
    }
    const previous = review.fields.get(id);
    const likelyGenerated = Boolean(previous?.likelyGenerated) ||
      (system === '用友U8' && /ID|Id/.test(name)) ||
      (system === '勤哲' && /主键|Id|ID|^编号$/.test(name));
    let businessLabel = '';
    if (system === '用友U8' && table === 'dbo.Inventory' && name === 'cInvCode') businessLabel = 'U8存货编码，PDM产品图号或物料编码';
    if (system === '用友U8' && table === 'dbo.SO_SODetails' && name === 'cSOCode') businessLabel = '销售订单号';
    fields.set(id, { id, system, table, name, identity, computed, primaryKeyOrdinal,
      likelyGenerated, businessLabel, supplemental: !previous, ...(baseCatalog ? { catalogDigest: digest } : {}) });
  }
  if (!baseCatalog && [...review.fields.keys()].some(id => !fields.has(id))) throw new Error('Missing existing review fields');
  return { catalog, fields, digest };
}

export function loadPositionCatalog(file) {
  const bytes = readFileSync(file);
  const catalog = JSON.parse(bytes.toString('utf8'));
  if (catalog.format !== 'review-position-catalog-v1' || typeof catalog.source?.date !== 'string' ||
      !Array.isArray(catalog.positions) || !catalog.positions.length) {
    throw new Error('Invalid position catalog');
  }
  const options = new Map();
  for (const position of catalog.positions) {
    const { id, department, office, team, name } = position;
    if (!/^POS-[0-9a-f]{24}$/.test(id) || options.has(id) ||
        [department, office, team, name].some(value => typeof value !== 'string') || !department || !name) {
      throw new Error('Invalid position option');
    }
    options.set(id, { id, department, office, team, name, label: [department, office, team, name].filter(Boolean).join(' · ') });
  }
  return { options, source: catalog.source, digest: createHash('sha256').update(bytes).digest('hex') };
}

const statuses = ['draft', 'confirmed', 'follow_up', 'excluded'];
const actions = ['create', 'read', 'update', 'retire'];
const roles = ['R', 'A', 'C', 'I'];

function reviewText(value, limit) {
  if (typeof value !== 'string' || value.length > limit) {
    throw new ReviewError(400, '填写内容格式不正确或超过长度限制。');
  }
  return value.trim();
}

function validateRevision(body, digest) {
  if (body?.catalogDigest !== digest) throw new ReviewError(409, '评审清单版本已变化，请保存本次输入并重新打开清单。');
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0 ||
      typeof body.submissionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.submissionId)) {
    throw new ReviewError(400, '保存版本无效，请核对后再保存。');
  }
}

export function hasLineageNotes(references, notes) {
  return references.every(({ id }) => notes?.[id]?.writeRule && notes?.[id]?.changeRule);
}

export function validateMatrixSubmission(body, digest, positions, getVersion, references = []) {
  validateRevision(body, digest);
  if (body.completed !== undefined && typeof body.completed !== 'boolean') {
    throw new ReviewError(400, '评审完成状态无效。');
  }
  if (body.positionCatalogDigest !== positions.digest) {
    throw new ReviewError(409, '岗位清单已更新。请核对本次填写后重新打开页面。');
  }
  const prior = body.expectedVersion ? getVersion(body.expectedVersion) : null;
  let lineageNotes = prior?.lineageNotes;
  if (body.lineageNotes !== undefined) {
    const notes = body.lineageNotes;
    if (!notes || typeof notes !== 'object' || Array.isArray(notes) ||
        !references.length || Object.keys(notes).length !== references.length) {
      throw new ReviewError(400, '血缘记录与当前目标字段不匹配。');
    }
    lineageNotes = Object.fromEntries(references.map(({ id }) => [id, {
      writeRule: reviewText(notes[id]?.writeRule, 2000),
      changeRule: reviewText(notes[id]?.changeRule, 2000),
    }]));
  }
  if (body.completed && lineageNotes && !hasLineageNotes(references, lineageNotes)) {
    throw new ReviewError(400, '标记完成前，请分别填写每条血缘的写入时点和上游变更后的处理。');
  }
  const matrix = {};
  const positionSelections = {};
  for (const action of actions) {
    matrix[action] = {};
    positionSelections[action] = {};
    for (const role of roles) {
      const chosen = body.selections?.[action]?.[role];
      const priorSelections = prior?.positionSelections?.[action]?.[role];
      const priorText = prior?.matrix?.[action]?.[role];
      if (chosen === null && !Array.isArray(priorSelections) && priorText) {
        matrix[action][role] = priorText;
        positionSelections[action][role] = null;
        continue;
      }
      if (!Array.isArray(chosen) || new Set(chosen).size !== chosen.length) {
        throw new ReviewError(400, '请从岗位清单中选择。');
      }
      if (role === 'A' && chosen.length > 1) {
        throw new ReviewError(400, '每项 CRUD 动作的 A 最多选择一个岗位，未确定时可留空。');
      }
      const selected = chosen.map(id => {
        const position = positions.options.get(id) ?? priorSelections?.find(option => option.id === id);
        if (!position) throw new ReviewError(400, '所选岗位不在清单中。请重新选择。');
        return position;
      });
      matrix[action][role] = selected.map(position => position.label).join('、');
      positionSelections[action][role] = selected;
    }
  }
  return { expectedVersion: body.expectedVersion, submissionId: body.submissionId,
    record: { matrix, positionSelections, positionCatalogDigest: positions.digest,
      ...(body.completed === undefined ? {} : { completed: body.completed }),
      ...(lineageNotes === undefined ? {} : { lineageNotes }) } };
}

export function validateSubmission(body, item, digest) {
  validateRevision(body, digest);
  if (!statuses.includes(body.status)) throw new ReviewError(400, '评审状态无效，请核对后再保存。');
  const record = {
    status: body.status,
    recorder: reviewText(body.recorder, 80),
    decision: reviewText(body.decision, 3000),
    writeRule: reviewText(body.writeRule, 2000),
    changeRule: reviewText(body.changeRule, 2000),
    followUp: reviewText(body.followUp, 2000),
    raci: Object.fromEntries(actions.map(action => [action, reviewText(body.raci?.[action], 600)])),
  };
  if (!record.recorder) throw new ReviewError(400, '请填写记录人。');
  if (record.status !== 'draft' && !record.decision) throw new ReviewError(400, '请填写现场结论。');
  if (record.status === 'follow_up' && !record.followUp) throw new ReviewError(400, '请填写待补材料或下一步。');
  if (record.status === 'confirmed' && item.group === 'lineage' && (!record.writeRule || !record.changeRule)) {
    throw new ReviewError(400, '确认血缘时请分别填写写入或取值时点，以及上游变更后的处理。');
  }
  return { expectedVersion: body.expectedVersion, submissionId: body.submissionId, record };
}

export class Store {
  constructor(dataDir, { catalog, digest }, ...fieldCatalogs) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'review.sqlite'));
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS catalogs (
        digest TEXT PRIMARY KEY, content TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS review_events (
        catalog_digest TEXT NOT NULL REFERENCES catalogs(digest),
        item_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        submission_id TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        record TEXT NOT NULL,
        PRIMARY KEY(catalog_digest, item_id, version),
        UNIQUE(catalog_digest, item_id, submission_id)
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS no_review_update BEFORE UPDATE ON review_events
        BEGIN SELECT RAISE(ABORT, 'Review history is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS no_review_delete BEFORE DELETE ON review_events
        BEGIN SELECT RAISE(ABORT, 'Review history is append-only'); END;
    `);
    this.digest = digest;
    const register = this.db.prepare('INSERT OR IGNORE INTO catalogs (digest, content) VALUES (?,?)');
    register.run(digest, JSON.stringify(catalog));
    for (const fieldCatalog of fieldCatalogs) register.run(fieldCatalog.digest, JSON.stringify(fieldCatalog.catalog));
  }

  decode(row) {
    return { itemId: row.item_id, version: row.version, savedAt: row.saved_at, ...JSON.parse(row.record) };
  }

  history(itemId) {
    return this.db.prepare('SELECT * FROM review_events WHERE catalog_digest=? AND item_id=? ORDER BY version DESC')
      .all(this.digest, itemId).map(row => this.decode(row));
  }

  latest(itemId, digest = this.digest) {
    const row = this.db.prepare('SELECT * FROM review_events WHERE catalog_digest=? AND item_id=? ORDER BY version DESC LIMIT 1')
      .get(digest, itemId);
    return row ? this.decode(row) : null;
  }

  version(itemId, version, digest = this.digest) {
    const row = this.db.prepare('SELECT * FROM review_events WHERE catalog_digest=? AND item_id=? AND version=?')
      .get(digest, itemId, version);
    return row ? this.decode(row) : null;
  }

  current(digest = this.digest) {
    return this.db.prepare(`
      SELECT e.* FROM review_events e
      JOIN (SELECT item_id, MAX(version) AS version FROM review_events WHERE catalog_digest=? GROUP BY item_id) latest
        ON e.item_id=latest.item_id AND e.version=latest.version
      WHERE e.catalog_digest=?
    `).all(digest, digest).map(row => this.decode(row));
  }

  exportRecords(digest = this.digest) {
    return this.db.prepare('SELECT * FROM review_events WHERE catalog_digest=? ORDER BY item_id, version')
      .all(digest).map(row => this.decode(row));
  }

  save(itemId, { expectedVersion, submissionId, record }, digest = this.digest) {
    const serialized = JSON.stringify(record);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare('SELECT * FROM review_events WHERE catalog_digest=? AND item_id=? AND submission_id=?')
        .get(digest, itemId, submissionId);
      if (previous) {
        if (previous.record !== serialized) throw new ReviewError(409, '此提交编号已用于另一份内容。');
        this.db.exec('COMMIT');
        return this.decode(previous);
      }
      const current = this.db.prepare('SELECT MAX(version) AS version FROM review_events WHERE catalog_digest=? AND item_id=?')
        .get(digest, itemId).version ?? 0;
      if (current !== expectedVersion) {
        throw new ReviewError(409, '此条已被更新。请查看已保存记录并核对后再提交。');
      }
      const version = current + 1;
      const savedAt = new Date().toISOString();
      this.db.prepare('INSERT INTO review_events (catalog_digest,item_id,version,submission_id,saved_at,record) VALUES (?,?,?,?,?,?)')
        .run(digest, itemId, version, submissionId, savedAt, serialized);
      this.db.exec('COMMIT');
      return { itemId, version, savedAt, ...record };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}
