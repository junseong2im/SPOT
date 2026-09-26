import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import {
  FORMAT, VERSION, MAX_SOURCE_BYTES, MAX_JSON_BYTES, CHUNK_BYTES,
  requireThat, parseArgs, reportError, sha256, isSourceCommit, uniquePaths, uniqueDirectoryPaths,
  isInside, inspectPathTree, safeDirectory, prepareEmptyDirectory, safeFileStat,
  stableFileChunks, hashStableFile, readSmallJsonFile, writeNewFile, directoryFingerprints,
} from './backup-common.mjs';

class EncryptedChunkWriter extends Writable {
  constructor(directory) {
    super();
    this.directory = directory;
    this.pending = [];
    this.pendingBytes = 0;
    this.bytes = 0;
    this.hash = createHash('sha256');
    this.chunks = [];
  }

  _write(buffer, encoding, callback) {
    this.consume(buffer).then(() => callback(), callback);
  }

  async consume(buffer) {
    this.hash.update(buffer);
    this.bytes += buffer.length;
    let offset = 0;
    while (offset < buffer.length) {
      const count = Math.min(buffer.length - offset, CHUNK_BYTES - this.pendingBytes);
      this.pending.push(buffer.subarray(offset, offset + count));
      this.pendingBytes += count;
      offset += count;
      if (this.pendingBytes === CHUNK_BYTES) await this.flushChunk();
    }
  }

  async flushChunk() {
    if (this.pendingBytes === 0) return;
    const buffer = Buffer.concat(this.pending, this.pendingBytes);
    const file = `encrypted-${String(this.chunks.length + 1).padStart(6, '0')}.bin`;
    await writeNewFile(path.join(this.directory, file), buffer);
    this.chunks.push({ file, size: buffer.length, sha256: sha256(buffer) });
    this.pending = [];
    this.pendingBytes = 0;
  }

  _final(callback) {
    this.flushChunk().then(() => callback(), callback);
  }
}

async function* archiveJson(root, header, entries) {
  let emitted = 0;
  function checked(value) {
    emitted += Buffer.byteLength(value, 'utf8');
    requireThat(emitted <= MAX_JSON_BYTES, 'ARCHIVE_LIMIT_EXCEEDED');
    return value;
  }
  yield checked(`${JSON.stringify(header).slice(0, -1)},"entries":[`);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const metadata = { path: entry.path, sha256: entry.sha256, size: entry.size };
    yield checked(`${index === 0 ? '' : ','}${JSON.stringify(metadata).slice(0, -1)},"data":"`);
    let remainder = Buffer.alloc(0);
    for await (const chunk of stableFileChunks(root, entry.path, entry)) {
      const input = remainder.length ? Buffer.concat([remainder, chunk]) : chunk;
      const usable = input.length - (input.length % 3);
      if (usable > 0) yield checked(input.subarray(0, usable).toString('base64'));
      remainder = Buffer.from(input.subarray(usable));
    }
    if (remainder.length) yield checked(remainder.toString('base64'));
    yield checked('"}');
  }
  yield checked(']}');
}

export async function createBackup(options) {
  requireThat(isSourceCommit(options.sourceCommit), 'INVALID_SOURCE_COMMIT');
  const root = await safeDirectory(options.root);
  const out = path.resolve(options.out);
  const keyFile = path.resolve(options.keyFile);
  requireThat(!isInside(root, out) && !isInside(root, keyFile), 'OUTPUT_INSIDE_SOURCE_ROOT');
  requireThat(!isInside(out, keyFile), 'KEY_INSIDE_ARCHIVE_DIRECTORY');
  await inspectPathTree(out, 'directory', true);
  await safeDirectory(path.dirname(keyFile));
  let keyExists = false;
  try {
    await fs.lstat(keyFile);
    keyExists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  requireThat(!keyExists, 'KEY_FILE_ALREADY_EXISTS');
  const paths = uniquePaths(await readSmallJsonFile(options.pathsJson));
  const directories = uniqueDirectoryPaths(options.directoriesJson === undefined ? [] : await readSmallJsonFile(options.directoriesJson), paths);
  const directorySnapshots = await directoryFingerprints(root, directories);
  let declaredBytes = 0;
  for (const relative of paths) {
    const { stat } = await safeFileStat(root, relative);
    declaredBytes += Number(stat.size);
    requireThat(Number.isSafeInteger(declaredBytes) && declaredBytes <= MAX_SOURCE_BYTES, 'SOURCE_LIMIT_EXCEEDED');
  }
  const entries = [];
  let totalBytes = 0;
  for (const relative of paths) {
    const entry = await hashStableFile(root, relative);
    totalBytes += entry.size;
    requireThat(totalBytes <= MAX_SOURCE_BYTES, 'SOURCE_LIMIT_EXCEEDED');
    entries.push(entry);
  }
  requireThat(totalBytes === declaredBytes, 'SOURCE_CHANGED');
  const directory = await prepareEmptyDirectory(out);
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  try {
    await writeNewFile(keyFile, `${JSON.stringify({ format: `${FORMAT}-recovery-key`, version: VERSION, key: key.toString('base64') }, null, 2)}\n`);
    const header = { format: FORMAT, version: VERSION, sourceCommit: options.sourceCommit, fileCount: entries.length, directoryCount: directories.length, totalBytes };
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    const writer = new EncryptedChunkWriter(directory);
    await pipeline(Readable.from(archiveJson(root, { ...header, directories }, entries)), createGzip({ level: 9 }), cipher, writer);
    // A source edit after its archive read must invalidate the entire capture.
    for (const entry of entries) await hashStableFile(root, entry.path, entry);
    const finalDirectories = await directoryFingerprints(root, directories);
    requireThat(finalDirectories.every((value, index) => value === directorySnapshots[index]), 'SOURCE_DIRECTORY_CHANGED');
    const manifest = {
      ...header,
      compression: 'gzip',
      encryption: { algorithm: 'aes-256-gcm', nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64') },
      ciphertext: { sha256: writer.hash.digest('hex'), bytes: writer.bytes, chunkSize: CHUNK_BYTES, chunks: writer.chunks },
    };
    // The manifest is written last; its absence denotes an incomplete backup.
    await writeNewFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return { count: entries.length, bytes: totalBytes, sourceCommit: options.sourceCommit };
  } finally {
    key.fill(0);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ['--root', '--paths-json', '--out', '--key-file', '--source-commit'], ['--directories-json']);
  const summary = await createBackup({ root: args['--root'], pathsJson: args['--paths-json'], directoriesJson: args['--directories-json'], out: args['--out'], keyFile: args['--key-file'], sourceCommit: args['--source-commit'] });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => reportError('Backup', error));
}
