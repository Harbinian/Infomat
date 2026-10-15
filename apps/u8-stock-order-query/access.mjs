import { isIP } from 'node:net';

export function isRequestAllowed(headers, { listenHost, port, publicPort }) {
  if (typeof headers.host !== 'string' || headers['sec-fetch-site'] === 'cross-site') return false;
  let target;
  try { target = new URL(`http://${headers.host}`); }
  catch { return false; }
  // Reject ambiguous authorities and keep browser requests on the current origin.
  if (target.username || target.password || target.pathname !== '/' || target.search || target.hash || target.host !== headers.host.toLowerCase()) return false;
  if (![port, publicPort].includes(Number(target.port))) return false;
  const hostname = target.hostname.replace(/^\[|\]$/g, '');
  if (hostname !== 'localhost' && !(isIP(hostname) && (listenHost === '0.0.0.0' || hostname === '127.0.0.1'))) return false;
  return headers.origin === undefined || headers.origin === target.origin;
}
