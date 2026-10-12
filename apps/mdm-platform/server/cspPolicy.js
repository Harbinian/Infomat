// R13: the content security policy lives in one place so tightening it is a single, reviewable
// change rather than a string edited in a header middleware.
//
// The retained page (`public/index.html`) still carries one inline <script> block. `script-src
// 'self'` alone would block it, and a nonce would require making a static file dynamic. A hash
// allows exactly that block and nothing else, which is precisely the property R13 asks for: the
// page's own script runs, an injected inline script does not.
//
// The hash is over the element's exact text content, so it changes whenever that block changes.
// `INLINE_SCRIPT_SHA256` is checked against the file by scripts/test-csp-policy-contract.js and
// by audit-inline-script-inventory.js -- a stale hash would silently blank the page, so drift
// has to fail loudly rather than quietly.
const INLINE_SCRIPT_SHA256 = 'sha256-ccum62GvJpi1XvHQV+jSe7zqO4neh99AI7UixRfupRc=';

function buildCsp({ allowInlineScript = false, scriptHash = INLINE_SCRIPT_SHA256 } = {}) {
  const scriptSrc = allowInlineScript
    ? "'self' 'unsafe-inline'"
    : `'self' '${scriptHash}'`;
  return [
    "default-src 'self'",
    "img-src 'self' data:",
    // style-src is deliberately left as-is: the retained page uses 271 style attributes and
    // scripts set element styles directly. R13 is about scripts, and changing this would be a
    // functional regression outside its scope.
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSrc}`,
    "frame-ancestors 'self'"
  ].join('; ');
}

// The policy as deployed: inline event-handler attributes are gone, and the page's own script is
// allowed by hash while any other inline script is blocked.
const DEPLOYED_CSP = buildCsp({ allowInlineScript: false });
// Retained so the previous behaviour can still be described and diffed.
const PREVIOUS_CSP = buildCsp({ allowInlineScript: true });

module.exports = { buildCsp, DEPLOYED_CSP, PREVIOUS_CSP, INLINE_SCRIPT_SHA256 };
