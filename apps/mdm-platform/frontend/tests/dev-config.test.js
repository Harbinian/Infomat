import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';

test('actual Vite configuration rejects implicit backend and forbidden overrides before listening', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const previous = process.env.MDM_ISOLATED_BACKEND;
  try {
    delete process.env.MDM_ISOLATED_BACKEND;
    await assert.rejects(resolveConfig({ root, logLevel: 'silent' }, 'serve'), /MDM_ISOLATED_BACKEND/);
    // No server or connection is created by resolveConfig.
    process.env.MDM_ISOLATED_BACKEND = 'http://127.0.0.1:12345';
    for (const server of [{ port: 5173 }, { port: 0 }, { host: '0.0.0.0' }, { cors: true }, { strictPort: false }]) {
      await assert.rejects(resolveConfig({ root, server, logLevel: 'silent' }, 'serve'));
    }
  } finally {
    if (previous === undefined) delete process.env.MDM_ISOLATED_BACKEND;
    else process.env.MDM_ISOLATED_BACKEND = previous;
  }
});
