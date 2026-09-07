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

function assertUnique(records, field, label, required = false) {
  const seen = new Set();
  for (const record of records) {
    const value = String(record?.[field] ?? '');
    if (!value && required) throw new Error(`${label} missing ${field}`);
    if (!value) continue;
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

  const collections = {
    draft: [[data.draft], 'draft_ref'],
    document_profile: [[data.document_profile], 'profile_ref'],
    term: [data.terms, 'term_ref'],
    process: [data.processes, 'process_ref'],
    step: [data.steps, 'step_ref'],
    behavior_detail: [data.behavior_details, 'detail_ref'],
    handoff: [data.cross_dept_handoffs, 'handoff_ref'],
    form: [data.forms, 'form_ref'],
    form_table: [data.form_tables, 'table_ref'],
    form_table_field: [data.form_table_fields, 'table_field_ref'],
    form_field: [data.form_fields, 'field_ref'],
    work_role_binding: [data.work_role_bindings, 'binding_ref'],
    evidence: [data.evidence_catalog, 'evidence_ref'],
    mdm_requirement: [data.mdm_requirement_catalog, 'requirement_ref'],
  };
  const references = new Map(Object.entries(collections).map(([type, [records, field]]) => [
    type, assertUnique((records || []).filter(Boolean), field, type, ['process', 'step', 'evidence'].includes(type)),
  ]));
  assertUnique(data.step_transitions || [], 'transition_ref', 'step_transitions');
  assertUnique(data.pending_issues || [], 'stable_key', 'pending_issues', true);
  function requireReference(type, value, label) {
    if (!references.get(type)?.has(String(value))) {
      throw new Error(`${label} references missing ${type} ${value}`);
    }
  }
  const foreignKeys = {
    draft_ref: 'draft', process_ref: 'process', step_ref: 'step',
    form_ref: 'form', table_ref: 'form_table',
  };
  for (const [type, [records, ownKey]] of Object.entries(collections)) {
    for (const record of (records || []).filter(Boolean)) {
      for (const [field, target] of Object.entries(foreignKeys)) {
        if (field !== ownKey && record[field] !== undefined && record[field] !== null) {
          requireReference(target, record[field], `${type}.${field}`);
        }
      }
    }
  }
  // Evidence arrays also occur in nested role proposals and optional projections.
  function checkEvidenceRefs(value, label = '$') {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'evidence_refs') {
        for (const ref of child) requireReference('evidence', ref, `${label}.${key}`);
      } else checkEvidenceRefs(child, `${label}.${key}`);
    }
  }
  checkEvidenceRefs(data);
  const stepsByRef = new Map((data.steps || []).map(step => [String(step.step_ref), step]));
  for (const step of data.steps || []) requireReference('process', step.process_ref, `step ${step.step_ref}`);
  function checkProcessMembership(processRef, stepRef, label) {
    requireReference('process', processRef, label);
    requireReference('step', stepRef, label);
    if (String(stepsByRef.get(String(stepRef)).process_ref) !== String(processRef)) {
      throw new Error(`${label} step ${stepRef} belongs to another process`);
    }
  }
  for (const transition of data.step_transitions || []) {
    checkProcessMembership(transition.process_ref, transition.from_step_ref, `transition ${transition.transition_ref}`);
    if (transition.to_step_ref !== null && transition.to_step_ref !== undefined) checkProcessMembership(transition.process_ref, transition.to_step_ref, `transition ${transition.transition_ref}`);
  }
  for (const binding of data.work_role_bindings || []) {
    if (binding.step_ref !== null) checkProcessMembership(binding.process_ref, binding.step_ref, `binding ${binding.binding_ref}`);
  }
  for (const evidence of data.evidence_catalog || []) {
    if (evidence.object_ref !== undefined) requireReference(evidence.object_type, evidence.object_ref, `evidence ${evidence.evidence_ref}`);
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
    requireReference(issue.structured_object_type, issue.structured_object_key, `pending issue ${issue.stable_key}`);
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
