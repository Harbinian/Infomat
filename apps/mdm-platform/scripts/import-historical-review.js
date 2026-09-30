// Input: explicit read-only snapshot directory. Output: a NEW private JSON dry-run file.
// No database configuration, DDL, production apply, network service or source builder is loaded.
const fs = require('node:fs');
const path = require('node:path');
const { loadSnapshot, verifyOriginals, fail } = require('../server/historicalReviewSource');
function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--source', '--output', '--verify-originals'].includes(key) || Object.hasOwn(options, key)) throw fail('ARGUMENT_INVALID');
    options[key] = key === '--verify-originals' ? true : args[++i];
  }
  if (!options['--source'] || !options['--output']) throw fail('SOURCE_AND_OUTPUT_REQUIRED');
  const output = path.resolve(options['--output']), source = path.resolve(options['--source']);
  const privateRoot = path.resolve(__dirname, '../../../artifacts') + path.sep;
  if (!output.startsWith(privateRoot) || output.startsWith(source + path.sep) || fs.existsSync(output)) throw fail('OUTPUT_MUST_BE_NEW_PRIVATE_FILE');
  // Resolve the existing parent too, so a symlink cannot redirect the output into source/static assets.
  const parent = fs.realpathSync(path.dirname(output));
  if (!parent.startsWith(privateRoot) || parent === fs.realpathSync(source) || parent.startsWith(fs.realpathSync(source) + path.sep)) throw fail('OUTPUT_MUST_BE_NEW_PRIVATE_FILE');
  const plan = loadSnapshot(source);
  const result = { mode: 'dry-run', plan, originals: options['--verify-originals'] ? verifyOriginals(plan) : null };
  fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ mode: result.mode, batch_key: plan.batch_key, totals: plan.totals, missing: plan.missing.length,
    opinions_with_gaps: plan.items.filter(x => x.gaps.length).length, output }));
  return result;
}
if (require.main === module) { try { main(); } catch (e) { console.error(e.code?.startsWith('HISTORY_') ? e.code : 'HISTORY_DRY_RUN_FAILED'); process.exitCode = 1; } }
module.exports = { main };
