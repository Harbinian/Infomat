const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const adminEmployeeNo = process.env.MDM_ADMIN_EMPLOYEE_NO;
const adminPassword = process.env.MDM_ADMIN_PASSWORD;
const adminName = process.env.MDM_ADMIN_NAME || '系统管理员';

if (!adminEmployeeNo || !adminPassword) {
  console.log('Bootstrap admin not created. Set MDM_ADMIN_EMPLOYEE_NO and MDM_ADMIN_PASSWORD to create an initial admin account.');
  process.exit(0);
}

if (adminPassword.length < 12) {
  console.error('MDM_ADMIN_PASSWORD must be at least 12 characters.');
  process.exit(1);
}

const adminHash = hashPassword(adminPassword);
const existingAdmin = db.prepare('SELECT id FROM users WHERE employee_no=?').get(adminEmployeeNo);

if (!existingAdmin) {
  db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES (?, ?, NULL, ?, ?, ?)
  `).run(adminName, adminEmployeeNo, '系统管理员', 'admin', adminHash);
  console.log(`Admin account created: ${adminEmployeeNo}`);
} else {
  console.log('Admin account already exists');
}
