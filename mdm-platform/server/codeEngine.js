const db = require('./db');

const TYPE_CODES = {
  company: 'COM', department: 'DEPT', office: 'OFC', team: 'TEAM'
};

function pad(n, width) {
  return String(n).padStart(width, '0');
}

function takeSeq(entityType, scopeKey) {
  const key = scopeKey || '';
  const row = db.prepare(
    'SELECT id, next_seq FROM code_sequences WHERE entity_type=? AND scope_key=?'
  ).get(entityType, key);
  if (!row) {
    db.prepare(
      'INSERT INTO code_sequences (entity_type, scope_key, next_seq) VALUES (?, ?, 2)'
    ).run(entityType, key);
    return 1;
  }
  db.prepare(
    'UPDATE code_sequences SET next_seq = next_seq + 1 WHERE id=?'
  ).run(row.id);
  return row.next_seq;
}

const codeGenerators = {
  orgUnit(params) {
    const typeCode = TYPE_CODES[params.org_type] || 'UNK';
    const seq = takeSeq('org_unit', '');
    return `OU-${typeCode}-${params.org_mnemonic}-${pad(seq, 6)}`;
  },

  position(params) {
    const org = db.prepare('SELECT org_mnemonic FROM org_unit WHERE org_unit_id=?').get(params.org_unit_id);
    if (!org) throw new Error('归属组织不存在');
    const seq = takeSeq('position', '');
    return `POS-${org.org_mnemonic}-${params.pos_mnemonic}-${pad(seq, 6)}`;
  },

  person() {
    const seq = takeSeq('employee', '');
    return `EMP-${pad(seq, 6)}`;
  },

  productFamily(params) {
    const seq = takeSeq('product_family', '');
    return `PF-${params.model_code}-${params.class_major}-${pad(seq, 6)}`;
  },

  product(params) {
    const fam = db.prepare('SELECT model_code, class_major FROM product_family WHERE product_family_id=?').get(params.product_family_id);
    if (!fam) throw new Error('产品族不存在');
    const mid = params.class_mid || '000';
    const minor = params.class_minor || '000';
    const scopeKey = `${fam.model_code}|${fam.class_major}|${mid}|${minor}`;
    const seq = takeSeq('product', scopeKey);
    return `PRD-${fam.model_code}-${fam.class_major}-${mid}-${minor}-${pad(seq, 5)}`;
  }
};

function generateCode(entityType, params) {
  const gen = codeGenerators[entityType];
  if (!gen) throw new Error(`Unknown entity type: ${entityType}`);
  return gen(params);
}

module.exports = { generateCode, TYPE_CODES };
