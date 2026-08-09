'use strict';

const crypto = require('crypto');
const path = require('path');
const { TextDecoder } = require('util');
const mammoth = require('mammoth');
const { AppError } = require('./errors');

const ALLOWED_EXTENSIONS = new Set(['.docx', '.txt', '.md']);

function decodeTextBuffer(buffer) {
  if (!buffer || !buffer.length) return '';
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf8');
  }
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    return new TextDecoder('gb18030').decode(buffer);
  } catch (_) {
    return utf8;
  }
}

function normalizeUploadedFileName(value) {
  const source = path.basename(String(value || '')).slice(0, 180);
  const decoded = Buffer.from(source, 'latin1').toString('utf8');
  if (!decoded || decoded.includes('\uFFFD')) return source;
  const sourceCjk = (source.match(/[\u4e00-\u9fa5]/g) || []).length;
  const decodedCjk = (decoded.match(/[\u4e00-\u9fa5]/g) || []).length;
  return decodedCjk > sourceCjk ? decoded : source;
}

async function extractReadableSource(file, maxModelInputChars) {
  if (!file?.buffer) throw new AppError(400, 'SOURCE_REQUIRED', '未收到参考材料。');
  const fileName = normalizeUploadedFileName(file.originalname);
  const extension = path.extname(fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new AppError(400, 'SOURCE_TYPE_NOT_ALLOWED', '只允许上传.docx、.txt或.md文字材料。');
  }
  let readableText = '';
  if (extension === '.docx') {
    try {
      readableText = (await mammoth.extractRawText({ buffer: file.buffer })).value;
    } catch (_) {
      throw new AppError(400, 'SOURCE_UNREADABLE', 'Word材料无法直接读取，未调用OCR或图像识别。');
    }
  } else {
    readableText = decodeTextBuffer(file.buffer);
  }
  readableText = String(readableText || '').trim();
  if (!readableText) {
    throw new AppError(400, 'SOURCE_EMPTY', '材料中没有可直接读取的文字。');
  }
  if (readableText.length > maxModelInputChars) {
    throw new AppError(
      413,
      'SOURCE_TEXT_TOO_LARGE',
      `材料可读文字超过${maxModelInputChars}个字符，请拆分后再填报。`
    );
  }
  return {
    material_name: fileName,
    file_sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
    readable_text: readableText
  };
}

function sourceFromPaste(text, maxModelInputChars) {
  const readableText = String(text || '').trim();
  if (!readableText) throw new AppError(400, 'SOURCE_EMPTY', '粘贴内容为空。');
  if (readableText.length > maxModelInputChars) {
    throw new AppError(
      413,
      'SOURCE_TEXT_TOO_LARGE',
      `粘贴文字超过${maxModelInputChars}个字符，请拆分后再填报。`
    );
  }
  return {
    material_name: '粘贴文字',
    file_sha256: crypto.createHash('sha256').update(readableText, 'utf8').digest('hex'),
    readable_text: readableText
  };
}

function normalizeSourceMaterials(value, maxModelInputChars) {
  if (!Array.isArray(value)) throw new AppError(400, 'INVALID_SOURCE_MATERIALS', '参考材料格式不正确。');
  let totalChars = 0;
  const materials = value.slice(0, 10).map(item => {
    const text = String(item?.readable_text || '');
    totalChars += text.length;
    return {
      material_name: String(item?.material_name || '').slice(0, 180),
      file_sha256: /^[a-f0-9]{64}$/i.test(String(item?.file_sha256 || ''))
        ? String(item.file_sha256)
        : null,
      readable_text: text
    };
  });
  if (totalChars > maxModelInputChars) {
    throw new AppError(
      413,
      'MODEL_INPUT_TOO_LARGE',
      `本次会话材料合计超过${maxModelInputChars}个字符，请减少材料后重试。`
    );
  }
  return materials;
}

function normalizeConversation(value) {
  if (!Array.isArray(value)) return [];
  let totalChars = 0;
  const messages = value.slice(-20).map(item => {
    const role = item?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(item?.content || '').slice(0, 6000);
    totalChars += content.length;
    return { role, content };
  });
  if (totalChars > 60000) {
    throw new AppError(413, 'CONVERSATION_TOO_LARGE', '当前对话过长，请先下载草稿，再新建会话继续。');
  }
  return messages;
}

function assertDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'DOCUMENT_REQUIRED', '缺少待处理的结构化JSON。');
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 2 * 1024 * 1024) {
    throw new AppError(413, 'DOCUMENT_TOO_LARGE', '结构化JSON超过2MB，暂不能处理。');
  }
  if (value.schema_version !== 'process-governance-v3') {
    throw new AppError(400, 'DOCUMENT_VERSION_UNSUPPORTED', '只支持process-governance-v3文件；v1或v2文件请先在3001中导入并重新导出。');
  }
  return JSON.parse(serialized);
}

module.exports = {
  ALLOWED_EXTENSIONS,
  decodeTextBuffer,
  normalizeUploadedFileName,
  extractReadableSource,
  sourceFromPaste,
  normalizeSourceMaterials,
  normalizeConversation,
  assertDocument
};
