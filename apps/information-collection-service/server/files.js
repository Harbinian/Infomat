'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const multer = require('multer');
const { error } = require('./service');

const ALLOWED = {
  '.pdf': ['application/pdf'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream'],
  '.txt': ['text/plain', 'application/octet-stream'],
  '.csv': ['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream']
};

function ensureRoots(config) {
  fs.mkdirSync(path.join(config.fileRoot, 'quarantine'), { recursive: true });
  fs.mkdirSync(path.join(config.fileRoot, 'active'), { recursive: true });
}

function uploadMiddleware(config) {
  ensureRoots(config);
  return multer({
    dest: path.join(config.fileRoot, 'quarantine'),
    limits: { fileSize: config.attachment.maxFileBytes, files: 1 }
  }).single('file');
}

function safeOriginalName(value) {
  const base = path.basename(String(value || 'attachment')).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').trim();
  return (base || 'attachment').slice(0, 255);
}

function headerMatches(extension, buffer) {
  if (extension === '.pdf') return buffer.subarray(0, 4).toString('ascii') === '%PDF';
  if (extension === '.png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (extension === '.jpg' || extension === '.jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (extension === '.docx' || extension === '.xlsx') return buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (extension === '.txt' || extension === '.csv') return !buffer.includes(0);
  return false;
}

async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const digest = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(digest.digest('hex')));
  });
}

async function scanFile(filePath, config) {
  if (!config.attachment.scannerCommand) return 'unscanned_dev';
  let args;
  try {
    args = JSON.parse(config.attachment.scannerArgs);
    if (!Array.isArray(args)) throw new Error('args must be an array');
  } catch (_) {
    throw error('病毒扫描参数配置不正确', 503, 'ATTACHMENT_SCANNER_CONFIG_INVALID');
  }
  args = args.map(item => String(item).replaceAll('{file}', filePath));
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(config.attachment.scannerCommand, args, { shell: false, windowsHide: true, stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', code => resolve(code));
  });
  if (exitCode !== 0) throw error('附件未通过安全扫描', 422, 'ATTACHMENT_SCAN_FAILED');
  return 'clean';
}

async function acceptUploadedFile(file, config) {
  if (!config.attachment.enabled) throw error('生产环境尚未配置附件安全扫描，附件上传已停用', 503, 'ATTACHMENT_DISABLED');
  if (!file?.path) throw error('请选择需要上传的附件', 422, 'ATTACHMENT_REQUIRED');
  const originalName = safeOriginalName(file.originalname);
  const extension = path.extname(originalName).toLowerCase();
  if (!ALLOWED[extension] || !ALLOWED[extension].includes(file.mimetype)) throw error('附件类型不在允许范围内', 422, 'ATTACHMENT_TYPE_DENIED');
  const handle = await fs.promises.open(file.path, 'r');
  const header = Buffer.alloc(16);
  await handle.read(header, 0, header.length, 0);
  await handle.close();
  if (!headerMatches(extension, header)) throw error('附件内容与文件类型不一致', 422, 'ATTACHMENT_SIGNATURE_INVALID');
  const scanStatus = await scanFile(file.path, config);
  const storageKey = `${new Date().toISOString().slice(0, 10).replace(/-/g, '/')}/${crypto.randomUUID()}${extension}`;
  const destination = path.resolve(config.fileRoot, 'active', storageKey);
  const activeRoot = path.resolve(config.fileRoot, 'active');
  if (!destination.startsWith(`${activeRoot}${path.sep}`)) throw error('附件存储路径不正确', 500, 'ATTACHMENT_PATH_INVALID');
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const digest = await sha256File(file.path);
  await fs.promises.rename(file.path, destination);
  return {
    storageKey, storagePath: destination, originalName, extension,
    mimeType: file.mimetype, sizeBytes: Number(file.size), sha256: digest, scanStatus,
    maxTaskBytes: config.attachment.maxTaskBytes
  };
}

async function removeTemporaryUpload(file) {
  if (!file?.path) return;
  await fs.promises.rm(file.path, { force: true }).catch(() => {});
}

function storagePath(config, storageKey) {
  const activeRoot = path.resolve(config.fileRoot, 'active');
  const resolved = path.resolve(activeRoot, String(storageKey || ''));
  if (!resolved.startsWith(`${activeRoot}${path.sep}`)) throw error('附件存储路径不正确', 500, 'ATTACHMENT_PATH_INVALID');
  return resolved;
}

module.exports = { acceptUploadedFile, removeTemporaryUpload, storagePath, uploadMiddleware };
