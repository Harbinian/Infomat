const crypto = require('crypto');

const FIXED_DEFAULT_PASSWORD = 'init1234';
const INITIAL_PASSWORD_MIN_LENGTH = 12;

function isFixedDefaultPassword(password) {
  return String(password || '') === FIXED_DEFAULT_PASSWORD;
}

function generateInitialPassword() {
  return `tmp-${crypto.randomBytes(9).toString('hex')}`;
}

function resolveInitialPassword(password) {
  if (password) {
    if (isFixedDefaultPassword(password)) {
      return { error: '不能使用固定默认口令' };
    }
    if (String(password).length < INITIAL_PASSWORD_MIN_LENGTH) {
      return { error: `初始密码至少 ${INITIAL_PASSWORD_MIN_LENGTH} 位` };
    }
    return { password: String(password), generated: false, mustChangePassword: 1 };
  }

  return { password: generateInitialPassword(), generated: true, mustChangePassword: 1 };
}

module.exports = {
  FIXED_DEFAULT_PASSWORD,
  INITIAL_PASSWORD_MIN_LENGTH,
  generateInitialPassword,
  isFixedDefaultPassword,
  resolveInitialPassword
};
