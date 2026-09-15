const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function runtimeVersion(root = path.resolve(__dirname, '..')) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else if (entry.isFile() && /\.(js|json|html|css)$/.test(entry.name)) files.push(relative);
    }
  }
  walk('server');
  walk('public');
  for (const file of ['package.json', 'package-lock.json']) if (fs.existsSync(path.join(root, file))) files.push(file);
  for (const file of ['public/process-diagram.js','public/data-relation-diagram.js','node_modules/cytoscape/dist/cytoscape.min.js']) {
    const shared = '../structured-output-service/' + file;
    if (fs.existsSync(path.join(root, shared))) files.push(shared);
  }
  const hash = crypto.createHash('sha256');
  for (const file of files.sort()) hash.update(file).update('\0').update(fs.readFileSync(path.join(root, file))).update('\0');
  let head = 'unavailable';
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim(); } catch (_) { /* File digest remains authoritative. */ }
  return { packageVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
    sourceDigest: hash.digest('hex'), checkoutHead: head };
}

module.exports = { runtimeVersion };
