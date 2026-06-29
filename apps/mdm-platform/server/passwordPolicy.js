const crypto = require('crypto');

const KNOWN_FIXED_DEFAULT_PASSWORDS = ['000000', 'init1234'];
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function isRejectedKnownPassword(password) {
  return KNOWN_FIXED_DEFAULT_PASSWORDS.includes(String(password || ''));
}

function randomPasswordReviewItem(length = 16) {
  let password = '';
  for (let index = 0; index < length; index += 1) {
    password += PASSWORD_ALPHABET[crypto.randomInt(0, PASSWORD_ALPHABET.length)];
  }
  return password;
}

function generateInitialPassword() {
  let password = randomPasswordReviewItem();
  while (validatePasswordStrength(password) !== null || isRejectedKnownPassword(password)) {
    password = randomPasswordReviewItem();
  }
  return password;
}

function validatePasswordStrength(password, user = {}) {
  const value = String(password || '');
  if (value.length < 10) return '新密码至少 10 位';
  if (isRejectedKnownPassword(value)) return '不能使用固定默认口令';
  if (user.employee_no && value.toLowerCase().includes(String(user.employee_no).toLowerCase())) {
    return '新密码不能包含工号';
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return '新密码必须同时包含字母和数字';
  }
  return null;
}

function resolveInitialPassword(password) {
  if (password) return { error: '初始密码由系统随机生成' };
  const initialPassword = generateInitialPassword();
  return { password: initialPassword, initialPassword, mustChangePassword: 1 };
}

module.exports = {
  KNOWN_FIXED_DEFAULT_PASSWORDS,
  generateInitialPassword,
  isRejectedKnownPassword,
  validatePasswordStrength,
  resolveInitialPassword
};
