// Byte-preserved dependencies for v7-deterministic-v4 replay. The frozen
// normalizer's original relative fallback is bypassed by this explicit scorer.
const legacy = require('./processContentChecks');
const scoring = require('./structure-score');

function collectContentChecks(document, technicalErrors = [], options = {}) {
  return legacy.collectContentChecks(document, technicalErrors, scoring, options);
}

module.exports = { RULE_VERSION: legacy.RULE_VERSION, collectContentChecks };
