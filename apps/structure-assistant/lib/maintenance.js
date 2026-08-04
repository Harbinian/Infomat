'use strict';

const fs = require('fs');
const path = require('path');

function createMaintenanceStore(filePath) {
  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return {
        enabled: Boolean(parsed.enabled),
        message: String(parsed.message || ''),
        changedAt: parsed.changedAt || null,
        changedBy: parsed.changedBy || null
      };
    } catch (_) {
      return {
        enabled: false,
        message: '',
        changedAt: null,
        changedBy: null
      };
    }
  }

  function write({ enabled, message, changedBy }) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const state = {
      enabled: Boolean(enabled),
      message: String(message || ''),
      changedAt: new Date().toISOString(),
      changedBy: String(changedBy || '')
    };
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    fs.renameSync(temporaryPath, filePath);
    return state;
  }

  return {
    read,
    write
  };
}

module.exports = {
  createMaintenanceStore
};
