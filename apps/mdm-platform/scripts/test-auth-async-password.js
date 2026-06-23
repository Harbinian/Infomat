const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { hashPassword, verifyPassword, verifyPasswordAsync } = require('../server/auth');

async function main() {
  assert.strictEqual(typeof verifyPasswordAsync, 'function', 'auth should export async password verification');

  const hash = hashPassword('pass1234');
  assert.strictEqual(verifyPassword('pass1234', hash), true, 'sync password verification remains compatible');
  assert.strictEqual(await verifyPasswordAsync('pass1234', hash), true, 'async password verification accepts the correct password');
  assert.strictEqual(await verifyPasswordAsync('wrong-password', hash), false, 'async password verification rejects the wrong password');

  const orgSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'org.js'), 'utf8');
  assert.ok(orgSource.includes('verifyPasswordAsync'), 'login route should use async password verification');
  assert.ok(!orgSource.includes('!user || !verifyPassword(password, user.password_hash)'), 'login should not use sync password verification');

  console.log('Async password verification test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
