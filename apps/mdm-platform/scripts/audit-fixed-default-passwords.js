const db = require('../server/db');
const { verifyPassword } = require('../server/auth');
const { KNOWN_FIXED_DEFAULT_PASSWORDS } = require('../server/passwordPolicy');

const json = process.argv.includes('--json');

const users = db.prepare(`
  SELECT id, name, employee_no, department_id, post, role, must_change_password, created_at, password_hash
  FROM users
  ORDER BY employee_no
`).all();

const matches = users
  .filter(user => !user.must_change_password && KNOWN_FIXED_DEFAULT_PASSWORDS.some(password => verifyPassword(password, user.password_hash)))
  .map(({ password_hash, ...user }) => user);

const report = {
  dry_run: true,
  fixed_default_password_count: matches.length,
  users: matches
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`固定旧口令账号审计完成：发现 ${matches.length} 个账号。`);
  if (matches.length) {
    console.table(matches.map(user => ({
      id: user.id,
      employee_no: user.employee_no,
      name: user.name,
      role: user.role,
      must_change_password: user.must_change_password
    })));
    console.log('本脚本只做 dry-run 审计，不修改密码、不输出密码哈希。');
  }
}
