// Pure request-field policy shared by prechecks and locked account maintenance.
function readonlyWriteViolation(req, permCode, fieldConstraints) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return [];
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return [];

  const constraints = fieldConstraints || {};
  const readonly = new Set();
  const fc = constraints[permCode];
  if (fc && Array.isArray(fc.readonly)) {
    fc.readonly.forEach(field => readonly.add(field));
  }
  if (readonly.size === 0) return [];

  return Array.from(readonly).filter(field => Object.prototype.hasOwnProperty.call(req.body, field));
}

module.exports = { readonlyWriteViolation };
