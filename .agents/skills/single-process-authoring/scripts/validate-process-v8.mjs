#!/usr/bin/env node
/**
 * 单流程离线校验器（V8 为主，兼容续编中的 V7 草稿）。
 *
 * 不启动 3001，直接调用 3001 与 3000 共用的同一份规则：
 *   - 结构：docs/contracts/process-governance-v{7,8}.schema.json（JSON Schema 2020-12）
 *   - 语义：scripts/process-governance/v7-validator.js（引用、端点、节点类型、字段归属）
 * 两者由 apps/structured-output-service/server.js 按 schema_version 分派。
 *
 * 用法：
 *   node validate-process-v8.mjs <文件.json> [--json] [--expect-digest <sha256>]
 *   node validate-process-v8.mjs --emit-template <输出路径>
 *
 * 退出码：0 通过；1 校验未通过；2 用法或读取错误。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(SKILL_DIR, '..', '..', '..');
const SERVICE_ENTRY = path.join(REPO_ROOT, 'apps', 'structured-output-service', 'server.js');

const USAGE = `单流程离线校验器

  node validate-process-v8.mjs <文件.json> [--json] [--expect-digest <sha256>]
  node validate-process-v8.mjs --emit-template <输出路径>
  node validate-process-v8.mjs --promote <v7草稿.json> <输出路径>

  --json           以 JSON 输出结果，便于后续处理
  --expect-digest  要求结构摘要等于给定值，不一致视为失败（用于切换目标版本）
                   摘要按文件的 schema_version 取：V8 用服务常量，V7 用本地结构文件哈希
  --emit-template  输出当前 3001 的空白 V8 模板，不校验文件
  --promote        把 V7 草稿转成 V8 版本标识并写出新文件；拒绝覆盖已有文件。
                   只改 schema_version，保留 migration.source_schema_version。
                   这不是迁移完成：3001 导入时的规范化与差异核对仍需人工执行。
`;

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function readJsonFile(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    fail(`无法读取文件：${filePath}\n${error.message}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`JSON 解析失败：${filePath}\n${error.message}`);
  }
}

function loadService() {
  if (!fs.existsSync(SERVICE_ENTRY)) {
    fail(`未找到 3001 入口：${SERVICE_ENTRY}\n请在 Infomat 仓库根目录下运行本脚本。`);
  }
  try {
    return require(SERVICE_ENTRY);
  } catch (error) {
    fail(`加载 3001 校验模块失败：${error.message}\n依赖缺失时先在 apps/structured-output-service 安装依赖。`);
  }
}

/**
 * 按文件版本给出 3001 实际使用的结构摘要，口径与 apps/structured-output-service/server.js 一致：
 * V8 用服务导出常量，V7 用 docs/contracts 下结构文件的 SHA-256。
 * 两个摘要不同（V7 e1d5b33b…、V8 3b68c1fd…），不能混用。
 */
function schemaDigestFor(version) {
  if (version === 'process-governance-v8') {
    return { value: service.PROCESS_GOVERNANCE_SCHEMA_DIGEST, version: 'V8' };
  }
  if (version === 'process-governance-v7') {
    const schemaPath = path.join(REPO_ROOT, 'docs', 'contracts', 'process-governance-v7.schema.json');
    if (!fs.existsSync(schemaPath)) return null;
    return { value: crypto.createHash('sha256').update(fs.readFileSync(schemaPath)).digest('hex'), version: 'V7' };
  }
  return null;
}

function parseArgs(argv) {
  const options = { file: null, emitTemplate: null, promote: null, asJson: false, expectDigest: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') options.asJson = true;
    else if (token === '--emit-template') options.emitTemplate = argv[++index] || null;
    else if (token === '--promote') options.promote = [argv[++index] || null, argv[++index] || null];
    else if (token === '--expect-digest') options.expectDigest = argv[++index] || null;
    else if (token === '--help' || token === '-h') options.help = true;
    else if (token.startsWith('-')) fail(`未知参数：${token}\n\n${USAGE}`);
    else if (options.file) fail(`只支持一次校验一个文件，收到第二个：${token}\n\n${USAGE}`);
    else options.file = token;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

if (options.help || (!options.file && !options.emitTemplate && !options.promote)) {
  process.stdout.write(USAGE);
  process.exit(options.help ? 0 : 2);
}

const service = loadService();

if (options.promote) {
  const [sourceArg, targetArg] = options.promote;
  if (!sourceArg || !targetArg) fail(`--promote 需要源文件与输出路径\n\n${USAGE}`);
  const sourcePath = path.resolve(sourceArg);
  const targetPath = path.resolve(targetArg);
  if (sourcePath === targetPath) fail('--promote 的源文件与输出路径不能相同，不覆盖原稿。');
  if (fs.existsSync(targetPath)) fail(`目标已存在，不覆盖：${targetPath}`);

  const source = readJsonFile(sourcePath);
  const sourceVersion = source?.schema_version ?? null;
  if (sourceVersion !== 'process-governance-v7') {
    fail(`--promote 只接受 process-governance-v7 源文件，当前为 ${sourceVersion ?? '（缺少 schema_version）'}。\n其他版本先确认目标规则，不自动升降级。`);
  }

  const promoted = JSON.parse(JSON.stringify(source));
  promoted.schema_version = 'process-governance-v8';
  // migration.source_schema_version 保留真实来源版本，不随版本标识一起改写

  const promotedResult = service.processGovernanceValidationResult(promoted);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(promoted, null, 2)}\n`, 'utf8');

  const lines = [
    `已写出：${targetPath}`,
    `版本标识：${sourceVersion} → process-governance-v8`,
    `migration.source_schema_version：${promoted.migration?.source_schema_version ?? '（空）'}（保留真实来源版本）`,
    `结构校验：${promotedResult.valid ? '通过' : `未通过（${(promotedResult.errors || []).length} 项）`}`
  ];
  (promotedResult.errors || []).forEach((error, index) => {
    lines.push(`  ${index + 1}. ${error.path}　${error.keyword}　${error.message}`);
  });
  lines.push('');
  lines.push('注意：这只是一次版本标识转换，不是迁移完成。3001 导入时会执行规范化并展示差异，');
  lines.push('仍需人工下载核对；业务内容、稳定标识与数组顺序均未改动。');
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(promotedResult.valid ? 0 : 1);
}

if (options.emitTemplate) {
  const target = path.resolve(options.emitTemplate);
  if (fs.existsSync(target)) {
    fail(`目标已存在，不覆盖：${target}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(service.createEmptyProcessGovernanceDocument(), null, 2)}\n`, 'utf8');
  const digest = schemaDigestFor('process-governance-v8');
  process.stdout.write(`已写出空白 process-governance-v8 模板：${target}\n结构摘要（V8）：${digest.value}\n`);
  process.exit(0);
}

const filePath = path.resolve(options.file);
const document = readJsonFile(filePath);
const version = document?.schema_version ?? null;
const digest = schemaDigestFor(version);
const result = service.processGovernanceValidationResult(document);

const digestMismatch = Boolean(options.expectDigest && digest && options.expectDigest !== digest.value);
const digestUnavailable = Boolean(options.expectDigest && !digest);
const valid = Boolean(result.valid) && !digestMismatch && !digestUnavailable;
const errors = (result.errors || []).map(error => ({
  path: error.path,
  keyword: error.keyword,
  message: error.message,
  ...(error.rule_code ? { rule_code: error.rule_code } : {}),
  ...(error.error_id ? { error_id: error.error_id } : {})
}));

if (options.asJson) {
  process.stdout.write(`${JSON.stringify({
    file: filePath,
    schema_version: version,
    schema_digest: digest ? digest.value : null,
    digest_available: Boolean(digest),
    app_commit: service.APP_COMMIT,
    valid,
    error_count: errors.length,
    errors
  }, null, 2)}\n`);
} else {
  const lines = [
    `文件：${filePath}`,
    `结构版本：${version ?? '（缺少 schema_version）'}`,
    digest ? `3001 结构摘要（${digest.version}）：${digest.value}` : '3001 结构摘要：本脚本只核对 V7／V8，其他版本未取摘要',
    `3001 应用提交：${service.APP_COMMIT}`
  ];
  if (digestMismatch) lines.push(`结构摘要不一致：期望 ${options.expectDigest}，实际 ${digest.value}`);
  if (digestUnavailable) lines.push(`无法核对结构摘要：本脚本只支持 V7／V8，当前为 ${version ?? '未知版本'}`);
  if (valid) {
    lines.push('结果：通过');
  } else if (digestMismatch || digestUnavailable) {
    lines.push(`结果：结构校验${result.valid ? '通过' : `未通过（${errors.length} 项）`}，但结构摘要核对不通过`);
  } else {
    lines.push(`结果：未通过（${errors.length} 项）`);
  }
  errors.forEach((error, index) => {
    lines.push('');
    lines.push(`${index + 1}. ${error.path}`);
    lines.push(`   规则：${error.keyword}${error.rule_code ? ` / ${error.rule_code}` : ''}`);
    lines.push(`   说明：${error.message}`);
    if (error.error_id) lines.push(`   标识：${error.error_id}`);
  });
  lines.push('');
  lines.push('本结果只覆盖结构与引用等可机器判定的问题，不覆盖 3001 页面业务提示，也不构成业务核对。');
  process.stdout.write(`${lines.join('\n')}\n`);
}

process.exit(valid ? 0 : 1);
