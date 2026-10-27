# Frozen v4 content checks

This directory retains the original content evaluator for
`v7-deterministic-v4`. Historical queue recovery and explicit v4 reruns use
these files; current preview checks and new v5 analyses use the current modules.

`structure-score.js` and `processContentChecks.js` are preserved byte for byte.
Their SHA-256 digests are respectively:

- `c9f17290bc07a2c3b58bc00645571b33549f2b8c38d2ace562c01eab69640b1a`
- `e435e89c52dd024c8686914f9fb7002fb4198377ea519c2fdfb8bc98ce0c2b72`

Call this directory's `index.js` entry point. It supplies the frozen scorer
explicitly, avoiding the byte-preserved normalizer's original relative fallback.
Do not update either frozen dependency when fixing current diagnostics. New
semantics require a distinct rule version; stored manifests and results remain
unchanged.
