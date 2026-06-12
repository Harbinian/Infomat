const FIRST_LOGIN_PASSWORD = '000000';
const HISTORICAL_FIXED_DEFAULT_PASSWORD = 'init1234';
const FIXED_DEFAULT_PASSWORD = FIRST_LOGIN_PASSWORD;

function isFixedDefaultPassword(password) {
  return [FIRST_LOGIN_PASSWORD, HISTORICAL_FIXED_DEFAULT_PASSWORD].includes(String(password || ''));
}

function generateInitialPassword() {
  return FIRST_LOGIN_PASSWORD;
}

function resolveInitialPassword(password) {
  if (password && String(password) !== FIRST_LOGIN_PASSWORD) {
    return { error: '首次登录密码固定为 000000' };
  }

  return { password: FIRST_LOGIN_PASSWORD, generated: false, mustChangePassword: 1 };
}

module.exports = {
  FIRST_LOGIN_PASSWORD,
  FIXED_DEFAULT_PASSWORD,
  generateInitialPassword,
  isFixedDefaultPassword,
  resolveInitialPassword
};
