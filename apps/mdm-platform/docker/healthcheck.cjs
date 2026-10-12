// Readiness-only probe. No login, cookies, writes, repair or migration.
fetch('http://127.0.0.1:3000/api/ready', { signal: AbortSignal.timeout(4000) })
  .then(async response => {
    const data = await response.json();
    if (!response.ok || data.ready !== true || data.version?.sourceDigest !== process.env.MDM_EXPECTED_SOURCE_DIGEST) process.exit(1);
  }).catch(() => process.exit(1));
