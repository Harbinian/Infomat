// R07 request error classification, shared by every API path.
//
// A malformed body, an oversized body and an unsupported encoding are client-side problems and
// must not be reported as server failures. The mapping reads only the parser's own error `type`;
// it never echoes `error.message`, a stack, or any fragment of the request body, because those
// can contain submitted values.
//
// The analysis endpoints keep their existing `DEFINITION_ANALYSIS_*` codes; this module is the
// general contract for every other path.

const BODY_PARSER_ERRORS = Object.freeze({
  'entity.parse.failed': { status: 400, code: 'REQUEST_JSON_INVALID', message: '请求格式无效，请检查后重试。' },
  'entity.too.large': { status: 413, code: 'REQUEST_PAYLOAD_TOO_LARGE', message: '请求内容超出允许大小。' },
  'entity.verify.failed': { status: 400, code: 'REQUEST_JSON_INVALID', message: '请求格式无效，请检查后重试。' },
  'encoding.unsupported': { status: 415, code: 'REQUEST_ENCODING_UNSUPPORTED', message: '请求编码不受支持。' },
  'charset.unsupported': { status: 415, code: 'REQUEST_ENCODING_UNSUPPORTED', message: '请求编码不受支持。' },
  'request.aborted': { status: 400, code: 'REQUEST_ABORTED', message: '请求未完成。' },
  'request.size.invalid': { status: 400, code: 'REQUEST_JSON_INVALID', message: '请求格式无效，请检查后重试。' }
});

// Returns null for anything that is not a recognised body-parser failure so the caller can defer
// to its own handler.
function bodyParserError(error) {
  if (!error || typeof error.type !== 'string') return null;
  return BODY_PARSER_ERRORS[error.type] || null;
}

function sendBodyParserError(res, error) {
  const contract = bodyParserError(error);
  if (!contract) return false;
  res.set('Cache-Control', 'no-store').status(contract.status).json({ code: contract.code, error: contract.message });
  return true;
}

// Credential shape gate for the login path. Runs before any account lookup, so it cannot reveal
// whether an account exists, and before any password hashing, so a malformed value can never
// reach bcrypt.
const LOGIN_NAME_MAX = 128;
const PASSWORD_MIN = 1;
const PASSWORD_MAX = 256;

function loginCredentialProblem(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'credential-body-shape';
  const rawName = body.loginName !== undefined ? body.loginName : body.employee_no;
  if (rawName !== undefined && rawName !== null && typeof rawName !== 'string') return 'login-name-type';
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name || name.length > LOGIN_NAME_MAX) return 'login-name-shape';
  const { password } = body;
  if (typeof password !== 'string') return 'password-type';
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return 'password-shape';
  return null;
}

const CREDENTIAL_INVALID = Object.freeze({ code: 'LOGIN_CREDENTIAL_INVALID', error: '工号或密码错误' });

module.exports = {
  BODY_PARSER_ERRORS,
  bodyParserError,
  sendBodyParserError,
  loginCredentialProblem,
  CREDENTIAL_INVALID,
  LOGIN_NAME_MAX,
  PASSWORD_MAX
};
