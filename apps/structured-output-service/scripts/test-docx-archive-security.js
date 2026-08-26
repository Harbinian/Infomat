const assert = require('node:assert/strict');

const { inspectDocxArchive } = require('../server');

function nameBytes(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
}

function buildZip(entries, options = {}) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    const localName = nameBytes(entry.localName ?? entry.name);
    const centralName = nameBytes(entry.centralName ?? entry.name);
    const compressedSize = entry.compressedSize ?? 1;
    const uncompressedSize = entry.uncompressedSize ?? compressedSize;
    const data = Buffer.alloc(entry.actualCompressedSize ?? compressedSize, 0x31);
    const local = Buffer.alloc(30 + localName.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.localFlags ?? 0, 6);
    local.writeUInt16LE(entry.localMethod ?? 0, 8);
    local.writeUInt32LE(entry.localCompressedSize ?? compressedSize, 18);
    local.writeUInt32LE(entry.localUncompressedSize ?? uncompressedSize, 22);
    local.writeUInt16LE(localName.length, 26);
    localName.copy(local, 30);

    const central = Buffer.alloc(46 + centralName.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.centralFlags ?? 0, 8);
    central.writeUInt16LE(entry.centralMethod ?? 0, 10);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(centralName.length, 28);
    central.writeUInt32LE(entry.localOffset ?? localOffset, 42);
    centralName.copy(central, 46);

    localParts.push(local, data);
    centralParts.push(central);
    localOffset += local.length + data.length;
  }
  const localContent = Buffer.concat(localParts);
  const directory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const entryCount = options.entryCount ?? entries.length;
  eocd.writeUInt16LE(options.diskEntryCount ?? entryCount, 8);
  eocd.writeUInt16LE(entryCount, 10);
  eocd.writeUInt32LE(options.directorySize ?? directory.length, 12);
  eocd.writeUInt32LE(options.directoryOffset ?? localContent.length, 16);
  return Buffer.concat([localContent, directory, eocd]);
}

function assertUnsafe(buffer, label) {
  assert.throws(
    () => inspectDocxArchive(buffer),
    error => error?.publicCode === 'DOCX_ARCHIVE_UNSAFE',
    label
  );
}

assert.equal(typeof inspectDocxArchive, 'function');

const twoThousandEntries = Array.from({ length: 2000 }, (_, index) => ({ name: `e${index}.xml` }));
assert.doesNotThrow(() => inspectDocxArchive(buildZip(twoThousandEntries)));
assertUnsafe(buildZip([], { entryCount: 2001, diskEntryCount: 2001 }), '2001 entries must be rejected');

const twentyMegabytes = 20 * 1024 * 1024;
assert.doesNotThrow(() => inspectDocxArchive(buildZip([{
  name: 'word/document.xml',
  compressedSize: Math.ceil(twentyMegabytes / 100),
  uncompressedSize: twentyMegabytes
}])));
assertUnsafe(buildZip([{
  name: 'word/document.xml',
  compressedSize: Math.ceil((twentyMegabytes + 1) / 100),
  uncompressedSize: twentyMegabytes + 1
}]), 'an entry over 20MB must be rejected');

const tenMegabytes = 10 * 1024 * 1024;
assert.doesNotThrow(() => inspectDocxArchive(buildZip([
  { name: 'a.xml', compressedSize: Math.ceil(twentyMegabytes / 100), uncompressedSize: twentyMegabytes },
  { name: 'b.xml', compressedSize: Math.ceil(twentyMegabytes / 100), uncompressedSize: twentyMegabytes },
  { name: 'c.xml', compressedSize: Math.ceil(tenMegabytes / 100), uncompressedSize: tenMegabytes }
])));
assertUnsafe(buildZip([
  { name: 'a.xml', compressedSize: Math.ceil(twentyMegabytes / 100), uncompressedSize: twentyMegabytes },
  { name: 'b.xml', compressedSize: Math.ceil(twentyMegabytes / 100), uncompressedSize: twentyMegabytes },
  { name: 'c.xml', compressedSize: Math.ceil((tenMegabytes + 1) / 100), uncompressedSize: tenMegabytes + 1 }
]), 'a total over 50MB must be rejected');

assert.doesNotThrow(() => inspectDocxArchive(buildZip([{
  name: 'ratio.xml', compressedSize: 20000, uncompressedSize: 2000000
}])));
assertUnsafe(buildZip([{
  name: 'ratio.xml', compressedSize: 20000, uncompressedSize: 2000001
}]), 'a compression ratio over 100:1 must be rejected');
assert.doesNotThrow(() => inspectDocxArchive(buildZip([{
  name: 'small-ratio.xml', compressedSize: 100, uncompressedSize: 10000
}])));
assertUnsafe(buildZip([{
  name: 'small-ratio.xml', compressedSize: 100, uncompressedSize: 10001
}]), 'a small entry over 100:1 must be rejected');
assertUnsafe(buildZip([{
  name: 'zero-compressed.xml', compressedSize: 0, uncompressedSize: 1
}]), 'a non-empty entry with zero compressed bytes must be rejected');

assert.doesNotThrow(() => inspectDocxArchive(buildZip([{
  name: `${'a/'.repeat(19)}file.xml`
}])));
assertUnsafe(buildZip([{
  name: `${'a/'.repeat(20)}file.xml`
}]), 'a path deeper than 20 parts must be rejected');
assertUnsafe(buildZip([{ name: '../outside.xml' }]), 'path traversal must be rejected');
assertUnsafe(buildZip([], { entryCount: 0xffff, diskEntryCount: 0xffff }), 'ZIP64 must be rejected');
assertUnsafe(buildZip([{ name: Buffer.from([0xff]) }]), 'invalid UTF-8 names must be rejected');
assertUnsafe(buildZip([{
  name: 'central.xml', localName: 'local___.xml'
}]), 'central and local names must match');
assertUnsafe(buildZip([{
  name: 'size.xml', localCompressedSize: 2, compressedSize: 1
}]), 'central and local compressed sizes must match');
assertUnsafe(buildZip([{
  name: 'size.xml', localUncompressedSize: 2, uncompressedSize: 1
}]), 'central and local uncompressed sizes must match');
assertUnsafe(buildZip([{
  name: 'boundary.xml', compressedSize: 2, actualCompressedSize: 1
}]), 'compressed data must remain before the central directory');

console.log('structured-output-service DOCX archive security tests passed');
