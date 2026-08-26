const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createDocxParserPool } = require('./docx-parser-pool');

class FakeWorker extends EventEmitter {
  constructor(onPost = null) {
    super();
    this.onPost = onPost;
    this.terminated = false;
  }

  postMessage(message) {
    this.onPost?.(this, message);
  }

  async terminate() {
    this.terminated = true;
  }
}

async function testConcurrencyLimitAndRecovery() {
  const workers = [];
  const pool = createDocxParserPool({
    maxConcurrent: 2,
    timeoutMs: 1000,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }
  });
  const first = pool.parse(Buffer.from('first'));
  const second = pool.parse(Buffer.from('second'));
  await assert.rejects(
    pool.parse(Buffer.from('third')),
    error => error?.publicCode === 'DOCX_PARSER_BUSY' && error?.statusCode === 429
  );
  assert.equal(pool.activeCount(), 2);
  workers[0].emit('message', { ok: true, text: '一', html: '' });
  workers[1].emit('message', { ok: true, text: '二', html: '' });
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(item => item.text), ['一', '二']);
  assert.equal(pool.activeCount(), 0);
  assert.equal(workers.every(worker => worker.terminated), true);
}

async function testTimeoutReleasesSlotAndNextRequestSucceeds() {
  let invocation = 0;
  const workers = [];
  const pool = createDocxParserPool({
    maxConcurrent: 1,
    timeoutMs: 20,
    createWorker: () => {
      invocation += 1;
      const worker = invocation === 1
        ? new FakeWorker()
        : new FakeWorker(instance => setImmediate(() => instance.emit('message', { ok: true, text: '恢复', html: '' })));
      workers.push(worker);
      return worker;
    }
  });
  await assert.rejects(
    pool.parse(Buffer.from('timeout')),
    error => error?.publicCode === 'DOCX_PARSE_TIMEOUT' && error?.statusCode === 422
  );
  assert.equal(pool.activeCount(), 0);
  assert.equal(workers[0].terminated, true);
  assert.deepEqual(await pool.parse(Buffer.from('next')), { text: '恢复', tables: [] });
  assert.equal(pool.activeCount(), 0);
}

Promise.resolve()
  .then(testConcurrencyLimitAndRecovery)
  .then(testTimeoutReleasesSlotAndNextRequestSucceeds)
  .then(() => console.log('structured-output-service DOCX parser pool tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
