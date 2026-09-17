// Input: explicit .xlsx path. Output: new directory under repository artifacts only.
// Read-only source, no database/server/network/AI; emits JSON and Markdown for local review.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseMasterDataTemplate, previewMarkdown, LIMITS } = require('../server/masterDataTemplate');

async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--input', '--output'].includes(args[i]) || !args[i + 1] || Object.hasOwn(options, args[i])) throw new Error('用法：--input <原件.xlsx> --output <artifacts内全新目录>');
    options[args[i]] = args[i + 1];
  }
  if (!options['--input'] || !options['--output']) throw new Error('必须显式指定 --input 和 --output。');
  const input = path.resolve(options['--input']), output = path.resolve(options['--output']);
  if (!/\.xlsx$/i.test(input)) throw Object.assign(new Error('仅支持指定模板的 .xlsx 文件。'), { code: 'TEMPLATE_FILE_TYPE_INVALID' });
  const root = await fs.realpath(path.resolve(__dirname, '../../../artifacts'));
  const parent = await fs.realpath(path.dirname(output));
  const relative = path.relative(root, parent);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('输出父目录必须是仓库artifacts内已存在的真实目录。');
  const target = path.join(parent, path.basename(output));
  const stat = await fs.stat(input);
  if (!stat.isFile() || stat.size > LIMITS.bytes) throw Object.assign(new Error('输入不是普通文件或超过5MB。'), { code: 'TEMPLATE_LIMIT_EXCEEDED' });
  const bytes = await fs.readFile(input);
  const preview = await parseMasterDataTemplate(bytes, { originalName: path.basename(input) });
  const after = crypto.createHash('sha256').update(await fs.readFile(input)).digest('hex');
  if (after !== preview.source.raw_sha256) throw Object.assign(new Error('读取期间源文件发生变化，请重新核对。'), { code: 'TEMPLATE_SOURCE_CHANGED' });
  await fs.mkdir(target); // Fail if it exists; never overwrite an earlier preview.
  await fs.writeFile(path.join(target, 'preview.json'), JSON.stringify(preview, null, 2) + '\n', { flag: 'wx' });
  await fs.writeFile(path.join(target, 'preview.md'), previewMarkdown(preview), { flag: 'wx' });
  await fs.writeFile(path.join(target, 'source-integrity.json'), JSON.stringify({ sha256_before: preview.source.raw_sha256, sha256_after: after, unchanged: true }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ status: preview.status, ...preview.summary, output: target, source_unchanged: true }));
  return preview.summary.errors ? 2 : 0;
}
if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
  console.error(JSON.stringify({ code: error.code || 'TEMPLATE_CLI_FAILED', error: error.code?.startsWith('TEMPLATE_') || !error.code ? error.message : '本地文件读取或输出失败，请检查路径和是否已存在。' }));
  process.exitCode = 1;
});
module.exports = { main };
