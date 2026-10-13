// Read-only inventory for the current frontend HTML. No services or private files.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
for (const relative of ['frontend/index.html', 'frontend/dist/index.html']) {
  const html = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
  assert(!/<script\b(?![^>]*\bsrc\s*=)[^>]*>/i.test(html), 'inline script in ' + relative);
  assert(!/\son\w+\s*=/i.test(html), 'HTML event handler in ' + relative);
}
console.log('Current frontend HTML has no inline scripts or event handlers');
