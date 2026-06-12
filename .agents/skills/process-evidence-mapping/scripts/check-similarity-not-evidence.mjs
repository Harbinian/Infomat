#!/usr/bin/env node
/**
 * Check whether vector/similarity wording appears to be used as final evidence.
 *
 * This is a conservative review aid. Findings require human review.
 */
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'artifacts', 'test-results', 'build']);
const VECTOR_RE = /(向量|embedding|similarity_score|retrieval_score|相似度|nearest-neighbor|近邻)/i;
const RISK_RE = /(输入来源部门|输出目标部门|审批类型|业务流程（L3）|业务行为（A1）|同一对象|部门（D1）|桑基|Sankey|正式链路|最终)/i;
const SAFE_RE = /(候选|待确认|未见|不得|不能|不是证据|review|confirmed|原文已核验|表格已核验|表单已核验|流程图已核验|evidence_status|do not use|never final|not evidence|only when the source proves|may be filled only when)/i;

function parseArgs(argv) {
  const args = {
    root: 'docs/norms',
    out: 'build/evidence/similarity_audit_report.md',
    noFail: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--help' || key === '-h') { printHelp(); process.exit(0); }
    if (key === '--root') { args.root = value; i += 1; }
    else if (key === '--out') { args.out = value; i += 1; }
    else if (key === '--no-fail') args.noFail = true;
    else throw new Error(`Unknown argument: ${key}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node .agents/skills/process-evidence-mapping/scripts/check-similarity-not-evidence.mjs --root docs/norms --no-fail

Flags risky wording where vector similarity may be used as final evidence.`);
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      yield path.join(dir, entry.name);
    }
  }
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function toRepoPath(filePath) {
  return path.relative(process.cwd(), filePath).replaceAll(path.sep, '/');
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(args.root);
  if (!fs.existsSync(root)) throw new Error(`Root does not exist: ${root}`);
  const findings = [];

  for (const file of walk(root)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!VECTOR_RE.test(line)) return;
      if (!RISK_RE.test(line)) return;
      if (SAFE_RE.test(line)) return;
      findings.push({
        file: toRepoPath(file),
        line: index + 1,
        text: line.trim().slice(0, 240),
        issue: 'Vector/similarity wording appears near final mapping fields without explicit candidate or source-verification status.',
      });
    });
  }

  const report = [
    '# Similarity Not Evidence Audit',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Root: \`${args.root}\``,
    `Findings: ${findings.length}`,
    '',
  ];

  if (findings.length) {
    report.push('| Severity | File | Line | Issue | Text |', '|---|---|---:|---|---|');
    for (const finding of findings) {
      report.push(`| WARN | \`${finding.file}\` | ${finding.line} | ${finding.issue} | ${finding.text.replaceAll('|', '\\|')} |`);
    }
  } else {
    report.push('No risky similarity-as-evidence wording found by this heuristic.');
  }
  report.push('');

  ensureDir(args.out);
  fs.writeFileSync(args.out, report.join('\n'), 'utf8');
  console.error(`findings=${findings.length} out=${args.out}`);
  if (findings.length && !args.noFail) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
