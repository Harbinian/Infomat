/** Read a user-selected source directory; apply only to the local isolated review store. Never modify sources. */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { themes, suggestTheme } from '../topics.mjs';

const args = process.argv.slice(2);
const option = (key) => { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1]; };
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = option('--source');
if (!source) throw new Error('Required: --source <directory>. Default is read-only; --apply writes only the isolated review store.');
const sourceRoot = resolve(source);
const dataDir = resolve(option('--data-dir') || process.env.REVIEW_DATA_DIR || join(appRoot, '../../artifacts/process-review-service/local'));
if (dataDir === sourceRoot || dataDir.startsWith(sourceRoot + '\\') || dataDir.startsWith(sourceRoot + '/')) throw new Error('The isolated store must be outside the source directory.');
const paths = [];
async function walk(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && /\.json$/i.test(entry.name)) paths.push(path);
  }
}
await walk(sourceRoot);
paths.sort();
const files = [];
const manifest = [];
const errors = [];
for (const path of paths) {
  const raw = await readFile(path);
  const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  const sourcePath = relative(sourceRoot, path).replaceAll('\\', '/');
  try {
    const document = JSON.parse(content.replace(/^\uFEFF/, ''));
    if (document.schema_version !== 'process-governance-v8') throw new Error('Unsupported schema version');
    if (!document.process?.process_name || !Array.isArray(document.behaviors) || !Array.isArray(document.flow_relations)) throw new Error('Missing process or graph arrays');
    const themeId = suggestTheme(document.process.process_name, sourcePath);
    files.push({ sourcePath, content });
    manifest.push({ sourcePath, sha256: createHash('sha256').update(raw).digest('hex'), bytes: raw.length, name: document.process.process_name, sourceRef: document.process.process_ref, themeId });
  } catch (error) { errors.push({ sourcePath, error: error.message }); }
}
const summary = { mode: args.includes('--apply') ? 'apply-isolated' : 'read-only', files: paths.length, accepted: files.length, errors, themes: themes.map(t => ({ id: t.id, name: t.name, materials: manifest.filter(m => m.themeId === t.id).length })), ungrouped: manifest.filter(m => !m.themeId).map(m => ({ sourcePath: m.sourcePath, name: m.name })) };
if (errors.length) { console.log(JSON.stringify(summary, null, 2)); process.exitCode = 1; }
else if (args.includes('--apply')) {
  const { Store } = await import('../store.mjs');
  const { importMaterials } = await import('../domain.mjs');
  const store = new Store({ dataDir });
  try {
    const state = importMaterials(store, { files, expectedRevision: store.read().revision, actorId: 'local-pmo' });
    summary.revision = state.revision;
    summary.storedMaterials = state.materials.length;
    const changed = [];
    for (let index = 0; index < paths.length; index++) {
      const hash = createHash('sha256').update(await readFile(paths[index])).digest('hex');
      if (hash !== manifest[index].sha256) changed.push(manifest[index].sourcePath);
    }
    summary.sourceChangesDuringImport = changed;
    await mkdir(dataDir, { recursive: true });
    const reportPath = join(dataDir, `import-${Date.now()}.json`);
    await writeFile(reportPath, JSON.stringify({ sourceRoot, importedAt: new Date().toISOString(), summary, manifest }, null, 2), 'utf8');
    summary.manifestPath = reportPath;
    console.log(JSON.stringify(summary, null, 2));
    if (changed.length) process.exitCode = 1;
  } finally { store.close(); }
} else console.log(JSON.stringify(summary, null, 2));
