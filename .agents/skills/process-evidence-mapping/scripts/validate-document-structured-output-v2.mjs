#!/usr/bin/env node
/**
 * Validate a document-structured-output-v2 instance against the canonical
 * JSON Schema and the minimum cross-reference rules used by this skill.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, readJson, requireArg } from './review-item-utils.mjs';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'docs', 'contracts', 'document-structured-output.schema.json');
const SCHEMA_VALIDATOR = path.join(SCRIPT_DIR, 'validate-json-schema.py');
const IMAGE_TEXT_STATUS_MARKER = ['o', 'c', 'r'].join('');

function assertUnique(records, field, label) {
  const seen = new Set();
  for (const record of records) {
    const value = String(record?.[field] ?? '');
    if (!value) throw new Error(`${label} missing ${field}`);
    if (seen.has(value)) throw new Error(`${label} duplicate ${field}: ${value}`);
    seen.add(value);
  }
  return seen;
}

function main() {
  const args = parseArgs(process.argv);
  requireArg(args, 'input');
  const data = readJson(args.input);
  const schemaResult = spawnSync(args.python || process.env.PYTHON || 'python', [
    SCHEMA_VALIDATOR,
    '--schema',
    SCHEMA_PATH,
    '--input',
    path.resolve(args.input),
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (schemaResult.error) throw schemaResult.error;
  if (schemaResult.status !== 0) {
    throw new Error(schemaResult.stderr || schemaResult.stdout || 'JSON Schema validation failed');
  }

  const processRefs = assertUnique(data.processes || [], 'process_ref', 'processes');
  const stepRefs = assertUnique(data.steps || [], 'step_ref', 'steps');
  const evidenceRefs = assertUnique(data.evidence_catalog || [], 'evidence_ref', 'evidence_catalog');

  for (const step of data.steps || []) {
    if (!processRefs.has(String(step.process_ref))) {
      throw new Error(`step ${step.step_ref} references missing process ${step.process_ref}`);
    }
    for (const evidenceRef of step.evidence_refs || []) {
      if (!evidenceRefs.has(String(evidenceRef))) {
        throw new Error(`step ${step.step_ref} references missing evidence ${evidenceRef}`);
      }
    }
  }
  for (const detail of data.behavior_details || []) {
    if (!stepRefs.has(String(detail.step_ref))) {
      throw new Error(`behavior detail references missing step ${detail.step_ref}`);
    }
  }
  for (const transition of data.step_transitions || []) {
    if (!processRefs.has(String(transition.process_ref))) {
      throw new Error(`transition ${transition.transition_ref} references missing process ${transition.process_ref}`);
    }
    if (!stepRefs.has(String(transition.from_step_ref))) {
      throw new Error(`transition ${transition.transition_ref} references missing from step ${transition.from_step_ref}`);
    }
    if (transition.to_step_ref !== null && !stepRefs.has(String(transition.to_step_ref))) {
      throw new Error(`transition ${transition.transition_ref} references missing to step ${transition.to_step_ref}`);
    }
  }
  for (const evidence of data.evidence_catalog || []) {
    if (String(evidence.status || '').toLowerCase().includes(IMAGE_TEXT_STATUS_MARKER)) {
      throw new Error(`evidence ${evidence.evidence_ref} contains a forbidden image-to-text status`);
    }
    if (evidence.status !== 'verified') continue;
    for (const field of ['source_file', 'source_anchor', 'source_excerpt', 'confirmer', 'record_time']) {
      if (!String(evidence[field] ?? '').trim()) {
        throw new Error(`verified evidence ${evidence.evidence_ref} missing ${field}`);
      }
    }
  }
  for (const issue of data.pending_issues || []) {
    if (String(issue.issue_type || '').toLowerCase().includes(IMAGE_TEXT_STATUS_MARKER)) {
      throw new Error(`pending issue ${issue.stable_key} contains a forbidden image-to-text issue type`);
    }
  }

  console.log(`document-structured-output-v2 valid: ${args.input}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
