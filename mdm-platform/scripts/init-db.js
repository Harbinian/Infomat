const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const adminHash = hashPassword('admin123');
const existingAdmin = db.prepare("SELECT id FROM users WHERE employee_no='ADMIN001'").get();

if (!existingAdmin) {
  db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES (?, ?, NULL, ?, ?, ?)
  `).run('系统管理员', 'ADMIN001', '系统管理员', 'admin', adminHash);
  console.log('Admin account created: ADMIN001 / admin123');
} else {
  console.log('Admin account already exists');
}
