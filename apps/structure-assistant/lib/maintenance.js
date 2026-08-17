'use strict';

const fs = require('fs');
const path = require('path');

function createMaintenanceStore(filePath) {
  function readFile() {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
      return {};
    }
  }

  function persist(state) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    fs.renameSync(temporaryPath, filePath);
  }

  function read() {
    const parsed = readFile();
    return {
      enabled: Boolean(parsed.enabled),
      message: String(parsed.message || ''),
      changedAt: parsed.changedAt || null,
      changedBy: parsed.changedBy || null
    };
  }

  function readEntryMode() {
    const parsed = readFile();
    return {
      mode: parsed.entryMode === 'classic' ? 'classic' : 'dsh',
      reason: String(parsed.entryReason || ''),
      changedAt: parsed.entryChangedAt || null,
      changedBy: parsed.entryChangedBy || null
    };
  }

  function write({ enabled, message, changedBy }) {
    const state = {
      ...readFile(),
      enabled: Boolean(enabled),
      message: String(message || ''),
      changedAt: new Date().toISOString(),
      changedBy: String(changedBy || '')
    };
    persist(state);
    return read();
  }

  function writeEntryMode({ mode, reason, changedBy }) {
    const state = {
      ...readFile(),
      entryMode: mode,
      entryReason: String(reason || ''),
      entryChangedAt: new Date().toISOString(),
      entryChangedBy: String(changedBy || '')
    };
    persist(state);
    return readEntryMode();
  }

  return {
    read,
    write,
    readEntryMode,
    writeEntryMode
  };
}

module.exports = {
  createMaintenanceStore
};
