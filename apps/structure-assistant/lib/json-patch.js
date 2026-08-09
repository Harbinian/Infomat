'use strict';

const { AppError } = require('./errors');

const ALLOWED_ROOTS = new Set([
  'export_meta',
  'process',
  'reference_materials',
  'behaviors',
  'flow_relations',
  'data_objects',
  'cross_department_handoffs',
  'internal_process_calls',
  'forms',
  'terms'
]);
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function decodePointerSegment(segment) {
  if (/~(?![01])/u.test(segment)) {
    throw new AppError(400, 'INVALID_PATCH_PATH', '模型返回的JSON路径无法识别。');
  }
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function parsePointer(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || pointer === '/') {
    throw new AppError(400, 'INVALID_PATCH_PATH', '模型只能修改结构化工具允许的具体字段。');
  }
  const segments = pointer.slice(1).split('/').map(decodePointerSegment);
  if (!ALLOWED_ROOTS.has(segments[0]) || segments.some(segment => FORBIDDEN_SEGMENTS.has(segment))) {
    throw new AppError(400, 'PATCH_PATH_NOT_ALLOWED', `不允许修改字段路径：${pointer}`);
  }
  return segments;
}

function arrayIndex(segment, length, allowAppend) {
  if (allowAppend && segment === '-') return length;
  if (!/^(0|[1-9][0-9]*)$/u.test(segment)) {
    throw new AppError(400, 'INVALID_PATCH_INDEX', '模型返回了无效的数组位置。');
  }
  const index = Number(segment);
  if (index < 0 || index > length || (!allowAppend && index >= length)) {
    throw new AppError(400, 'PATCH_INDEX_OUT_OF_RANGE', '模型修改的位置已不存在。');
  }
  return index;
}

function parentAt(document, segments) {
  let target = document;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(target)) {
      target = target[arrayIndex(segment, target.length, false)];
    } else if (target && typeof target === 'object' && Object.prototype.hasOwnProperty.call(target, segment)) {
      target = target[segment];
    } else {
      throw new AppError(400, 'PATCH_TARGET_MISSING', '模型修改的结构位置不存在。');
    }
  }
  return { target, key: segments[segments.length - 1] };
}

function applyOperation(document, operation) {
  const op = String(operation?.op || '');
  if (!['add', 'replace', 'remove'].includes(op)) {
    throw new AppError(400, 'PATCH_OPERATION_NOT_ALLOWED', `模型返回了不允许的修改操作：${op || '空'}`);
  }
  const segments = parsePointer(operation.path);
  const { target, key } = parentAt(document, segments);

  if (Array.isArray(target)) {
    const index = arrayIndex(key, target.length, op === 'add');
    if (op === 'add') target.splice(index, 0, clone(operation.value));
    else if (op === 'replace') target[index] = clone(operation.value);
    else target.splice(index, 1);
    return;
  }

  if (!target || typeof target !== 'object') {
    throw new AppError(400, 'PATCH_TARGET_MISSING', '模型修改的结构位置不存在。');
  }
  if (op === 'add') {
    target[key] = clone(operation.value);
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(target, key)) {
    throw new AppError(400, 'PATCH_TARGET_MISSING', '模型修改的字段不存在。');
  }
  if (op === 'replace') target[key] = clone(operation.value);
  else delete target[key];
}

function applyRestrictedPatch(input, operations) {
  if (!Array.isArray(operations)) {
    throw new AppError(400, 'INVALID_PATCH', '模型返回的修改内容格式不正确。');
  }
  if (operations.length > 100) {
    throw new AppError(400, 'PATCH_TOO_LARGE', '模型一次返回的修改项超过100项。');
  }
  const serialized = JSON.stringify(operations);
  if (serialized.length > 1024 * 1024) {
    throw new AppError(400, 'PATCH_TOO_LARGE', '模型一次返回的修改内容过大。');
  }
  const result = clone(input);
  for (const operation of operations) applyOperation(result, operation);
  if (result.schema_version !== input.schema_version) {
    throw new AppError(400, 'SCHEMA_VERSION_CHANGED', '模型不得改变结构版本。');
  }
  return result;
}

module.exports = {
  ALLOWED_ROOTS,
  parsePointer,
  applyRestrictedPatch
};
