(function initImportCompatibility(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ImportCompatibility = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createImportCompatibility() {
  'use strict';

  const REPAIRABLE_RULE_CODES = Object.freeze([
    'DATA_RELATION_ACTION_BEHAVIOR_REQUIRED',
    'FORM_RELATION_ACTION_BEHAVIOR_REQUIRED'
  ]);
  const repairableRuleCodes = new Set(REPAIRABLE_RULE_CODES);

  function classifyPostMigrationValidation(validation) {
    if (validation?.valid === true) return { allowed: true, repairableErrors: [] };
    const errors = Array.isArray(validation?.errors) ? validation.errors : [];
    if (!errors.length || !errors.every(error => repairableRuleCodes.has(error?.rule_code))) {
      return { allowed: false, repairableErrors: [] };
    }
    return { allowed: true, repairableErrors: errors };
  }

  function classifyPostMigrationBatch(validations) {
    const values = Array.isArray(validations) ? validations : [];
    const classifications = values.map(classifyPostMigrationValidation);
    const failedIndex = classifications.findIndex(result => !result.allowed);
    if (!classifications.length || failedIndex >= 0) {
      return {
        allowed: false,
        failedIndex,
        repairableErrorCount: 0,
        classifications
      };
    }
    return {
      allowed: true,
      failedIndex: -1,
      repairableErrorCount: classifications.reduce(
        (sum, result) => sum + result.repairableErrors.length,
        0
      ),
      classifications
    };
  }

  return {
    REPAIRABLE_RULE_CODES,
    classifyPostMigrationValidation,
    classifyPostMigrationBatch
  };
}));
