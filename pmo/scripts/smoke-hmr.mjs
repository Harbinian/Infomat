import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _internal } from '../gantt-react/plugins/pmoDeliverablesPlugin.js';

const watcher = new EventEmitter();
watcher.added = [];
watcher.add = filePath => watcher.added.push(filePath);

const sent = [];
const server = {
  watcher,
  ws: {
    send(payload) {
      sent.push(payload);
    },
  },
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const deliverablesDir = path.resolve(scriptDir, '../deliverables');
_internal.registerDeliverablesWatcher(server, { deliverablesDir });

assert.equal(watcher.added[0], deliverablesDir);

watcher.emit('change', path.join(deliverablesDir, 'DLV-300-HMR.md'));
assert.deepEqual(sent.at(-1), {
  type: 'custom',
  event: 'pmo:deliverables-changed',
  data: { id: 'DLV-300', kind: 'change' },
});

watcher.emit('unlink', path.join(deliverablesDir, 'DLV-300-HMR.md'));
assert.equal(sent.at(-1).data.kind, 'unlink');

const countBeforeHistory = sent.length;
watcher.emit('change', path.join(deliverablesDir, '_history', 'DLV-300', 'snapshot.md'));
assert.equal(sent.length, countBeforeHistory);

watcher.emit('change', path.join(deliverablesDir, 'README.md'));
assert.equal(sent.length, countBeforeHistory);

console.log('结果: HMR watcher payload(change/unlink/_history 过滤/非 DLV 过滤) 通过');
