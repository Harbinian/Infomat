import { isIP } from 'node:net';

export const port = 3093;
const hostPort = Number(process.env.REVIEW_HOST_PORT || port);
export const allIps = process.env.REVIEW_NETWORK === 'all-ip';
const hostSuffix = `:${hostPort}`;
const localHosts = new Set([`127.0.0.1:${hostPort}`, `[::1]:${hostPort}`, `localhost:${hostPort}`, `127.0.0.1:${port}`]);

export function isAllowedHost(host) {
  if (localHosts.has(host)) return true;
  if (!allIps || !host?.endsWith(hostSuffix)) return false;
  const address = host.slice(0, -hostSuffix.length);
  if (address.startsWith('[') && address.endsWith(']')) return isIP(address.slice(1, -1)) === 6;
  return isIP(address) === 4;
}

export function responseHeaders(contentType, extra) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  };
}

export function send(response, status, contentType, body, headers) {
  response.writeHead(status, responseHeaders(contentType, headers));
  response.end(body);
}

export function json(response, status, value, headers) {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(value), headers);
}
