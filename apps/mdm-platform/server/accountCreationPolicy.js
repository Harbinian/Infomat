const fs = require('node:fs');
const path = require('node:path');
const { generateInitialPassword, validatePasswordStrength } = require('./passwordPolicy');

function failure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function employeeLoginName(employeeNo, suppliedLoginName) {
  const employee = String(employeeNo ?? '').trim();
  const supplied = String(suppliedLoginName ?? '').trim();
  if (supplied && supplied !== employee) {
    throw failure(422, 'LOGIN_NAME_MUST_MATCH_EMPLOYEE_NO', '新账号登录名必须与工号一致');
  }
  return employee;
}

// The optional secret is mounted independently of the application image. Only
// first activation uses it; password resets keep their existing random policy.
function accountInitialPassword(env = process.env) {
  const file = env.MDM_ACCOUNT_INITIAL_PASSWORD_FILE;
  if (!file) return generateInitialPassword();
  try {
    if (!path.isAbsolute(file)) throw new Error('invalid path');
    const password = fs.readFileSync(file, 'utf8').replace(/\r?\n$/, '');
    if (/[\x00-\x1f\x7f]/.test(password) || validatePasswordStrength(password)) throw new Error('invalid credential');
    return password;
  } catch {
    throw failure(503, 'ACCOUNT_INITIAL_PASSWORD_UNAVAILABLE', '账号初始密码配置暂不可用，请联系维护人员');
  }
}

module.exports = { employeeLoginName, accountInitialPassword };
