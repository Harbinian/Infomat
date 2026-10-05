/**
 * Read an explicitly selected historical department/domain JSON map.
 * This compatibility input does not establish current organization authority.
 */
import { readFileSync } from 'node:fs';

export function validateLegacyDepartmentDomains(data) {
  const departments = data?.departments;
  if (!departments || typeof departments !== 'object' || Array.isArray(departments)) {
    throw new Error('Historical domain input must contain a departments object');
  }
  const entries = Object.entries(departments);
  if (!entries.length) throw new Error('Historical department/domain map must not be empty');
  for (const [department, domain] of entries) {
    if (!department.trim() || department !== department.trim() || ['__proto__', 'constructor', 'prototype'].includes(department)) {
      throw new Error(`Invalid historical department key: ${department}`);
    }
    if (typeof domain !== 'string' || !domain.trim() || domain !== domain.trim()) {
      throw new Error(`Historical department ${department} must have an explicit non-empty domain`);
    }
  }
  return Object.fromEntries(entries);
}

export function readLegacyDepartmentDomains(filePath) {
  return validateLegacyDepartmentDomains(JSON.parse(readFileSync(filePath, 'utf8')));
}
