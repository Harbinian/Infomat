const MAX_TEXT_CHARACTERS = 3800;
export const MAX_TEXT_BYTES = 3500;

/** Keep both length budgets, Unicode boundaries, and the complete answer text. */
export function chunkText(text, maxBytes = MAX_TEXT_BYTES) {
  if (!Number.isInteger(maxBytes) || maxBytes < 4) {
    throw new RangeError('maxBytes must be an integer of at least 4');
  }

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start;
    let bytes = 0;
    let newlineEnd = start;
    while (end < text.length) {
      const character = String.fromCodePoint(text.codePointAt(end));
      const characterBytes = Buffer.byteLength(character, 'utf8');
      if (bytes + characterBytes > maxBytes || end - start + character.length > MAX_TEXT_CHARACTERS) break;
      bytes += characterBytes;
      end += character.length;
      if (character === '\n') newlineEnd = end;
    }
    // Prefer a line boundary only when it uses at least half the available text.
    if (end < text.length && newlineEnd - start >= (end - start) / 2) end = newlineEnd;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

export class ReplyDeliveryError extends Error {
  constructor(cause, deliveredMessages) {
    super(cause.message, { cause });
    this.name = 'ReplyDeliveryError';
    this.deliveredMessages = deliveredMessages;
  }
}

/** Retry only confirmed length rejections; ambiguous failures must not duplicate replies. */
export async function sendAnswer({ client, channel, replyTs, threadTs, text, logger = console }) {
  const pending = chunkText(text);
  let deliveredMessages = 0;
  for (let index = 0; index < pending.length;) {
    const part = pending[index];
    const method = deliveredMessages === 0 ? 'update' : 'postMessage';
    try {
      if (method === 'update') {
        await client.chat.update({ channel, ts: replyTs, text: part });
      } else {
        await client.chat.postMessage({ channel, thread_ts: threadTs, text: part });
      }
      deliveredMessages += 1;
      index += 1;
    } catch (error) {
      const bytes = Buffer.byteLength(part, 'utf8');
      const code = error.data?.error || error.code || 'unknown';
      const retryMaxBytes = Math.max(4, Math.floor(bytes / 2));
      const smaller = error.data?.error === 'msg_too_long' ? chunkText(part, retryMaxBytes) : [];
      logger.warn(
        '[reply-error] method=%s code=%s characters=%d utf8Bytes=%d deliveredMessages=%d retryMaxBytes=%d',
        method, code, part.length, bytes, deliveredMessages, smaller.length > 1 ? retryMaxBytes : 0,
      );
      if (smaller.length > 1) {
        pending.splice(index, 1, ...smaller);
        continue;
      }
      throw new ReplyDeliveryError(error, deliveredMessages);
    }
  }
  return deliveredMessages;
}
