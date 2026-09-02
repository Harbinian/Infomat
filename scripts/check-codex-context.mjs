/**
 * Check Codex project-instruction budgets and routing ownership.
 *
 * This script is read-only. It does not start services, write files, or access a database.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMITS = Object.freeze({
  rootBytes: 6144,
  structuredOutputBytes: 8192,
  chainBytes: 16384,
});

const REGISTRY_START = '<!-- codex-context-registry:start -->';
const REGISTRY_END = '<!-- codex-context-registry:end -->';
const ROUTING_MARKER = '<!-- codex-context-routing:authoritative -->';
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', 'artifacts', 'test-results']);
const CORE_CONTEXT_PATHS = [
  'AGENTS.md',
  'CODEX.md',
  'REPOSITORY_BOUNDARY.md',
  'DIRECTORY_OWNERSHIP.md',
  'MAINLINE_MAP.md',
  'MEMORY.md',
  'docs/architecture/context-management.md',
  'docs/architecture/data-governance-operating-rules.md',
];

const ROOT_DETAIL_PATTERNS = [
  [/^##\s+仪表盘\s*\/\s*统计页面约定/m, 'dashboard-detail-heading'],
  [/^##\s+MDM 角色工作台约定/m, 'mdm-workbench-detail-heading'],
  [/^##\s+独立AI结构化填报试点约定/m, 'structure-pilot-detail-heading'],
  [/^##\s+MDM 流程治理问题卡口径/m, 'issue-card-detail-heading'],
  [/^##\s+静态资产/m, 'static-asset-detail-heading'],
  [/^##\s+数据边界/m, 'data-boundary-detail-heading'],
  [/\brbac-raci-v\d/i, 'rbac-version-detail'],
  [/DeepSeek V4 Pro/i, 'model-detail'],
  [/\/api\/role-workbench/i, 'workbench-route-detail'],
  [/#sankey-data/i, 'dashboard-data-detail'],
  [/echarts\.min\.js/i, 'static-asset-path-detail'],
  [/\bADMIN001\b/i, 'account-detail'],
  [/\bPROCESS_V7_[A-Z_]+\b/, 'v7-runtime-detail'],
];

function issue(code, message, details = {}) {
  return { code, message, ...details };
}

function toPosix(pathValue) {
  return pathValue.split(sep).join('/');
}

function readUtf8(rootDir, relativePath) {
  return readFileSync(resolve(rootDir, relativePath), 'utf8');
}

export function utf8Bytes(text) {
  return Buffer.byteLength(text, 'utf8');
}

export function isValidUtf8Prefix(buffer, byteLimit) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, byteLimit));
    return true;
  } catch {
    return false;
  }
}

export function parseRegistry(markdown) {
  const startCount = markdown.split(REGISTRY_START).length - 1;
  const endCount = markdown.split(REGISTRY_END).length - 1;
  if (startCount !== 1 || endCount !== 1) {
    throw new Error(`registry markers must appear exactly once; start=${startCount}, end=${endCount}`);
  }
  const startIndex = markdown.indexOf(REGISTRY_START) + REGISTRY_START.length;
  const endIndex = markdown.indexOf(REGISTRY_END, startIndex);
  if (endIndex < startIndex) {
    throw new Error('registry end marker must follow the start marker');
  }
  return markdown
    .slice(startIndex, endIndex)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('```') && !line.startsWith('#'))
    .map(line => line.replaceAll('\\', '/'));
}

function discoverFiles(rootDir, predicate) {
  const discovered = [];
  function visit(absoluteDir) {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = resolve(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && predicate(entry.name, absolutePath)) {
        discovered.push(toPosix(relative(rootDir, absolutePath)));
      }
    }
  }
  visit(rootDir);
  return discovered.sort();
}

export function instructionChainFor(rootDir, localAgentPath) {
  const normalizedLeaf = localAgentPath.replaceAll('\\', '/');
  const files = ['AGENTS.md'];
  const directoryParts = dirname(normalizedLeaf).replaceAll('\\', '/').split('/').filter(Boolean);
  for (let index = 0; index < directoryParts.length; index += 1) {
    const candidate = `${directoryParts.slice(0, index + 1).join('/')}/AGENTS.md`;
    if (existsSync(resolve(rootDir, candidate))) files.push(candidate);
  }
  return [...new Set(files)];
}

function normalizedParagraphs(rootDir, paths) {
  const paragraphs = [];
  for (const relativePath of paths) {
    const absolutePath = resolve(rootDir, relativePath);
    if (!existsSync(absolutePath)) continue;
    const source = readFileSync(absolutePath, 'utf8');
    let inFence = false;
    let buffer = [];
    const flush = () => {
      const raw = buffer.join('\n').trim();
      buffer = [];
      if (!raw || raw.startsWith('#') || raw.startsWith('|')) return;
      const normalized = raw.replace(/\s+/g, ' ').trim();
      const bytes = utf8Bytes(normalized);
      if (bytes >= 240 && bytes <= 2400) {
        paragraphs.push({ path: relativePath, normalized, bytes });
      }
    };
    for (const line of source.split(/\r?\n/)) {
      if (line.trim().startsWith('```')) {
        flush();
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      if (!line.trim()) flush();
      else buffer.push(line.trim());
    }
    flush();
  }
  return paragraphs;
}

function trigrams(text) {
  const compact = text.replace(/\s+/g, '');
  const values = new Set();
  for (let index = 0; index <= compact.length - 3; index += 1) {
    values.add(compact.slice(index, index + 3));
  }
  return values;
}

function jaccard(left, right) {
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union ? intersection / union : 0;
}

function duplicateHints(rootDir, paths) {
  const paragraphs = normalizedParagraphs(rootDir, paths);
  const warnings = [];
  const exactGroups = new Map();
  for (const paragraph of paragraphs) {
    if (!exactGroups.has(paragraph.normalized)) exactGroups.set(paragraph.normalized, []);
    exactGroups.get(paragraph.normalized).push(paragraph.path);
  }
  for (const [text, groupPaths] of exactGroups) {
    const uniquePaths = [...new Set(groupPaths)];
    if (uniquePaths.length > 1) {
      warnings.push(issue(
        'EXACT_LONG_DUPLICATE',
        `长段完全重复：${uniquePaths.join(', ')}`,
        { paths: uniquePaths, sample: text.slice(0, 120) },
      ));
    }
  }

  const candidates = paragraphs
    .filter(item => !exactGroups.get(item.normalized) || new Set(exactGroups.get(item.normalized)).size === 1)
    .map(item => ({ ...item, grams: trigrams(item.normalized) }));
  for (let leftIndex = 0; leftIndex < candidates.length && warnings.length < 30; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length && warnings.length < 30; rightIndex += 1) {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];
      if (left.path === right.path) continue;
      const lengthRatio = Math.min(left.normalized.length, right.normalized.length)
        / Math.max(left.normalized.length, right.normalized.length);
      if (lengthRatio < 0.72) continue;
      const score = jaccard(left.grams, right.grams);
      if (score >= 0.82) {
        warnings.push(issue(
          'FUZZY_LONG_SIMILARITY',
          `长段相似度提示 ${score.toFixed(2)}：${left.path} ↔ ${right.path}`,
          { paths: [left.path, right.path], score },
        ));
      }
    }
  }
  return warnings;
}

export function runChecks(rootDir, options = {}) {
  const absoluteRoot = resolve(rootDir);
  const errors = [];
  const warnings = [];
  const ownershipPath = 'DIRECTORY_OWNERSHIP.md';
  let registry = [];

  if (!existsSync(resolve(absoluteRoot, 'AGENTS.md'))) {
    errors.push(issue('ROOT_AGENTS_MISSING', '缺少根 AGENTS.md'));
  }
  if (!existsSync(resolve(absoluteRoot, ownershipPath))) {
    errors.push(issue('OWNERSHIP_MISSING', `缺少 ${ownershipPath}`));
  } else {
    try {
      registry = parseRegistry(readUtf8(absoluteRoot, ownershipPath));
    } catch (error) {
      errors.push(issue('REGISTRY_INVALID', error.message));
    }
  }

  const duplicateRegistryPaths = registry.filter((pathValue, index) => registry.indexOf(pathValue) !== index);
  if (duplicateRegistryPaths.length) {
    errors.push(issue('REGISTRY_DUPLICATE_PATH', `局部入口重复登记：${[...new Set(duplicateRegistryPaths)].join(', ')}`));
  }
  for (const registeredPath of registry) {
    if (registeredPath === 'AGENTS.md' || !registeredPath.endsWith('/AGENTS.md') || registeredPath.startsWith('/')) {
      errors.push(issue('REGISTRY_PATH_INVALID', `局部入口路径格式无效：${registeredPath}`));
    } else if (!existsSync(resolve(absoluteRoot, registeredPath))) {
      errors.push(issue('REGISTERED_AGENT_MISSING', `已登记局部入口不存在：${registeredPath}`, { path: registeredPath }));
    }
  }

  const discoveredAgents = existsSync(absoluteRoot)
    ? discoverFiles(absoluteRoot, fileName => fileName === 'AGENTS.md')
    : [];
  const registeredSet = new Set(registry);
  for (const discoveredPath of discoveredAgents.filter(pathValue => pathValue !== 'AGENTS.md')) {
    if (!registeredSet.has(discoveredPath)) {
      errors.push(issue('UNREGISTERED_AGENT', `局部入口未登记：${discoveredPath}`, { path: discoveredPath }));
    }
  }

  const rootSource = existsSync(resolve(absoluteRoot, 'AGENTS.md'))
    ? readUtf8(absoluteRoot, 'AGENTS.md')
    : '';
  const rootBytes = utf8Bytes(rootSource);
  if (rootBytes > LIMITS.rootBytes) {
    errors.push(issue('ROOT_BUDGET_EXCEEDED', `根 AGENTS.md 为 ${rootBytes} 字节，超过 ${LIMITS.rootBytes} 字节`, { bytes: rootBytes }));
  }
  for (const [pattern, label] of ROOT_DETAIL_PATTERNS) {
    if (pattern.test(rootSource)) {
      errors.push(issue('ROOT_APPLICATION_DETAIL_LEAK', `根 AGENTS.md 出现应用详细规则：${label}`, { label }));
    }
  }

  const structuredOutputPath = 'apps/structured-output-service/AGENTS.md';
  if (existsSync(resolve(absoluteRoot, structuredOutputPath))) {
    const bytes = utf8Bytes(readUtf8(absoluteRoot, structuredOutputPath));
    if (bytes > LIMITS.structuredOutputBytes) {
      errors.push(issue(
        'STRUCTURED_OUTPUT_BUDGET_EXCEEDED',
        `3001 局部 AGENTS.md 为 ${bytes} 字节，超过 ${LIMITS.structuredOutputBytes} 字节`,
        { bytes },
      ));
    }
  }

  const chains = [];
  for (const localPath of registry) {
    if (!existsSync(resolve(absoluteRoot, localPath)) || !existsSync(resolve(absoluteRoot, 'AGENTS.md'))) continue;
    const files = instructionChainFor(absoluteRoot, localPath);
    const parts = files.map(pathValue => ({
      path: pathValue,
      bytes: utf8Bytes(readUtf8(absoluteRoot, pathValue)),
    }));
    const bytes = parts.reduce((total, part) => total + part.bytes, 0);
    const chain = {
      leaf: localPath,
      files: parts,
      bytes,
      remaining: LIMITS.chainBytes - bytes,
    };
    chains.push(chain);
    if (bytes > LIMITS.chainBytes) {
      errors.push(issue(
        'CHAIN_BUDGET_EXCEEDED',
        `${localPath} 项目指令链为 ${bytes} 字节，超过 ${LIMITS.chainBytes} 字节`,
        { path: localPath, bytes, files: parts.map(part => part.path) },
      ));
    }
  }

  const markdownPaths = existsSync(absoluteRoot)
    ? discoverFiles(absoluteRoot, fileName => fileName.toLowerCase().endsWith('.md'))
    : [];
  const markerCounts = { registryStart: 0, registryEnd: 0, routing: 0 };
  for (const markdownPath of markdownPaths) {
    const source = readUtf8(absoluteRoot, markdownPath);
    markerCounts.registryStart += source.split(REGISTRY_START).length - 1;
    markerCounts.registryEnd += source.split(REGISTRY_END).length - 1;
    markerCounts.routing += source.split(ROUTING_MARKER).length - 1;
  }
  if (markerCounts.registryStart !== 1 || markerCounts.registryEnd !== 1) {
    errors.push(issue(
      'REGISTRY_AUTHORITY_NOT_UNIQUE',
      `局部入口注册标记必须全仓唯一；start=${markerCounts.registryStart}, end=${markerCounts.registryEnd}`,
    ));
  }
  if (markerCounts.routing !== 1) {
    errors.push(issue('ROUTING_AUTHORITY_NOT_UNIQUE', `任务路由权威标记必须全仓唯一；count=${markerCounts.routing}`));
  }

  if (options.similarity !== false) {
    warnings.push(...duplicateHints(absoluteRoot, [
      ...CORE_CONTEXT_PATHS,
      ...registry,
    ]));
  }

  return {
    ok: errors.length === 0,
    limits: LIMITS,
    registry,
    discoveredAgents,
    rootBytes,
    chains: chains.sort((left, right) => left.leaf.localeCompare(right.leaf, 'en')),
    errors,
    warnings,
  };
}

function printReport(report) {
  console.log(`[codex-context] root AGENTS.md: ${report.rootBytes}/${report.limits.rootBytes} bytes`);
  for (const chain of report.chains) {
    const parts = chain.files.map(part => `${part.path} (${part.bytes})`).join(' -> ');
    console.log(`[codex-context] ${chain.leaf}: ${parts} = ${chain.bytes} bytes; remaining ${chain.remaining}`);
  }
  for (const warning of report.warnings) {
    console.warn(`[codex-context][warning][${warning.code}] ${warning.message}`);
  }
  for (const error of report.errors) {
    console.error(`[codex-context][error][${error.code}] ${error.message}`);
  }
  if (report.ok) console.log('[codex-context] checks passed');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  const rootFlagIndex = process.argv.indexOf('--root');
  const repoRoot = rootFlagIndex >= 0
    ? resolve(process.argv[rootFlagIndex + 1])
    : resolve(dirname(currentFile), '..');
  const report = runChecks(repoRoot);
  printReport(report);
  if (!report.ok) process.exitCode = 1;
}
