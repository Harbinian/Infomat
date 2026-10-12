// R06 request-scoped security log.
//
// The rule is an allow list, not a deny list: a record is built from a fixed set of fields and
// nothing else can be added. This is the same shape the analysis worker already uses
// (`{event, code, run_id, at}`, "Never log SQL, exception text, input, actor session or claim
// token"); this module generalises it to the HTTP surface.
//
// A driver error carries `sql`, `sqlMessage` and `parameters`, and a request carries passwords,
// cookies and CSRF tokens. None of those are fields here, and the writer re-filters anyway, so a
// caller cannot pass one through by accident.
//
// Writing must never change an outcome: every failure inside the sink is swallowed, so a broken
// log destination cannot turn a served request into a 500 or hide the original business result.
const crypto = require('crypto');
const { identityInteger } = require('./sessionSubject');

const ALLOWED_FIELDS = Object.freeze([
  'event', 'code', 'route', 'method', 'status', 'duration_ms', 'request_id', 'actor_ref', 'at'
]);

const FORBIDDEN_KEY = /(pass|pwd|cookie|csrf|token|claim|secret|authoriz|body|sql|param|stack|message)/i;

const EVENTS = Object.freeze([
  'request_completed', 'request_failed', 'access_denied', 'rate_limited',
  'parse_failed', 'commit_unknown', 'worker_recovered', 'session_invalidated',
  'dependency_degraded'
]);

const MAX_BYTES = 8192;
const CODE_SHAPE = /^[A-Za-z0-9_.:-]{1,80}$/;

// The only thing read from an error is its code. `sql`, `sqlMessage`, `parameters`, `stack` and
// `message` are never touched, so a driver object cannot carry business values into the log.
function safeErrorCode(error) {
  const code = error && error.code;
  if (typeof code !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(code)) return null;
  return code;
}

function actorRef(session) {
  if (!session) return null;
  if (session.identityKind === 'system_admin') {
    const accountId = identityInteger(session.accountId);
    return accountId ? `system-admin:${accountId}` : 'system-admin';
  }
  const personId = identityInteger(session.personId);
  if (personId) return String(personId);
  return null;
}

function defaultSink(line) {
  process.stdout.write(`${line}\n`);
}

function createSecurityLog({ sink = defaultSink, now = Date.now, maxBytes = MAX_BYTES } = {}) {
  function write(entry = {}) {
    try {
      const record = { at: new Date(now()).toISOString() };
      for (const field of ALLOWED_FIELDS) {
        if (field === 'at') continue;
        const value = entry[field];
        if (value === undefined || value === null || value === '') continue;
        if (FORBIDDEN_KEY.test(field)) continue;
        // An allowed field cannot contain nested request/driver objects or custom serializers.
        if (['status', 'duration_ms'].includes(field)) {
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
        } else if (typeof value !== 'string') continue;
        if (field === 'event' && !CODE_SHAPE.test(value)) continue;
        // A code is an identifier, not free text: anything that does not look like one is dropped
        // rather than written, so a caller cannot pass a query or a message through this field.
        if (field === 'code' && !CODE_SHAPE.test(String(value))) continue;
        record[field] = typeof value === 'string' ? value.slice(0, 200) : value;
      }
      if (!record.event) return false;
      let line = JSON.stringify(record);
      if (Buffer.byteLength(line) > maxBytes) {
        // The replacement has to be bounded too, otherwise the limit is not a limit: the code is
        // shortened first and dropped entirely if even that does not fit.
        const shortened = record.code ? String(record.code).slice(0, 24) : null;
        line = JSON.stringify(shortened
          ? { at: record.at, event: 'log_oversize', code: shortened }
          : { event: 'log_oversize' });
        if (Buffer.byteLength(line) > maxBytes) line = JSON.stringify({ event: 'log_oversize' });
        if (Buffer.byteLength(line) > maxBytes) return false;
      }
      sink(line);
      return true;
    } catch {
      // A log that cannot be written is not allowed to affect the response that is being served.
      return false;
    }
  }
  return { write };
}

const defaultLog = createSecurityLog();

// Callers inside a route handler naturally hold either the request or the response; Express keeps
// `res.req`, so a shared error helper can report the request without changing its own signature.
function requestOf(target) {
  if (!target) return null;
  if (target.req && typeof target.req === 'object') return target.req;
  return target;
}

function requestFields(target) {
  const req = requestOf(target);
  if (!req) return {};
  return {
    // Only a matched route template is safe; an unmatched URL is arbitrary client input.
    route: typeof req.route?.path === 'string' ? req.route.path : '(unmatched)',
    method: req.method || null,
    request_id: req.requestId || null,
    actor_ref: actorRef(req.session)
  };
}

// Per-request writer: the caller supplies the event and code, the request supplies the rest.
function securityLog(target) {
  const req = requestOf(target);
  return {
    write(entry = {}) { return defaultLog.write({ ...requestFields(req), ...entry }); },
    requestId: req && req.requestId ? req.requestId : null
  };
}

// Records a failed request without ever touching the error's own text, SQL or parameters. A bare
// string is accepted as the code, so a handler that only knew a classification can still report
// it structurally instead of printing it.
function logRequestFailure(target, error, { status = null, code = null } = {}) {
  return securityLog(target).write({
    event: 'request_failed',
    code: code || safeErrorCode(error) || (typeof error === 'string' ? error : null),
    status
  });
}

// Health and static assets are noisy and carry no diagnostic value; every API request is logged
// with its status and duration so an error response can be traced back.
function isLoggable(req) {
  const url = String(req.originalUrl || req.url || '');
  return !/^\/(app\/assets|assets)\//.test(url) && !/\.(js|css|png|jpg|ico|svg|woff2?)$/i.test(url);
}

function installRequestLogging(app, { log = defaultLog } = {}) {
  app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    const startedAt = Date.now();
    if (isLoggable(req)) {
      res.on('finish', () => {
        log.write({
          ...requestFields(req),
          event: 'request_completed',
          status: res.statusCode,
          duration_ms: Date.now() - startedAt
        });
      });
    }
    next();
  });
}

module.exports = {
  ALLOWED_FIELDS,
  EVENTS,
  createSecurityLog,
  securityLog,
  logRequestFailure,
  installRequestLogging,
  safeErrorCode,
  actorRef
};
