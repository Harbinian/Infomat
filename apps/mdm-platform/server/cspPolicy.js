// The current frontend ships external scripts. No legacy inline-script hash or
// option can re-enable execution of the retired static page.
function buildCsp() {
  return [
    "default-src 'self'",
    "img-src 'self' data:",
    // Current chart components set presentation styles at runtime.
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    "frame-ancestors 'self'"
  ].join('; ');
}

const DEPLOYED_CSP = buildCsp();
module.exports = { buildCsp, DEPLOYED_CSP };
