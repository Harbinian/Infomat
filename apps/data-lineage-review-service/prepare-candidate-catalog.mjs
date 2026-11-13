import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node prepare-candidate-catalog.mjs <candidate-markdown> <output>');

function tableLocation(value) {
  const match = /^(勤哲|KFU8QZ|用友U8) `(dbo\.[^`]+)`$/.exec(value);
  if (!match) throw new Error('Invalid candidate table location');
  return { system: match[1], table: match[2] };
}

const bytes = readFileSync(input);
const links = [];
let evidenceStatus;
for (const line of bytes.toString('utf8').split(/\r?\n/)) {
  if (line === '## 有取值、生成或计算依据') evidenceStatus = 'has_evidence';
  if (line === '## 待核证的同名关系') evidenceStatus = 'needs_verification';
  if (!/^\| C\d/.test(line)) continue;
  const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
  const [id, names, parentText, targetText, , evidence, pending] = cells;
  if (cells.length !== 7 || !/^C\d+$/.test(id) || !evidenceStatus || !evidence || !pending) {
    throw new Error('Invalid candidate row: ' + id);
  }
  const parent = tableLocation(parentText);
  const target = tableLocation(targetText);
  for (const name of names.split('、')) {
    if (!name || /日期|签字|编制|ExcelServer/i.test(name)) throw new Error('Invalid candidate field: ' + name);
    links.push({ id, name, parent, target, evidenceStatus, evidence, pending });
  }
}
if (!links.length) throw new Error('No candidate links were found');
const catalog = {
  format: 'same-name-lineage-candidates-v1',
  source: { file: basename(input), sha256: createHash('sha256').update(bytes).digest('hex') },
  links,
};
writeFileSync(output, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ links: links.length }));
