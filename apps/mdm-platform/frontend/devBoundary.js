import net from 'node:net';

const reservedPorts = new Set([3000, 3001, 3306, 3307, 5173, 63805]);

export function isolatedBackend(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Set MDM_ISOLATED_BACKEND to the explicitly owned loopback HTTP backend.'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      reservedPorts.has(Number(url.port)) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('MDM_ISOLATED_BACKEND must be an explicit isolated 127.0.0.1 HTTP origin on a non-business port.');
  }
  return url.origin;
}

export function checkDevPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || reservedPorts.has(port)) {
    throw new Error('Use a random or explicitly free non-business development port.');
  }
}

// Vite treats port=0 as its default 5173. Resolve an OS-assigned free port first;
// strictPort then fails rather than switching if another process wins the race.
export async function freeDevPort() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const probe = net.createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    const port = probe.address().port;
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
    if (!reservedPorts.has(port)) return port;
  }
  throw new Error('No acceptable isolated development port was allocated.');
}
