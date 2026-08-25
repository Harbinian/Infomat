'use strict';

const { parentPort } = require('node:worker_threads');
const mammoth = require('mammoth');

parentPort.once('message', async message => {
  try {
    const buffer = Buffer.from(message.buffer);
    const [rawTextResult, htmlResult] = await Promise.all([
      mammoth.extractRawText({ buffer }),
      mammoth.convertToHtml({ buffer })
    ]);
    parentPort.postMessage({
      ok: true,
      text: rawTextResult.value,
      html: htmlResult.value
    });
  } catch (_error) {
    parentPort.postMessage({ ok: false });
  }
});
