'use strict';

const fs = require('fs');
const path = require('path');

const ALLOWED_FIELDS = new Set([
  'timestamp',
  'request_id',
  'user_id',
  'operation',
  'model',
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'schema_version',
  'schema_digest',
  'validation_valid',
  'error_code',
  'attempt_count'
]);

function sanitizedRecord(record) {
  const safe = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    if (typeof value === 'string') safe[key] = value.slice(0, 200);
    else if (typeof value === 'number' && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === 'boolean' || value == null) safe[key] = value;
  }
  safe.timestamp = safe.timestamp || new Date().toISOString();
  return safe;
}

function createUsageLog(filePath) {
  function append(record) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(sanitizedRecord(record))}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
  }

  function summarize() {
    if (!fs.existsSync(filePath)) {
      return {
        requestCount: 0,
        totalTokens: 0,
        byUser: {},
        byOperation: {},
        lastRequestAt: null
      };
    }
    const summary = {
      requestCount: 0,
      totalTokens: 0,
      byUser: {},
      byOperation: {},
      lastRequestAt: null
    };
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch (_) {
        continue;
      }
      summary.requestCount += 1;
      summary.totalTokens += Number(record.total_tokens || 0);
      const user = String(record.user_id || 'unknown');
      const operation = String(record.operation || 'unknown');
      summary.byUser[user] = (summary.byUser[user] || 0) + 1;
      summary.byOperation[operation] = (summary.byOperation[operation] || 0) + 1;
      if (record.timestamp && (!summary.lastRequestAt || record.timestamp > summary.lastRequestAt)) {
        summary.lastRequestAt = record.timestamp;
      }
    }
    return summary;
  }

  return {
    append,
    summarize,
    filePath
  };
}

module.exports = {
  ALLOWED_FIELDS,
  sanitizedRecord,
  createUsageLog
};
